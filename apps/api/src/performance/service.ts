import {
  addDays, avgOf, mondayOf, perHour, rankGroup, scoreStation, scoreWaiter, serviceDayOf, shiftMinutes, stationEligible,
  waiterEligible, weekDays, emptyAgg, mergeAgg, type Agg, type StaffRole, type Breakdown, type PerformanceQuery,
} from "@lodos/shared";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { opsForDays, type DayOps } from "../ops/daily";

/** Staff performance (phase 3): rankings per group, one person's page, and "my performance". Run inside the tenant. */
export const RANKED_GROUPS = ["floor", "kitchen", "bar"] as const;
type Group = (typeof RANKED_GROUPS)[number];
const GROUP_OF_ROLE: Record<string, Group> = { waiter: "floor", cook: "kitchen", bartender: "bar" };

export const HISTORY_WEEKS = 8;
const COMMENT_LIMIT = 50;

export type Row = {
  staffId: string;
  name: string;
  role: string;
  score: number | null;
  breakdown: Breakdown;
  ratingAvg: number | null;
  ratingCount: number;
  minutes: number;
  plannedMinutes: number;
  lateShifts: number;
};

export type Comment = { id: string; comment: string; stars: number | null; at: string; hidden: boolean };

/** The service days of the period that have started: a week's days, or a month's up to today. */
function periodDays(q: PerformanceQuery, today: string): { period: "week" | "month"; key: string; days: string[] } {
  if (q.period === "month") {
    const key = q.key ?? today.slice(0, 7);
    const days: string[] = [];
    for (let d = `${key}-01`; d.startsWith(key); d = addDays(d, 1)) if (d <= today) days.push(d);
    return { period: "month", key, days };
  }
  const key = q.key ?? mondayOf(today);
  return { period: "week", key, days: weekDays(key).filter((d) => d <= today) };
}

type Figures = { row: Row; group: Group; rate: number; eligible: boolean; ratingAgg: Agg; shifts: number; covers: number; tickets: number; onTime: number };

/** One figures record per ranked-role person, summed over `ops`. */
function figuresFor(staff: { id: string; name: string; role: string; active: boolean }[], ops: DayOps[], planned: Map<string, number>): Figures[] {
  const people = new Map<string, DayOps["people"][number]>();
  const waiter = new Map<string, Agg>();
  const covers = new Map<string, number>();
  for (const d of ops) {
    for (const p of d.people) {
      const prev = people.get(p.staffId);
      if (!prev) people.set(p.staffId, { ...p });
      else for (const k of ["minutes", "lateShifts", "shifts", "stationTickets", "stationOnTime", "dishRatingSum", "dishRatingCount"] as const) prev[k] += p[k];
    }
    for (const w of d.ratings.waiter) waiter.set(w.staffId, mergeAgg(waiter.get(w.staffId) ?? emptyAgg(), w));
    for (const s of d.byServer) covers.set(String(s.staffId), (covers.get(String(s.staffId)) ?? 0) + s.covers);
  }
  const out: Figures[] = [];
  for (const s of staff) {
    const group = GROUP_OF_ROLE[s.role];
    if (!group) continue;
    const p = people.get(s.id);
    const minutes = p?.minutes ?? 0;
    if (!s.active && minutes === 0) continue;
    const shifts = p?.shifts ?? 0;
    const isFloor = group === "floor";
    const ratingAgg = isFloor ? (waiter.get(s.id) ?? emptyAgg()) : { sum: p?.dishRatingSum ?? 0, count: p?.dishRatingCount ?? 0, dist: [0, 0, 0, 0, 0] as Agg["dist"] };
    const c = covers.get(s.id) ?? 0;
    const tickets = p?.stationTickets ?? 0;
    const onTime = p?.stationOnTime ?? 0;
    out.push({
      group,
      rate: perHour(isFloor ? c : tickets, minutes),
      eligible: isFloor ? waiterEligible({ ratingCount: ratingAgg.count, shifts }) : stationEligible({ dishCount: ratingAgg.count, shifts }),
      ratingAgg, shifts, covers: c, tickets, onTime,
      row: {
        staffId: s.id, name: s.name, role: s.role, score: null, breakdown: [],
        ratingAvg: avgOf(ratingAgg), ratingCount: ratingAgg.count, minutes, plannedMinutes: planned.get(s.id) ?? 0, lateShifts: p?.lateShifts ?? 0,
      },
    });
  }
  return out;
}

/** Scores and ranks every group; "best in group" is taken among the people who meet the minimums. */
function rankedGroups(figures: Figures[]): Record<Group, Row[]> {
  const groups: Record<Group, Row[]> = { floor: [], kitchen: [], bar: [] };
  for (const g of RANKED_GROUPS) {
    const members = figures.filter((f) => f.group === g);
    const best = Math.max(0, ...members.filter((f) => f.eligible).map((f) => f.rate));
    for (const f of members) {
      const scored =
        g === "floor"
          ? scoreWaiter({ ratingAvg: f.row.ratingAvg, ratingCount: f.row.ratingCount, covers: f.covers, minutes: f.row.minutes, shifts: f.shifts, lateShifts: f.row.lateShifts }, best)
          : scoreStation({ dishAvg: f.row.ratingAvg, dishCount: f.row.ratingCount, tickets: f.tickets, onTime: f.onTime, minutes: f.row.minutes, shifts: f.shifts, lateShifts: f.row.lateShifts }, best);
      groups[g].push(scored.score === null ? f.row : { ...f.row, score: scored.score, breakdown: scored.breakdown });
    }
    groups[g] = rankGroup(groups[g]);
  }
  return groups;
}

async function plannedMinutes(models: Models, days: string[]): Promise<Map<string, number>> {
  const shifts = await models.Shift.find({ serviceDay: { $in: days } }, { staffId: 1, start: 1, end: 1 }).lean();
  const out = new Map<string, number>();
  for (const s of shifts) out.set(String(s.staffId), (out.get(String(s.staffId)) ?? 0) + shiftMinutes(s));
  return out;
}

const staffList = async (models: Models) =>
  (await models.Staff.find({ role: { $in: Object.keys(GROUP_OF_ROLE) as StaffRole[] } }, { name: 1, role: 1, active: 1 }).lean()).map((s) => ({
    id: String(s._id), name: s.name, role: s.role as string, active: s.active,
  }));

async function groupsFor(models: Models, q: PerformanceQuery, now: Date) {
  const { days } = periodDays(q, serviceDayOf(now));
  const [staff, planned, ops] = await Promise.all([staffList(models), plannedMinutes(models, days), opsForDays(models, days, now)]);
  return rankedGroups(figuresFor(staff, days.map((d) => ops.get(d)!), planned));
}

/** GET /api/performance/ranking. */
export async function ranking(models: Models, q: PerformanceQuery, now: Date): Promise<{ groups: Record<Group, Row[]> }> {
  return { groups: await groupsFor(models, q, now) };
}

export type TrendPoint = { week: string; avg: number | null; count: number };
export type History = { points: { week: string; score: number | null }[]; trend: TrendPoint[]; comments: Comment[] };

/** The last 8 weeks (ending with the current one): this person's score, rating average and the comments about them. */
async function historyOf(models: Models, staffId: string, role: string, now: Date, withHidden: boolean): Promise<History> {
  const today = serviceDayOf(now);
  const thisMonday = mondayOf(today);
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(thisMonday, (i - (HISTORY_WEEKS - 1)) * 7));
  const days = weeks.flatMap((w) => weekDays(w)).filter((d) => d <= today);
  const [staff, planned, ops] = await Promise.all([staffList(models), plannedMinutes(models, days), opsForDays(models, days, now)]);
  const points: History["points"] = [];
  const trend: TrendPoint[] = [];
  for (const week of weeks) {
    const wd = weekDays(week).filter((d) => d <= today).map((d) => ops.get(d)!);
    const figures = figuresFor(staff, wd, planned);
    const mine = figures.find((f) => f.row.staffId === staffId);
    const group = GROUP_OF_ROLE[role];
    const row = group ? rankedGroups(figures)[group].find((r) => r.staffId === staffId) : undefined;
    points.push({ week, score: row?.score ?? null });
    trend.push({ week, avg: mine ? avgOf(mine.ratingAgg) : null, count: mine?.ratingAgg.count ?? 0 });
  }
  const docs = await models.Rating.find(
    { serverStaffId: staffId, comment: { $nin: [null, ""] }, serviceDay: { $gte: weeks[0]!, $lte: today }, ...(withHidden ? {} : { commentHidden: false }) },
    { comment: 1, waiter: 1, submittedAt: 1, commentHidden: 1 },
  ).sort({ submittedAt: -1 }).limit(COMMENT_LIMIT).lean();
  const comments = docs.map((d) => ({ id: String(d._id), comment: d.comment!, stars: d.waiter ?? null, at: d.submittedAt.toISOString(), hidden: d.commentHidden }));
  return { points, trend, comments };
}

/** GET /api/performance/:staffId. */
export async function personPerformance(models: Models, staffId: string, q: PerformanceQuery, now: Date) {
  const groups = await groupsFor(models, q, now);
  const row = Object.values(groups).flat().find((r) => r.staffId === staffId);
  if (!row) throw new ApiError(404, "not_found");
  const h = await historyOf(models, staffId, row.role, now, true);
  return { ...row, history: h.points, trend: h.trend, comments: h.comments };
}

const EMPTY_ME = { score: null, breakdown: [] as Breakdown, ratingAvg: null, ratingCount: 0, minutes: 0, plannedMinutes: 0, lateShifts: 0 };

/** GET /api/me/performance: the caller's own figures only, no ids or names; the rank is a position and a count. */
export async function myPerformance(models: Models, me: { id: string; role: string }, q: PerformanceQuery, now: Date) {
  const group = GROUP_OF_ROLE[me.role];
  if (!group) {
    // Not ranked (manager, host, station accounts): their own hours only.
    const { days } = periodDays(q, serviceDayOf(now));
    const [planned, ops] = await Promise.all([plannedMinutes(models, days), opsForDays(models, days, now)]);
    const mine = days.flatMap((d) => ops.get(d)!.people).filter((p) => p.staffId === me.id);
    return {
      ...EMPTY_ME,
      minutes: mine.reduce((s, p) => s + p.minutes, 0),
      plannedMinutes: planned.get(me.id) ?? 0,
      lateShifts: mine.reduce((s, p) => s + p.lateShifts, 0),
      rank: null,
      comments: [] as { comment: string; stars: number | null; at: string }[],
    };
  }
  const rows = (await groupsFor(models, q, now))[group];
  const row = rows.find((r) => r.staffId === me.id);
  const h = await historyOf(models, me.id, me.role, now, false);
  const ranked = rows.filter((r) => r.score !== null);
  const position = ranked.findIndex((r) => r.staffId === me.id) + 1;
  return {
    score: row?.score ?? null,
    breakdown: row?.breakdown ?? [],
    ratingAvg: row?.ratingAvg ?? null,
    ratingCount: row?.ratingCount ?? 0,
    minutes: row?.minutes ?? 0,
    plannedMinutes: row?.plannedMinutes ?? 0,
    lateShifts: row?.lateShifts ?? 0,
    rank: position > 0 ? { position, of: ranked.length } : null,
    history: h.points,
    trend: h.trend,
    comments: h.comments.map((c) => ({ comment: c.comment, stars: c.stars, at: c.at })),
  };
}
