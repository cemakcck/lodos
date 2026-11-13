import { istanbulDateTime, istanbulHour, SERVICE_HOURS, serviceDayOf, serviceDayStartOf, serviceHourIndex, TICKET_THRESHOLDS } from "@lodos/shared";
import type { Types } from "mongoose";
import { billsOf } from "../checks/bill";
import type { Models } from "../db/models/index";
import { ApiError } from "../errors";
import { ensureSummaries, summarizeDay, type SummaryData } from "./summary";

/**
 * Sales dashboard and CSV export (spec §4). Ranges are counted in service days ending today; today is always
 * computed live, past days come from stored summaries. Must run inside the manager's tenant.
 */

export const RANGES = ["today", "7d", "30d"] as const;
export type Range = (typeof RANGES)[number];
const RANGE_DAYS: Record<Range, number> = { today: 1, "7d": 7, "30d": 30 };

type Name = { en: string; tr: string };
type Sum = { count: number; amount: number };
export type Totals = {
  revenue: number;
  covers: number;
  checks: number;
  avgPerCover: number;
  avgPerCheck: number;
  comps: Sum;
  voids: Sum;
  /** (comps + voids amount) ÷ revenue, in percent with one decimal. */
  compsPct: number;
};
export type SalesLogEntry = {
  at: string;
  kind: "comp" | "void";
  itemName: Name;
  tableName: string;
  reason: string;
  note: string | null;
  requestedByName: string;
  approvedByName: string;
  amount: number;
  reversed: boolean;
};
export type SalesView = {
  range: Range;
  from: string;
  to: string;
  current: Totals;
  previous: Totals;
  byHour: { hour: number; revenue: number }[];
  ticketTimes: { kitchen: { hour: number; avgMin: number }[]; bar: { hour: number; avgMin: number }[] };
  thresholdMin: number;
  topItems: { name: Name; qty: number; revenue: number }[];
  log: SalesLogEntry[];
};

const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const LOG_LIMIT = 50;
const TOP_ITEMS = 5;

export function parseRange(raw: unknown): Range {
  if (raw === undefined) return "7d";
  if (typeof raw === "string" && (RANGES as readonly string[]).includes(raw)) return raw as Range;
  throw new ApiError(400, "validation", "range must be today, 7d or 30d");
}

/** The service day `n` days after `day` (negative: before). */
const shiftDay = (day: string, n: number) => serviceDayOf(new Date(serviceDayStartOf(day).getTime() + n * DAY_MS));

/** `count` consecutive service days ending with `last`, oldest first. */
const daysEnding = (last: string, count: number) => Array.from({ length: count }, (_, i) => shiftDay(last, i - count + 1));

export function rangeOf(range: Range, now: Date): { today: string; days: string[]; from: string; to: string } {
  const today = serviceDayOf(now);
  const days = daysEnding(today, RANGE_DAYS[range]);
  return { today, days, from: days[0]!, to: today };
}

/** Summaries of `days`: today live, past days stored (computed and stored if missing). */
async function summariesOf(models: Models, days: string[], today: string): Promise<SummaryData[]> {
  const past = days.filter((d) => d < today);
  const [stored, live] = await Promise.all([
    ensureSummaries(models, past, today),
    days.includes(today) ? summarizeDay(models, today) : Promise.resolve(null),
  ]);
  return days.map((d) => (d === today ? live! : stored.get(d)!));
}

type Base = Pick<Totals, "revenue" | "covers" | "checks" | "comps" | "voids">;

const round1 = (n: number) => Math.round(n * 10) / 10;

function withAverages(b: Base): Totals {
  return {
    ...b,
    avgPerCover: b.covers > 0 ? Math.round(b.revenue / b.covers) : 0,
    avgPerCheck: b.checks > 0 ? Math.round(b.revenue / b.checks) : 0,
    compsPct: b.revenue > 0 ? round1(((b.comps.amount + b.voids.amount) / b.revenue) * 100) : 0,
  };
}

function totalsOf(days: SummaryData[]): Totals {
  const b: Base = { revenue: 0, covers: 0, checks: 0, comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 } };
  for (const d of days) {
    b.revenue += d.revenue;
    b.covers += d.covers;
    b.checks += d.checks;
    b.comps.count += d.comps.count;
    b.comps.amount += d.comps.amount;
    b.voids.count += d.voids.count;
    b.voids.amount += d.voids.amount;
  }
  return withAverages(b);
}

/**
 * "Today" compares with the same weekday last week up to the current hour (spec §4): revenue, covers and checks
 * from that day's buckets with a service-hour index ≤ now's; comps and voids (count and amount, by kind) from that
 * day's adjustments made before the end of the same hour.
 */
async function sameTimeLastWeek(models: Models, now: Date, today: string): Promise<Totals> {
  const day = shiftDay(today, -7);
  const idx = serviceHourIndex(istanbulHour(now));
  const cutoff = new Date(serviceDayStartOf(day).getTime() + (idx + 1) * HOUR_MS);
  const [summaries, adjustments] = await Promise.all([
    ensureSummaries(models, [day], today),
    models.Adjustment.find({ serviceDay: day, reversedAt: null, at: { $lt: cutoff } }, { kind: 1, amount: 1 }).lean(),
  ]);
  const b: Base = { revenue: 0, covers: 0, checks: 0, comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 } };
  for (const h of summaries.get(day)?.byHour ?? []) {
    if (serviceHourIndex(h.hour) > idx) continue;
    b.revenue += h.revenue;
    b.covers += h.covers;
    b.checks += h.checks;
  }
  for (const a of adjustments) {
    const sum = a.kind === "comp" ? b.comps : b.voids;
    sum.count += 1;
    sum.amount += a.amount;
  }
  return withAverages(b);
}

const inServiceOrder = <T extends { hour: number }>(m: Map<number, T>) => SERVICE_HOURS.filter((h) => m.has(h)).map((h) => m.get(h)!);

/** Average revenue per open night (a day with checks) for each hour with sales, in service-hour order. */
export function byHourOf(days: SummaryData[]): SalesView["byHour"] {
  const nights = Math.max(1, days.filter((d) => d.checks > 0).length);
  const sums = new Map<number, { hour: number; revenue: number }>();
  for (const d of days) {
    for (const h of d.byHour) {
      if (h.revenue <= 0) continue;
      const s = sums.get(h.hour) ?? { hour: h.hour, revenue: 0 };
      s.revenue += h.revenue;
      sums.set(h.hour, s);
    }
  }
  return inServiceOrder(sums).map((s) => ({ hour: s.hour, revenue: Math.round(s.revenue / nights) }));
}

function ticketTimesOf(days: SummaryData[]): SalesView["ticketTimes"] {
  const station = (key: "kitchen" | "bar") => {
    const sums = new Map<number, { hour: number; count: number; totalMs: number }>();
    for (const d of days) {
      for (const h of d.ticketTimes[key]) {
        if (h.count <= 0) continue;
        const s = sums.get(h.hour) ?? { hour: h.hour, count: 0, totalMs: 0 };
        s.count += h.count;
        s.totalMs += h.totalMs;
        sums.set(h.hour, s);
      }
    }
    return inServiceOrder(sums).map((s) => ({ hour: s.hour, avgMin: round1(s.totalMs / s.count / 60_000) }));
  };
  return { kitchen: station("kitchen"), bar: station("bar") };
}

function topItemsOf(days: SummaryData[]): SalesView["topItems"] {
  const items = new Map<string, { name: Name; qty: number; revenue: number }>();
  for (const d of days) {
    for (const i of d.items) {
      const key = i.itemId ?? `name:${i.name.en}`;
      const it = items.get(key) ?? { name: { en: i.name.en, tr: i.name.tr }, qty: 0, revenue: 0 };
      it.qty += i.qty;
      it.revenue += i.revenue;
      items.set(key, it);
    }
  }
  return [...items.values()]
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.en.localeCompare(b.name.en))
    .slice(0, TOP_ITEMS);
}

async function logOf(models: Models, from: string, to: string): Promise<SalesLogEntry[]> {
  const rows = await models.Adjustment.find({ serviceDay: { $gte: from, $lte: to } })
    .sort({ at: -1, _id: -1 })
    .limit(LOG_LIMIT)
    .lean();
  return rows.map((a) => ({
    at: a.at.toISOString(),
    kind: a.kind,
    itemName: { en: a.itemName?.en ?? "", tr: a.itemName?.tr ?? "" },
    tableName: a.tableName,
    reason: a.reason,
    note: a.note ?? null,
    requestedByName: a.requestedByName,
    approvedByName: a.approvedByName,
    amount: a.amount,
    reversed: a.reversedAt != null,
  }));
}

export async function salesView(models: Models, range: Range, now: Date): Promise<SalesView> {
  const { today, days, from, to } = rangeOf(range, now);
  const prevDays = range === "today" ? [] : daysEnding(shiftDay(from, -1), days.length);
  const [current, previousDays, previousToday, setting, log] = await Promise.all([
    summariesOf(models, days, today),
    summariesOf(models, prevDays, today),
    range === "today" ? sameTimeLastWeek(models, now, today) : Promise.resolve(null),
    models.Setting.findOne({}, { lateMin: 1 }).lean(),
    logOf(models, from, to),
  ]);
  return {
    range,
    from,
    to,
    current: totalsOf(current),
    previous: previousToday ?? totalsOf(previousDays),
    byHour: byHourOf(current),
    ticketTimes: ticketTimesOf(current),
    thresholdMin: setting?.lateMin ?? TICKET_THRESHOLDS.lateMin,
    topItems: topItemsOf(current),
    log,
  };
}

// --- CSV export -------------------------------------------------------------------------------------------------

export const CSV_HEADER = "service_day,closed_at,table,covers,server,gross,comps,voids,total,payment_methods";
export const BOM = "﻿";

/**
 * A quoted CSV text field, `"` doubled (spec Review Focus 4). Text a spreadsheet would run as a formula (starting with
 * `=`, `+`, `-`, `@`, a tab or a CR; names are free text) gets a leading `'` so it stays text.
 */
export const csvField = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
/** Kuruş as plain lira with a dot and two decimals, e.g. `1250.50`. */
export const lira = (kurus: number) => {
  const sign = kurus < 0 ? "-" : "";
  const abs = Math.abs(Math.round(kurus));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

type PaymentLean = { method: "card" | "cash"; amount: number; at: Date } | null | undefined;

/** One row per paid check whose last payment falls in the range. Generated history has no checks, so no rows. */
export async function salesCsv(models: Models, range: Range, now: Date): Promise<{ filename: string; body: string }> {
  const { from, to } = rangeOf(range, now);
  const start = serviceDayStartOf(from);
  const end = new Date(serviceDayStartOf(to).getTime() + DAY_MS);
  const window = { $gte: start, $lt: end };
  const checks = await models.Check.find(
    { status: "paid", $or: [{ "payment.at": window }, { "split.shares.payment.at": window }] },
    { tableId: 1, covers: 1, closedAt: 1, serverStaffId: 1, payment: 1, split: 1 },
  ).lean();

  const paid = checks
    .map((c) => {
      const payments = [c.payment as PaymentLean, ...(c.split?.shares ?? []).map((s) => s.payment as PaymentLean)].filter(
        (p): p is NonNullable<PaymentLean> => !!p,
      );
      const lastAt = new Date(Math.max(...payments.map((p) => p.at.getTime())));
      return { c, payments, lastAt };
    })
    .filter((x) => x.payments.length > 0 && x.lastAt >= start && x.lastAt < end)
    .sort((a, b) => a.lastAt.getTime() - b.lastAt.getTime() || String(a.c._id).localeCompare(String(b.c._id)));

  const ids = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x != null).map(String))];
  const tableIds = ids(paid.map((x) => x.c.tableId));
  const [bills, tables] = await Promise.all([
    billsOf(models, paid.map((x) => x.c._id)),
    models.Table.find({ _id: { $in: tableIds } }, { name: 1, sectionStaffId: 1 }).lean(),
  ]);
  const tableById = new Map(tables.map((t) => [String(t._id), t]));
  const serverOf = (c: (typeof paid)[number]["c"]) =>
    (c.serverStaffId ?? (tableById.get(String(c.tableId))?.sectionStaffId as Types.ObjectId | null | undefined)) ?? null;
  const staff = await models.Staff.find({ _id: { $in: ids(paid.map((x) => serverOf(x.c))) } }, { name: 1 }).lean();
  const staffName = new Map(staff.map((s) => [String(s._id), s.name]));

  const lines = [CSV_HEADER];
  for (const { c, payments, lastAt } of paid) {
    const bill = bills.get(String(c._id));
    const gross = bill ? bill.lines.reduce((n, l) => n + l.originalTotal, 0) : 0;
    const total = payments.reduce((n, p) => n + p.amount, 0);
    const methods = (["card", "cash"] as const).filter((m) => payments.some((p) => p.method === m)).join("+");
    const server = serverOf(c);
    lines.push(
      [
        csvField(serviceDayOf(lastAt)),
        csvField(istanbulDateTime(c.closedAt ?? lastAt)),
        csvField(tableById.get(String(c.tableId))?.name ?? ""),
        String(c.covers ?? 0),
        csvField(server ? (staffName.get(String(server)) ?? "") : ""),
        lira(gross),
        lira(bill?.compsAmount ?? 0),
        lira(bill?.voidsAmount ?? 0),
        lira(total),
        csvField(methods),
      ].join(","),
    );
  }
  return { filename: `lodos-sales-${from}-${to}.csv`, body: BOM + lines.join("\r\n") + "\r\n" };
}
