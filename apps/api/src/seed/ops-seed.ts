import {
  addDays, addStar, allocateOvertime, emptyAgg, entryCost, mondayOf, monthDays, monthLength, previousMonth, rateAt, serviceDayOf,
  serviceDayStartOf, shiftSpan, type Agg, type RatingAgg, type ShiftArea, type StaffRole,
} from "@lodos/shared";
import { Types } from "mongoose";
import type { Models } from "../db/models";
import { runWithTenant } from "../db/tenancy";
import { startingCategories } from "../expenses/service";
import type { PersonOps } from "../ops/daily";
import { generateHistory, HISTORY_DAYS, type HistoryItem } from "../sales/history";
import type { SummaryData } from "../sales/summary";
import { SEED_SHIFTS } from "./content";

/**
 * The phase 3 demo seed (spec §9, §13.1–13.2): hourly rates and clock PINs, about four months of clock entries and
 * guest ratings on top of P2's generated sales history, four months of expenses, and today's staff states anchored
 * to `now`. Seeded history is raw for the last days and aggregated before that, and nothing is counted twice:
 * - ratings: raw `Rating` documents for the last 14 days, `DailySummary.ratings` before. Each seeded comment is a raw
 *   rating on its own day (spec §13.1), left out of that day's aggregate, so the ops reader's merge stays exact;
 * - hours: raw `ClockEntry` documents for the last 35 days, `DailySummary.people` labour before. Every past `Shift`
 *   is stored (planned hours); the labour reader ignores the shifts of days whose labour is aggregated.
 * The generated days have no raw tickets, so their station ticket credit is always on `people`. Dish ratings are
 * credited there when the ops reader can't: aggregated ratings, and raw ones on days without raw clock entries.
 * Every figure is built once, per entry and per rating, then either stored raw or summed, so both read the same.
 */

export const RAW_RATING_DAYS = 14;
export const RAW_CLOCK_DAYS = 35;
export const DEMO_CLOCK_PIN = "1111";

export type OpsStaff = { id: Types.ObjectId; name: string; role: StaffRole };
export type ShiftDoc = { staffId: Types.ObjectId; serviceDay: string; start: Date; end: Date; area: ShiftArea; note: string | null };

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Hourly rates in lira (stored ×100 in kuruş). Mert's goes up 20 days before `now`. */
const RATE_LIRA: Record<string, number> = {
  Deniz: 215, Mert: 185, "Emre Yıldız": 250, "Zeynep Arslan": 235, "Burak Şahin": 205, "Ece Demir": 225, "Can Özkan": 195,
  "İpek Aydın": 160, "Hasan Kılıç": 155, Selin: 320,
};
const RATE_CHANGE = { name: "Mert", daysAgo: 20, lira: 200 };

/** The demo rate history of a person on the schedule; empty for the station accounts. */
export function demoRates(name: string, now: Date): { from: Date; kurusPerHour: number }[] {
  const lira = RATE_LIRA[name];
  if (lira === undefined) return [];
  const rates = [{ from: new Date(now.getTime() - 365 * DAY_MS), kurusPerHour: lira * 100 }];
  if (name === RATE_CHANGE.name) rates.push({ from: new Date(now.getTime() - RATE_CHANGE.daysAgo * DAY_MS), kurusPerHour: RATE_CHANGE.lira * 100 });
  return rates;
}

/** The expense budgets in kuruş, by category (English name). */
export const DEMO_BUDGETS: Record<string, number> = {
  "Suppliers – food": 380_000_00, "Suppliers – drinks": 190_000_00, Rent: 220_000_00, Utilities: 90_000_00,
  "Repairs and maintenance": 60_000_00, Marketing: 40_000_00, Other: 30_000_00,
};

/**
 * Past weeks repeat the seeded schedule's regular week (P2's week 1). The week 3 weeks before the current one repeats
 * its 47 h week (week 0) instead, so Ece Demir earns overtime there besides P2's current 47 h week (spec §9: one or
 * two overtime weeks). It lies wholly inside the raw clock window for any `now`, so its overtime never straddles raw
 * entries and aggregates.
 */
const OVERTIME_WEEK_AGO = 3;
const LATE_SHARE = 0.08;
const FORGOT_DAYS_AGO = 10;

/** Who shows each of today's states (role → seeded person). */
const TODAY = { waiter: "Deniz", cook: "Zeynep Arslan", bartender: "Can Özkan", host: "İpek Aydın", dishwasher: "Hasan Kılıç" } as const;

const STATION_OF_ROLE: Partial<Record<StaffRole, "kitchen" | "bar">> = { cook: "kitchen", bartender: "bar" };

/** Waiter rating targets; anyone else serving averages 4.5. */
const WAITER_MEAN: Record<string, number> = { Deniz: 4.8, Mert: 4.4 };
const CATEGORY_MEAN = { food: 4.5, cleanliness: 4.6, atmosphere: 4.7 } as const;
/**
 * Dish rating targets. The menu has no Mantı, so the grilled octopus (a popular signature) is the "Fix" dish;
 * the pistachio baklava (rated high, sold little) is the hidden gem and the carpaccio the dish to rethink.
 */
const DISH_MEAN: Record<string, number> = {
  "grilled-octopus": 3.4, "pistachio-baklava": 4.8, "beef-carpaccio": 3.5,
  "dry-aged-ribeye": 4.7, burrata: 4.7, "lodos-negroni": 4.6, "lamb-chops": 4.6, "truffle-fries": 4.6, spritz: 4.5, "red-wine-glass": 4.5,
};
const RATED_SHARE: [number, number] = [0.3, 0.4];

/** About 15 comments, English and Turkish; the rude one is hidden by the manager. */
const COMMENTS: { text: string; hidden?: boolean; low?: boolean }[] = [
  { text: "Best ribeye I've had in Istanbul. Our waiter was lovely." },
  { text: "Burrata çok tazeydi, servis de çok hızlıydı." },
  { text: "Lovely room and great cocktails. We'll be back." },
  { text: "Ahtapot biraz sertti ama geri kalan her şey harikaydı.", low: true },
  { text: "The Negroni alone is worth the trip." },
  { text: "Garsonumuz çok ilgiliydi, şarap önerisi tam yerindeydi." },
  { text: "A bit noisy on a Saturday night, but the food made up for it." },
  { text: "Fıstıklı baklava efsane, mutlaka deneyin!" },
  { text: "The octopus was a little chewy tonight.", low: true },
  { text: "Temiz, şık ve sıcak bir ortam. Teşekkürler." },
  { text: "We waited a while for the mains, but they were worth it." },
  { text: "Kuzu pirzola mükemmel pişmişti." },
  { text: "Friendly staff and a great wine list." },
  { text: "Tatlılar biraz geç geldi, yine de çok memnun kaldık." },
  { text: "Worst night ever, the waiter was useless!!! Never again!!!", hidden: true, low: true },
];

type Star = 1 | 2 | 3 | 4 | 5;
type Station = "kitchen" | "bar";

/** Star probabilities (1…5) with the given mean: small fixed low tails, the rest split between 4 and 5. */
function starDist(mean: number): number[] {
  const [p1, p2, p3] = mean > 4.6 ? [0, 0.01, 0.02] : mean >= 4 ? [0.01, 0.02, 0.05] : mean >= 3.75 ? [0.02, 0.05, 0.2] : [0.05, 0.12, 0.35];
  const rest = 1 - p1 - p2 - p3;
  const p5 = Math.min(rest, Math.max(0, mean - (p1 + 2 * p2 + 3 * p3) - 4 * rest));
  return [p1, p2, p3, rest - p5, p5];
}

type Entry = {
  id: string;
  staffId: string;
  serviceDay: string;
  in: Date;
  out: Date;
  late: boolean;
  rate: number;
  minutes: number;
  overtimeMinutes: number;
  cost: number;
  forgot: boolean;
};

type RatingRecord = {
  serviceDay: string;
  paidAt: Date;
  serverStaffId: string | null;
  waiter: Star | null;
  dishes: { itemId: string; name: { en: string; tr: string }; station: Station; stars: Star }[];
  food: Star | null;
  cleanliness: Star | null;
  atmosphere: Star | null;
  comment?: (typeof COMMENTS)[number];
};

export async function seedOps(
  models: Models,
  a: { tenantId: string; now: Date; staff: OpsStaff[]; items: HistoryItem[]; tables: string[]; schedule: ShiftDoc[]; rand: () => number },
): Promise<void> {
  const { now, staff, items, rand } = a;
  const t = now.getTime();
  const today = serviceDayOf(now);
  const monday = mondayOf(today);
  const first = addDays(today, -HISTORY_DAYS);
  const rawClockFrom = addDays(today, -RAW_CLOCK_DAYS);
  const rawRatingFrom = addDays(today, -RAW_RATING_DAYS);
  const dayStart = serviceDayStartOf(today).getTime();

  const byId = new Map(staff.map((s) => [String(s.id), s]));
  const person = (name: string) => {
    const s = staff.find((x) => x.name === name);
    if (!s) throw new Error(`unknown person ${name}`);
    return s;
  };
  const manager = person("Selin");
  const rates = new Map(staff.map((s) => [String(s.id), demoRates(s.name, now)]));
  const rateOf = (staffId: string, at: Date) => rateAt(rates.get(staffId) ?? [], at);
  const itemById = new Map(items.map((i, index) => [String(i.id), { ...i, mean: DISH_MEAN[i.slug] ?? 4.1 + (index % 5) * 0.1 }]));

  const pick = <T>(xs: readonly T[], weight: (x: T) => number): T | null => {
    const total = xs.reduce((n, x) => n + weight(x), 0);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const x of xs) {
      r -= weight(x);
      if (r < 0) return x;
    }
    return xs.findLast((x) => weight(x) > 0) ?? null;
  };
  const star = (mean: number): Star => {
    const d = starDist(mean);
    let r = rand();
    for (let i = 0; i < 4; i++) {
      r -= d[i]!;
      if (r < 0) return (i + 1) as Star;
    }
    return 5;
  };
  const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  // --- Hours ----------------------------------------------------------------------------------------------------
  // Shifts before today: the current week's from the seeded schedule, earlier weeks from its patterns.
  const weekPattern = (weekMonday: string, week: 0 | 1): ShiftDoc[] =>
    SEED_SHIFTS.filter((p) => p.weeks.includes(week)).flatMap((p) =>
      p.days.map((d) => {
        const serviceDay = addDays(weekMonday, d);
        return { staffId: person(p.name).id, serviceDay, ...shiftSpan(serviceDay, p.start, p.end), area: p.area, note: p.note ?? null };
      }),
    );
  const pastShifts: ShiftDoc[] = [];
  for (let k = 1; addDays(monday, -7 * k + 6) >= first; k++) {
    pastShifts.push(...weekPattern(addDays(monday, -7 * k), k === OVERTIME_WEEK_AGO ? 0 : 1).filter((s) => s.serviceDay >= first));
  }
  const nameOf = (s: ShiftDoc) => byId.get(String(s.staffId))?.name ?? "";
  const byStart = (x: ShiftDoc, y: ShiftDoc) => x.start.getTime() - y.start.getTime() || nameOf(x).localeCompare(nameOf(y));
  const worked = [...pastShifts, ...a.schedule.filter((s) => s.serviceDay >= monday && s.serviceDay < today)].sort(byStart);

  // One entry per shift: about 8 % late by 6–25 min, the rest a little early or on time; out up to 15 min over.
  const forgotDay = addDays(today, -FORGOT_DAYS_AGO);
  let forgotSet = false;
  const entries: Entry[] = worked.map((s, i) => {
    const late = rand() < LATE_SHARE;
    const inAt = new Date(s.start.getTime() + (late ? randInt(6, 25) : randInt(-10, 2)) * MIN_MS);
    const forgot = !forgotSet && s.serviceDay >= forgotDay;
    if (forgot) forgotSet = true;
    // A forgotten clock-out is fixed by the manager to the shift's end (+10 min).
    const out = new Date(s.end.getTime() + (forgot ? 10 : randInt(-5, 15)) * MIN_MS);
    const staffId = String(s.staffId);
    return {
      id: String(i), staffId, serviceDay: s.serviceDay, in: inAt, out, late, rate: rateOf(staffId, inAt),
      minutes: Math.round((out.getTime() - inAt.getTime()) / MIN_MS), overtimeMinutes: 0, cost: 0, forgot,
    };
  });
  const overtime = allocateOvertime(entries);
  for (const e of entries) {
    e.overtimeMinutes = overtime.get(e.id) ?? 0;
    e.cost = entryCost(e.minutes, e.overtimeMinutes, e.rate);
  }
  const entriesOn = new Map<string, Entry[]>();
  for (const e of entries) entriesOn.set(e.serviceDay, [...(entriesOn.get(e.serviceDay) ?? []), e]);
  const stationOf = (staffId: string) => {
    const role = byId.get(staffId)?.role;
    return role ? STATION_OF_ROLE[role] : undefined;
  };
  /** The station's people clocked in at `at` (as the ops reader attributes tickets and dish ratings). */
  const onDuty = (day: string, station: Station, at: number) => [
    ...new Set((entriesOn.get(day) ?? []).filter((e) => stationOf(e.staffId) === station && e.in.getTime() <= at && at < e.out.getTime()).map((e) => e.staffId)),
  ];
  /** The instant of Istanbul hour `hour` in service day `day`. */
  const hourAt = (day: string, hour: number) => serviceDayStartOf(day).getTime() + ((hour - 6 + 24) % 24) * HOUR_MS;

  // --- Ratings --------------------------------------------------------------------------------------------------
  /** About a third of the day's checks rate their visit: the server of the check, one to three dishes, the room. */
  const ratingsFor = (d: SummaryData): RatingRecord[] => {
    if (d.checks === 0) return [];
    const n = Math.round(d.checks * (RATED_SHARE[0] + rand() * (RATED_SHARE[1] - RATED_SHARE[0])));
    const hours = d.byHour.map((h) => ({ hour: h.hour, left: h.checks }));
    const servers = d.byServer.map((s) => ({ staffId: s.staffId, left: s.checks }));
    const units = d.items.flatMap((i) => (i.itemId && itemById.has(i.itemId) ? [{ item: itemById.get(i.itemId)!, name: i.name, left: i.qty }] : []));
    const out: RatingRecord[] = [];
    for (let k = 0; k < n; k++) {
      const h = pick(hours, (x) => x.left);
      if (!h) break;
      h.left -= 1;
      const paidAt = new Date(hourAt(d.serviceDay, h.hour) + randInt(0, 59) * MIN_MS);
      const server = pick(servers, (x) => x.left);
      if (server) server.left -= 1;
      const waiter = server && rand() < 0.92 ? star(WAITER_MEAN[byId.get(server.staffId)?.name ?? ""] ?? 4.5) : null;
      const dishes: RatingRecord["dishes"] = [];
      for (let j = randInt(1, 3); j > 0; j--) {
        const u = pick(units, (x) => (dishes.some((y) => y.itemId === String(x.item.id)) ? 0 : x.left));
        if (!u) break;
        u.left -= 1;
        dishes.push({ itemId: String(u.item.id), name: { en: u.name.en, tr: u.name.tr }, station: u.item.station, stars: star(u.item.mean) });
      }
      const cat = (mean: number) => (rand() < 0.95 ? star(mean) : null);
      out.push({
        serviceDay: d.serviceDay, paidAt, serverStaffId: server?.staffId ?? null, waiter, dishes,
        food: cat(CATEGORY_MEAN.food), cleanliness: cat(CATEGORY_MEAN.cleanliness), atmosphere: cat(CATEGORY_MEAN.atmosphere),
      });
    }
    return out;
  };

  // About one comment every 8 days over the whole history (at least 3 in every full month), on an open day.
  const commentOn = new Map(
    COMMENTS.map((c, i) => {
      const day = addDays(first, Math.floor(((i + 0.5) * HISTORY_DAYS) / COMMENTS.length));
      return [dow(day) === 1 ? addDays(day, 1) : day, c] as const;
    }),
  );
  const rawRatings: RatingRecord[] = [];
  const emptyPerson = (staffId: string): PersonOps => ({
    staffId, minutes: 0, overtimeMinutes: 0, labourCost: 0, shifts: 0, lateShifts: 0, stationTickets: 0, stationOnTime: 0, dishRatingSum: 0, dishRatingCount: 0,
  });

  /** A generated day's aggregates: labour before the raw clock window, ratings before the raw rating window. */
  const extend = (d: SummaryData): { ratings?: RatingAgg; people?: PersonOps[] } => {
    const day = d.serviceDay;
    const people = new Map<string, PersonOps>();
    const row = (staffId: string) => people.get(staffId) ?? people.set(staffId, emptyPerson(staffId)).get(staffId)!;
    if (day < rawClockFrom) {
      for (const e of entriesOn.get(day) ?? []) {
        const r = row(e.staffId);
        r.minutes += e.minutes;
        r.overtimeMinutes += e.overtimeMinutes;
        r.labourCost += e.cost;
        r.shifts += 1;
        if (e.late) r.lateShifts += 1;
      }
    }
    // Each hour's tickets, credited at mid-hour to the station's people clocked in, split equally.
    for (const station of ["kitchen", "bar"] as const) {
      for (const h of d.ticketTimes[station]) {
        const ids = onDuty(day, station, hourAt(day, h.hour) + 30 * MIN_MS);
        for (const id of ids) {
          row(id).stationTickets += h.count / ids.length;
          row(id).stationOnTime += h.onTime / ids.length;
        }
      }
    }
    const records = ratingsFor(d);
    const comment = commentOn.get(day);
    if (comment && records.length > 0) records[randInt(0, records.length - 1)]!.comment = comment;
    let ratings: RatingAgg | undefined;
    if (day >= rawRatingFrom) {
      rawRatings.push(...records);
    } else {
      // An older day: its comment's rating is raw and the rest aggregated. The ops reader credits the raw rating's
      // dishes itself only on days with raw clock entries.
      rawRatings.push(...records.filter((r) => r.comment));
      ratings = aggregate(records.filter((r) => !r.comment));
      for (const r of records) {
        if (r.comment && day >= rawClockFrom) continue;
        for (const x of r.dishes) {
          const ids = onDuty(day, x.station, r.paidAt.getTime());
          for (const id of ids) {
            row(id).dishRatingSum += x.stars / ids.length;
            row(id).dishRatingCount += 1 / ids.length;
          }
        }
      }
    }
    return { ...(ratings ? { ratings } : {}), people: [...people.values()] };
  };

  // Each day's waiters: those with a shift that day, by name.
  const servers = (day: string) =>
    [...new Set(worked.filter((s) => s.serviceDay === day && byId.get(String(s.staffId))?.role === "waiter").map((s) => String(s.staffId)))].sort(
      (x, y) => (byId.get(x)?.name ?? "").localeCompare(byId.get(y)?.name ?? ""),
    );

  await generateHistory(models, { tenantId: a.tenantId, now, items, tables: a.tables, staff, ops: { servers, extend } });

  const ratingDocs = rawRatings.map((r) => {
    const c = r.comment;
    const low = (s: Star | null) => (c?.low && s !== null ? (Math.min(s, 3) as Star) : s);
    return {
      checkId: null, tableId: null, serviceDay: r.serviceDay, paidAt: r.paidAt,
      submittedAt: new Date(r.paidAt.getTime() + randInt(3, 25) * MIN_MS),
      serverStaffId: r.serverStaffId ? new Types.ObjectId(r.serverStaffId) : null,
      waiter: c?.hidden ? low(r.waiter) : r.waiter,
      dishes: r.dishes.map((x) => ({ ...x, itemId: new Types.ObjectId(x.itemId) })),
      food: low(r.food), cleanliness: r.cleanliness, atmosphere: r.atmosphere,
      comment: c?.text ?? null, commentHidden: c?.hidden ?? false, generated: true,
    };
  });

  // --- Today ----------------------------------------------------------------------------------------------------
  // Every "who's working" state relative to `now`, never before the service day's start.
  // The shifts are short (at most 4 h) so nobody's week crosses 45 h because of them: Ece keeps the only warning.
  // The bartender is due in 3 h, or just before the service day ends when that is sooner.
  const clampIn = (ms: number) => Math.max(dayStart, ms);
  const due = Math.min(t + 3 * HOUR_MS, dayStart + DAY_MS - 30 * MIN_MS);
  const washStart = clampIn(t - 9 * HOUR_MS);
  const plan = {
    waiter: { start: clampIn(t - 2 * HOUR_MS), end: t + 90 * MIN_MS, area: "salon" as const },
    cook: { start: clampIn(t - 90 * MIN_MS), end: t + 90 * MIN_MS, area: "kitchen" as const },
    bartender: { start: due, end: due + 4 * HOUR_MS, area: "bar" as const },
    host: { start: clampIn(t - 20 * MIN_MS), end: t + 3 * HOUR_MS, area: "salon" as const },
    dishwasher: { start: washStart, end: Math.max(washStart + 30 * MIN_MS, Math.min(washStart + 4 * HOUR_MS, t - 30 * MIN_MS)), area: "kitchen" as const },
  };
  const anchored = new Set(Object.values(TODAY).map((n) => String(person(n).id)));
  const todayShifts: ShiftDoc[] = (Object.keys(TODAY) as (keyof typeof TODAY)[]).map((role) => ({
    staffId: person(TODAY[role]).id, serviceDay: today, start: new Date(plan[role].start), end: new Date(plan[role].end), area: plan[role].area, note: null,
  }));
  // No seeded time is ever after `now`: just after 06:00 an entry starts or ends at `now` (some states can't exist yet).
  const todayIn = (name: string, inMs: number, outMs: number | null) => {
    const staffId = person(name).id;
    const inAt = new Date(Math.min(inMs, t));
    return { staffId, serviceDay: today, in: inAt, out: outMs === null ? null : new Date(Math.min(outMs, t)), rate: rateOf(String(staffId), inAt), edits: [], generated: true };
  };
  const todayEntries = [
    todayIn(TODAY.waiter, plan.waiter.start, null),
    todayIn(TODAY.cook, plan.cook.start + 18 * MIN_MS, null),
    todayIn(TODAY.dishwasher, plan.dishwasher.start, plan.dishwasher.end + 3 * MIN_MS),
  ];
  // Everyone else on today's schedule: in once their shift has started, out once it has ended.
  for (const s of a.schedule.filter((x) => x.serviceDay === today && !anchored.has(String(x.staffId))).sort(byStart)) {
    if (s.start.getTime() > t) continue;
    const out = s.end.getTime() + 4 * MIN_MS;
    todayEntries.push(todayIn(nameOf(s), clampIn(s.start.getTime() - 3 * MIN_MS), out <= t ? out : null));
  }

  const shiftDocs = [
    ...pastShifts,
    ...a.schedule.filter((s) => s.serviceDay !== today || !anchored.has(String(s.staffId))),
    ...todayShifts,
  ];
  const clockDocs = [
    ...entries
      .filter((e) => e.serviceDay >= rawClockFrom)
      .map((e) => ({
        staffId: new Types.ObjectId(e.staffId), serviceDay: e.serviceDay, in: e.in, out: e.out, rate: e.rate, generated: true,
        edits: e.forgot
          ? [{ at: new Date(e.in.getTime() + 20 * HOUR_MS), byStaffId: manager.id, reason: "Forgot to clock out", before: { in: e.in, out: null } }]
          : [],
      })),
    ...todayEntries,
  ];

  const categories = startingCategories(DEMO_BUDGETS);
  const catId = (en: string) => categories.find((c) => c.name.en === en)!._id;
  const expenses = demoExpenses(today, catId, manager.id, rand, randInt);

  // The bulky collections go in lean (complete documents, no Mongoose casting), like the generated summaries.
  await runWithTenant(a.tenantId, async () => {
    await Promise.all([
      models.Shift.insertMany(shiftDocs, { lean: true }),
      models.ClockEntry.insertMany(clockDocs, { lean: true }),
      models.Rating.insertMany(ratingDocs, { lean: true }),
      models.ExpenseCategory.insertMany(categories),
      models.Expense.insertMany(expenses),
    ]);
  });
}

/** Sums rating records into the rollup shape (waiter rows by staff id, dishes by item id, the three categories). */
function aggregate(records: RatingRecord[]): RatingAgg {
  const waiter = new Map<string, Agg>();
  const dishes = new Map<string, Agg & { itemId: string; name: { en: string; tr: string } }>();
  const out: RatingAgg = { waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() };
  for (const r of records) {
    for (const c of ["food", "cleanliness", "atmosphere"] as const) if (r[c] !== null) out[c] = addStar(out[c], r[c]);
    if (r.waiter !== null && r.serverStaffId) waiter.set(r.serverStaffId, addStar(waiter.get(r.serverStaffId) ?? emptyAgg(), r.waiter));
    for (const x of r.dishes) {
      const prev = dishes.get(x.itemId) ?? { ...emptyAgg(), itemId: x.itemId, name: x.name };
      dishes.set(x.itemId, { ...prev, ...addStar(prev, x.stars) });
    }
  }
  out.waiter = [...waiter].map(([staffId, agg]) => ({ staffId, ...agg }));
  out.dishes = [...dishes.values()];
  return out;
}

const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * Four calendar months of a Karaköy bistro's spending (this one so far): supplier deliveries spread over the month,
 * rent on the last day of each month (paid in advance for the next, so this month's is not in yet), utilities around
 * the 20th, marketing every week, and a broken cold room in the last three days that puts Repairs over budget this
 * month once it is the 4th (before that only the compressor is in). Past months stay within every budget. Nothing is
 * dated after today.
 */
function demoExpenses(today: string, catId: (en: string) => Types.ObjectId, createdBy: Types.ObjectId, rand: () => number, randInt: (lo: number, hi: number) => number) {
  const out: { categoryId: Types.ObjectId; amount: number; date: string; payee: string | null; note: string | null; createdBy: Types.ObjectId }[] = [];
  const lira = (n: number) => Math.round(n) * 100;
  const thisMonth = today.slice(0, 7);
  const months = [thisMonth];
  while (months.length < 4) months.unshift(previousMonth(months[0]!));
  for (const month of months) {
    const add = (en: string, day: number, amount: number, payee: string | null, note: string | null) => {
      const date = `${month}-${String(Math.min(day, monthLength(month))).padStart(2, "0")}`;
      if (date <= today) out.push({ categoryId: catId(en), amount, date, payee, note, createdBy });
    };
    const all = monthDays(month, `${month}-31`);
    // Deliveries on fixed weekdays, sized so a whole month spends 77–99 % of the budget.
    const deliveries = (en: string, weekdays: number[], suppliers: [string, string][]) => {
      const days = all.filter((d) => weekdays.includes(dow(d)));
      const each = ((DEMO_BUDGETS[en]! / 100) * (0.86 + rand() * 0.04)) / days.length;
      days.forEach((d, i) => {
        const [payee, note] = suppliers[i % suppliers.length]!;
        add(en, Number(d.slice(8)), lira(each * (0.9 + rand() * 0.2)), payee, note);
      });
    };
    deliveries("Suppliers – food", [2, 4, 6], [
      ["Ege Bahçe Sebze", "Vegetables and herbs"], ["Karaköy Balık Hali", "Fish and seafood"],
      ["Trakya Et", "Meat"], ["Bolu Süt Çiftliği", "Dairy and cheese"],
    ]);
    deliveries("Suppliers – drinks", [3, 6], [["Galata Şarap Evi", "Wine"], ["Boğaz İçecek Dağıtım", "Spirits and mixers"]]);
    add("Rent", monthLength(month), DEMO_BUDGETS.Rent!, "Kemankeş Emlak", "Monthly rent");
    add("Utilities", 18, lira(2_450), "Kuzey Fiber", "Internet");
    add("Utilities", 20, lira(randInt(42_000, 50_000)), "Haliç Enerji", "Electricity");
    add("Utilities", 21, lira(randInt(16_000, 24_000)), "Marmara Doğalgaz", "Gas");
    add("Utilities", 22, lira(randInt(6_500, 9_000)), "İstanbul Su", "Water");
    if (month === thisMonth) {
      const d = Number(today.slice(8));
      add("Repairs and maintenance", Math.max(1, d - 3), lira(48_600), "Soğuk Oda Teknik", "Cold room compressor replaced");
      if (d >= 4) add("Repairs and maintenance", d - 1, lira(14_750), "Usta Tesisat", "Kitchen tap and drain");
    } else {
      add("Repairs and maintenance", 7, lira(randInt(14_000, 22_000)), "Soğuk Oda Teknik", "Cold room service");
      add("Repairs and maintenance", 21, lira(randInt(18_000, 24_000)), "Usta Tesisat", "Plumbing");
    }
    for (let d = 3; d <= monthLength(month); d += 7) {
      add("Marketing", d, lira(randInt(5_500, 6_500)), d % 2 ? null : "Tophane Matbaa", d % 2 ? "Social media ads" : "Printed menus and cards");
    }
    add("Other", 7, lira(randInt(6_000, 9_000)), "Parlak Temizlik", "Cleaning supplies");
    add("Other", 15, lira(randInt(4_000, 6_000)), "Beyaz Çamaşırhane", "Linen laundry");
    add("Other", 25, lira(12_000), "Aylin Kaya", "Accountant");
  }
  return out;
}
