import {
  avgOf, comparisonDays, emptyAgg, MENU_GROUP_LABELS, menuQuadrant, mergeAgg, mergeRatingAgg, mondayOf, monthDays, previousMonth,
  restaurantRating, scheduleGroupOf, SCHEDULE_GROUPS, serviceDayOf, type Agg, type MenuGroup, type RatingAgg, type ScheduleGroup,
} from "@lodos/shared";
import type { Models } from "../db/models";
import { expensesForMonth, type ByCategory } from "../expenses/service";
import { opsForDays, type DayOps } from "../ops/daily";
import { RANKED_GROUPS, rankingForDays, type RankedGroup, type Row } from "../performance/service";
import { BOM, byHourOf, csvField, lira } from "../sales/service";
import { ensureSummaries, type SummaryData } from "../sales/summary";
import { monthlyPnl, type Pnl } from "./pnl";

/**
 * The monthly business dashboard (spec §8): every figure of the month next to the same figure for the comparison
 * days (plan ruling "Month"). Presentation-free: the web page, the PDF and the CSV all read this. Run inside the tenant.
 */

type Name = { en: string; tr: string };
export type Pair<T> = { cur: T; prev: T };
export type Period = { month: string; from: string | null; to: string | null; days: number };

export type SalesPatterns = {
  byDay: Pair<{ day: string; revenue: number; covers: number; checks: number }[]>;
  /** ISO weekday 1 (Monday) … 7: revenue, open nights and revenue per open night. */
  byWeekday: Pair<{ weekday: number; revenue: number; nights: number; avg: number }[]>;
  /** Revenue per open night by Istanbul hour, service-hour order. */
  byHour: Pair<{ hour: number; revenue: number }[]>;
  avgCheck: Pair<number>;
  avgCover: Pair<number>;
  covers: Pair<number>;
  /** Sales ÷ clocked hours (kuruş per hour); null with no hours. */
  salesPerLabourHour: Pair<number | null>;
  /** Checks ÷ active tables ÷ open nights, two decimals; null with no tables or no open nights. */
  turnsPerNight: Pair<number | null>;
};

export type MenuRow = {
  itemId: string | null;
  name: Name;
  qty: number;
  revenue: number;
  ratingAvg: number | null;
  ratingCount: number;
  group: MenuGroup | null;
  prev: { qty: number; revenue: number; ratingAvg: number | null; ratingCount: number };
};

export type StaffRow = Row & { group: RankedGroup; labourCost: number; prev: { score: number | null; minutes: number; labourCost: number } };
export type WeekRatings = { week: string; restaurant: number | null; food: number | null; cleanliness: number | null; atmosphere: number | null; count: number };
export type MonthComment = { id: string; comment: string; at: string; serviceDay: string };
export type BigExpense = { id: string; amount: number; date: string; payee: string | null; note: string | null; categoryId: string; category: Name };

export type MonthlyView = {
  month: string;
  soFar: boolean;
  current: Period;
  previous: Period;
  pnl: Pair<Pnl>;
  sales: SalesPatterns;
  menu: MenuRow[];
  staff: StaffRow[];
  labourByGroup: Pair<Record<ScheduleGroup, number>>;
  overtimeMinutes: Pair<number>;
  ratings: {
    restaurant: Pair<number | null>;
    food: Pair<number | null>;
    cleanliness: Pair<number | null>;
    atmosphere: Pair<number | null>;
    /** Stars 1–5 counts: the three restaurant categories together, all waiter ratings, all dish ratings. */
    dist: { restaurant: Pair<Agg["dist"]>; waiter: Pair<Agg["dist"]>; dish: Pair<Agg["dist"]> };
    /** Monday-to-Sunday weeks touching the period; `count` is the week's restaurant-category ratings. */
    byWeek: Pair<WeekRatings[]>;
    comments: MonthComment[];
  };
  expenses: { byCategory: Pair<ByCategory[]>; total: Pair<number>; budgetTotal: number; biggest: BigExpense[] };
};

const COMMENTS = 10;
const BIGGEST = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyRatings = (): RatingAgg => ({ waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() });
const ratingsOf = (ops: DayOps[]) => ops.reduce((a, d) => mergeRatingAgg(a, d.ratings), emptyRatings());
const period = (month: string, days: string[]): Period => ({ month, from: days[0] ?? null, to: days.at(-1) ?? null, days: days.length });
const isoWeekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

function salesOf(days: SummaryData[], ops: DayOps[], tables: number) {
  const revenue = days.reduce((n, d) => n + d.revenue, 0);
  const covers = days.reduce((n, d) => n + d.covers, 0);
  const checks = days.reduce((n, d) => n + d.checks, 0);
  const minutes = ops.reduce((n, d) => n + d.people.reduce((m, p) => m + p.minutes, 0), 0);
  const nights = days.filter((d) => d.checks > 0).length;
  const byWeekday = Array.from({ length: 7 }, (_, i) => {
    const mine = days.filter((d) => isoWeekday(d.serviceDay) === i + 1);
    const rev = mine.reduce((n, d) => n + d.revenue, 0);
    const open = mine.filter((d) => d.checks > 0).length;
    return { weekday: i + 1, revenue: rev, nights: open, avg: open > 0 ? Math.round(rev / open) : 0 };
  });
  return {
    byDay: days.map((d) => ({ day: d.serviceDay, revenue: d.revenue, covers: d.covers, checks: d.checks })),
    byWeekday,
    byHour: byHourOf(days),
    avgCheck: checks > 0 ? Math.round(revenue / checks) : 0,
    avgCover: covers > 0 ? Math.round(revenue / covers) : 0,
    covers,
    salesPerLabourHour: minutes > 0 ? Math.round((revenue * 60) / minutes) : null,
    turnsPerNight: tables > 0 && nights > 0 ? round2(checks / tables / nights) : null,
  };
}

/** Pairs every field of two records of the same shape. */
function paired<T extends Record<string, unknown>>(cur: T, prev: T): { [K in keyof T]: Pair<T[K]> } {
  return Object.fromEntries(Object.keys(cur).map((k) => [k, { cur: cur[k], prev: prev[k] }])) as { [K in keyof T]: Pair<T[K]> };
}

/**
 * Dishes sold, with their ratings. Summary items and dish ratings join by item id; generated rows (no id) fall
 * back to the English name, resolved to the id another row of that name carries.
 */
function menuOf(cur: { days: SummaryData[]; ratings: RatingAgg }, prev: { days: SummaryData[]; ratings: RatingAgg }): MenuRow[] {
  const idByName = new Map<string, string>();
  for (const x of [cur, prev]) {
    for (const r of [...x.days.flatMap((d) => d.items), ...x.ratings.dishes]) if (r.itemId) idByName.set(r.name.en, r.itemId);
  }
  const keyOf = (r: { itemId: string | null; name: Name }) => r.itemId ?? idByName.get(r.name.en) ?? `name:${r.name.en}`;
  const tally = (x: typeof cur) => {
    const items = new Map<string, { itemId: string | null; name: Name; qty: number; revenue: number }>();
    for (const i of x.days.flatMap((d) => d.items)) {
      const k = keyOf(i);
      const it = items.get(k) ?? { itemId: i.itemId ?? idByName.get(i.name.en) ?? null, name: { en: i.name.en, tr: i.name.tr }, qty: 0, revenue: 0 };
      it.qty += i.qty;
      it.revenue += i.revenue;
      items.set(k, it);
    }
    const ratings = new Map<string, Agg>();
    for (const d of x.ratings.dishes) ratings.set(keyOf(d), mergeAgg(ratings.get(keyOf(d)) ?? emptyAgg(), d));
    return { items, ratings };
  };
  const c = tally(cur);
  const p = tally(prev);
  const rows = [...c.items]
    .map(([k, it]) => {
      const r = c.ratings.get(k) ?? emptyAgg();
      const pi = p.items.get(k);
      const pr = p.ratings.get(k) ?? emptyAgg();
      return {
        ...it,
        ratingAvg: avgOf(r),
        ratingCount: r.count,
        group: null as MenuGroup | null,
        prev: { qty: pi?.qty ?? 0, revenue: pi?.revenue ?? 0, ratingAvg: avgOf(pr), ratingCount: pr.count },
      };
    })
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.en.localeCompare(b.name.en));
  menuQuadrant(rows).forEach((g, i) => (rows[i]!.group = g));
  return rows;
}

function ratingsSection(r: RatingAgg) {
  const dist = (aggs: Agg[]) => aggs.reduce(mergeAgg, emptyAgg()).dist;
  return {
    restaurant: restaurantRating(r),
    food: avgOf(r.food),
    cleanliness: avgOf(r.cleanliness),
    atmosphere: avgOf(r.atmosphere),
    dist: { restaurant: dist([r.food, r.cleanliness, r.atmosphere]), waiter: dist(r.waiter), dish: dist(r.dishes) },
  };
}

function byWeekOf(days: string[], ops: Map<string, DayOps>): WeekRatings[] {
  const weeks = [...new Set(days.map(mondayOf))];
  return weeks.map((week) => {
    const r = ratingsOf(days.filter((d) => mondayOf(d) === week).map((d) => ops.get(d)!));
    return {
      week,
      restaurant: restaurantRating(r),
      food: avgOf(r.food),
      cleanliness: avgOf(r.cleanliness),
      atmosphere: avgOf(r.atmosphere),
      count: r.food.count + r.cleanliness.count + r.atmosphere.count,
    };
  });
}

function labourOf(ops: DayOps[], roleOf: Map<string, string>) {
  const byGroup = Object.fromEntries(SCHEDULE_GROUPS.map((g) => [g, 0])) as Record<ScheduleGroup, number>;
  const byPerson = new Map<string, number>();
  let overtime = 0;
  for (const p of ops.flatMap((d) => d.people)) {
    const g = scheduleGroupOf(roleOf.get(p.staffId) ?? "");
    if (g) byGroup[g] += p.labourCost;
    byPerson.set(p.staffId, (byPerson.get(p.staffId) ?? 0) + p.labourCost);
    overtime += p.overtimeMinutes;
  }
  return { byGroup, byPerson, overtime };
}

async function commentsOf(models: Models, days: string[]): Promise<MonthComment[]> {
  if (days.length === 0) return [];
  const docs = await models.Rating.find(
    { serviceDay: { $in: days }, commentHidden: false, comment: { $nin: [null, ""] } },
    { comment: 1, submittedAt: 1, serviceDay: 1 },
  ).sort({ submittedAt: -1, _id: -1 }).limit(COMMENTS).lean();
  return docs.map((d) => ({ id: String(d._id), comment: d.comment!, at: d.submittedAt.toISOString(), serviceDay: d.serviceDay }));
}

async function biggestOf(models: Models, month: string): Promise<BigExpense[]> {
  const [rows, cats] = await Promise.all([
    models.Expense.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ amount: -1, date: 1, _id: 1 }).limit(BIGGEST).lean(),
    models.ExpenseCategory.find({}, { name: 1 }).lean(),
  ]);
  const nameOf = new Map(cats.map((c) => [String(c._id), { en: c.name.en, tr: c.name.tr }]));
  return rows.map((e) => ({
    id: String(e._id), amount: e.amount, date: e.date, payee: e.payee ?? null, note: e.note ?? null,
    categoryId: String(e.categoryId), category: nameOf.get(String(e.categoryId)) ?? { en: "", tr: "" },
  }));
}

export async function monthlyView(models: Models, month: string, now: Date): Promise<MonthlyView> {
  const today = serviceDayOf(now);
  const curDays = monthDays(month, today);
  const prevDays = comparisonDays(month, today);
  const prevMonth = previousMonth(month);
  // Store the missing past summaries once, before the readers below ask for the same days in parallel.
  const summaries = await ensureSummaries(models, [...curDays, ...prevDays], today);
  const [pnlCur, pnlPrev, ops, tables, staff, rankCur, rankPrev, comments, spendCur, spendPrev, biggest] = await Promise.all([
    monthlyPnl(models, month, now, curDays),
    monthlyPnl(models, prevMonth, now, prevDays),
    opsForDays(models, [...curDays, ...prevDays], now),
    models.Table.countDocuments({ active: true }),
    models.Staff.find({}, { role: 1 }).lean(),
    rankingForDays(models, curDays, now),
    rankingForDays(models, prevDays, now),
    commentsOf(models, curDays),
    expensesForMonth(models, month),
    // No comparison days (a future month): the categories with nothing spent.
    expensesForMonth(models, prevMonth, prevDays.at(-1) ?? `${prevMonth}-00`),
    biggestOf(models, month),
  ]);
  const sumOf = (days: string[]) => days.map((d) => summaries.get(d)!);
  const opsOf = (days: string[]) => days.map((d) => ops.get(d)!);
  const roleOf = new Map(staff.map((s) => [String(s._id), s.role as string]));
  const labourCur = labourOf(opsOf(curDays), roleOf);
  const labourPrev = labourOf(opsOf(prevDays), roleOf);
  const ratingsCur = ratingsOf(opsOf(curDays));
  const ratingsPrev = ratingsOf(opsOf(prevDays));
  const r = paired(ratingsSection(ratingsCur), ratingsSection(ratingsPrev));
  const prevRows = new Map(RANKED_GROUPS.flatMap((g) => rankPrev[g]).map((row) => [row.staffId, row]));
  const total = (s: { byCategory: ByCategory[] }) => s.byCategory.reduce((n, c) => n + c.spent, 0);

  return {
    month,
    soFar: month === today.slice(0, 7),
    current: period(month, curDays),
    previous: period(prevMonth, prevDays),
    pnl: { cur: pnlCur, prev: pnlPrev },
    sales: paired(salesOf(sumOf(curDays), opsOf(curDays), tables), salesOf(sumOf(prevDays), opsOf(prevDays), tables)),
    menu: menuOf({ days: sumOf(curDays), ratings: ratingsCur }, { days: sumOf(prevDays), ratings: ratingsPrev }),
    staff: RANKED_GROUPS.flatMap((group) =>
      rankCur[group].map((row) => ({
        ...row,
        group,
        labourCost: labourCur.byPerson.get(row.staffId) ?? 0,
        prev: { score: prevRows.get(row.staffId)?.score ?? null, minutes: prevRows.get(row.staffId)?.minutes ?? 0, labourCost: labourPrev.byPerson.get(row.staffId) ?? 0 },
      })),
    ),
    labourByGroup: { cur: labourCur.byGroup, prev: labourPrev.byGroup },
    overtimeMinutes: { cur: labourCur.overtime, prev: labourPrev.overtime },
    ratings: {
      restaurant: r.restaurant,
      food: r.food,
      cleanliness: r.cleanliness,
      atmosphere: r.atmosphere,
      dist: {
        restaurant: { cur: r.dist.cur.restaurant, prev: r.dist.prev.restaurant },
        waiter: { cur: r.dist.cur.waiter, prev: r.dist.prev.waiter },
        dish: { cur: r.dist.cur.dish, prev: r.dist.prev.dish },
      },
      byWeek: { cur: byWeekOf(curDays, ops), prev: byWeekOf(prevDays, ops) },
      comments,
    },
    expenses: {
      byCategory: { cur: spendCur.byCategory, prev: spendPrev.byCategory },
      total: { cur: total(spendCur), prev: total(spendPrev) },
      budgetTotal: spendCur.byCategory.reduce((n, c) => n + c.budget, 0),
      biggest,
    },
  };
}

// --- CSV --------------------------------------------------------------------------------------------------------

export const CSV_SECTIONS = ["menu", "staff", "expenses", "days"] as const;
export type CsvSection = (typeof CSV_SECTIONS)[number];

const fixed = (n: number | null, digits: number) => (n === null ? "" : n.toFixed(digits));

/** One table of the monthly page (the current period) as CSV: a BOM, CRLF lines, money as plain lira. */
export function monthlyCsv(view: MonthlyView, section: CsvSection): { filename: string; body: string } {
  const lines: string[] = [];
  if (section === "menu") {
    lines.push("item_en,item_tr,group,group_en,group_tr,qty,revenue_lira,rating_avg,rating_count");
    for (const d of view.menu) {
      const label = d.group ? MENU_GROUP_LABELS[d.group] : { en: "", tr: "" };
      lines.push([csvField(d.name.en), csvField(d.name.tr), csvField(d.group ?? ""), csvField(label.en), csvField(label.tr), d.qty, lira(d.revenue), fixed(d.ratingAvg, 2), d.ratingCount].join(","));
    }
  } else if (section === "staff") {
    lines.push("name,role,group,score,rating_avg,rating_count,hours,planned_hours,late_shifts,labour_cost_lira");
    for (const s of view.staff) {
      lines.push([csvField(s.name), csvField(s.role), csvField(s.group), fixed(s.score, 1), fixed(s.ratingAvg, 2), s.ratingCount, fixed(s.minutes / 60, 1), fixed(s.plannedMinutes / 60, 1), s.lateShifts, lira(s.labourCost)].join(","));
    }
  } else if (section === "expenses") {
    lines.push("category_en,category_tr,kind,spent_lira,budget_lira");
    for (const c of view.expenses.byCategory.cur) lines.push([csvField(c.name.en), csvField(c.name.tr), csvField(c.kind), lira(c.spent), lira(c.budget)].join(","));
  } else {
    lines.push("service_day,weekday,revenue_lira,covers,checks");
    for (const d of view.sales.byDay.cur) lines.push([csvField(d.day), isoWeekday(d.day), lira(d.revenue), d.covers, d.checks].join(","));
  }
  return { filename: `lodos-${section}-${view.month}.csv`, body: BOM + lines.join("\r\n") + "\r\n" };
}
