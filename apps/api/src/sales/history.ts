import { COMP_REASONS, istanbulHour, serviceDayOf, serviceDayStartOf, VOID_REASONS } from "@lodos/shared";
import type { Types } from "mongoose";
import type { Models } from "../db/models/index";
import { runWithTenant } from "../db/tenancy";
import type { HourSummary, ItemSummary, SummaryData, TicketHour } from "./summary";

/**
 * Demo history (spec §4, "Demo seed"): 60 believable service days of stored `DailySummary` documents plus a handful
 * of past comp/void log entries, so a fresh sandbox never shows an empty dashboard. Deterministic for a given `now`.
 * Generated days reconcile exactly: Σ byHour revenue = revenue = Σ item revenue, card + cash = revenue, and each
 * day's comps/voids are exactly the generated log entries dated that day.
 */

export type HistoryItem = {
  id: string | Types.ObjectId;
  slug: string;
  name: { en: string; tr: string };
  /** Kuruş. */
  price: number;
  station: "kitchen" | "bar";
};
export type HistoryStaff = { id: string | Types.ObjectId; name: string };

export const HISTORY_DAYS = 60;
const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;

/** Small seeded PRNG (returns floats in [0, 1)). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Revenue/covers share of each opening hour (17:00 … 23:00): a peak at 20:00–21:00. */
const HOUR_SHARE: [number, number][] = [[17, 0.06], [18, 0.1], [19, 0.16], [20, 0.22], [21, 0.22], [22, 0.15], [23, 0.09]];
/** Typical ticket minutes per hour (same order): at most 14.4 for the kitchen, 7 for the bar. */
const KITCHEN_MIN = [9.4, 10.2, 11.6, 13.4, 13.6, 11.6, 9.8];
const BAR_MIN = [4.3, 4.8, 5.4, 6.4, 6.5, 5.6, 4.6];
/** Signature dishes sell most; the rest share the remainder. */
const SIGNATURE_WEIGHT: Record<string, number> = {
  "dry-aged-ribeye": 6, burrata: 6, "lodos-negroni": 6,
  "lamb-chops": 3, "grilled-octopus": 3, spritz: 3, "red-wine-glass": 3, "truffle-fries": 3,
};

/** Splits `total` into integer parts proportional to `weights`, summing exactly (largest remainder). */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/** Covers a night, by weekday (0 = Sunday). Fri/Sat run about 1.6x Tue/Wed. */
function coversFor(dow: number, rand: () => number): number {
  const ranges: Record<number, [number, number]> = { 2: [56, 68], 3: [58, 70], 4: [70, 84], 5: [96, 108], 6: [98, 110], 0: [78, 92] };
  const [lo, hi] = ranges[dow] ?? [56, 68];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

const dowOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export async function generateHistory(
  models: Models,
  args: { tenantId: string; now: Date; items: HistoryItem[]; tables: string[]; staff: HistoryStaff[] },
): Promise<void> {
  const { tenantId, now, items, tables, staff } = args;
  const rand = mulberry32(now.getTime() % 2 ** 32);
  const todayStart = serviceDayStartOf(serviceDayOf(now)).getTime();
  const days = Array.from({ length: HISTORY_DAYS }, (_, k) => serviceDayOf(new Date(todayStart - (HISTORY_DAYS - k) * DAY_MS)));
  const dayStartOf = (day: string) => serviceDayStartOf(day).getTime();

  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const requesters = staff.filter((s) => s.name === "Deniz" || s.name === "Mert");
  const approver = staff.find((s) => s.name === "Selin");
  if (requesters.length === 0 || !approver || items.length === 0 || tables.length === 0) {
    throw new Error("history needs the seeded menu, tables and staff");
  }

  // Comp/void log entries over the last 30 open days, each at an opening hour of its day.
  const recent = days.slice(-30).filter((d) => dowOf(d) !== 1);
  const entryCount = 10 + Math.floor(rand() * 7);
  const adjustments = Array.from({ length: entryCount }, () => {
    const day = pick(recent);
    const kind = rand() < 0.6 ? ("comp" as const) : ("void" as const);
    const item = pick(items);
    const qty = rand() < 0.75 ? 1 : 2;
    const at = new Date(dayStartOf(day) + (11 + Math.floor(rand() * 7)) * HOUR_MS + Math.floor(rand() * 60) * 60_000);
    const requester = pick(requesters);
    return {
      checkId: null,
      orderId: null,
      itemIndex: null,
      units: [] as number[],
      qty,
      kind,
      reason: kind === "comp" ? pick(COMP_REASONS) : pick(VOID_REASONS),
      amount: item.price * qty,
      itemId: item.id,
      itemName: item.name,
      tableName: pick(tables),
      station: item.station,
      requestedBy: requester.id,
      requestedByName: requester.name,
      approvedBy: approver.id,
      approvedByName: approver.name,
      at,
      serviceDay: day,
      reversedAt: null,
    };
  });

  const weights = items.map((i) => SIGNATURE_WEIGHT[i.slug] ?? 1.5);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const drawItem = () => {
    let r = rand() * weightSum;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return items[i] as HistoryItem;
    }
    return items[items.length - 1] as HistoryItem;
  };
  const minPrice = Math.min(...items.map((i) => i.price));

  const summaries: SummaryData[] = days.map((serviceDay) => {
    const dow = dowOf(serviceDay);
    const dayAdjustments = adjustments.filter((a) => a.serviceDay === serviceDay);
    if (dow === 1) {
      return {
        serviceDay, revenue: 0, covers: 0, checks: 0, comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 },
        byHour: [], ticketTimes: { kitchen: [], bar: [] }, items: [], payments: { card: 0, cash: 0 }, generated: true,
      };
    }
    const covers = coversFor(dow, rand);
    const perCover = 74_000 + Math.floor(rand() * 22_000); // ₺740–960 in kuruş
    const revenue = covers * perCover;

    // Items: draw units until less than the cheapest item is left; the remainder goes to the top item.
    const sold = new Map<HistoryItem, { qty: number; revenue: number }>();
    let remaining = revenue;
    while (remaining >= minPrice) {
      let item = drawItem();
      for (let t = 0; t < 20 && item.price > remaining; t++) item = drawItem();
      if (item.price > remaining) item = items.filter((i) => i.price <= remaining).sort((a, b) => b.price - a.price)[0] as HistoryItem;
      const s = sold.get(item) ?? { qty: 0, revenue: 0 };
      s.qty += 1;
      s.revenue += item.price;
      sold.set(item, s);
      remaining -= item.price;
    }
    const rows: ItemSummary[] = [...sold.entries()]
      .map(([i, s]) => ({ itemId: String(i.id), name: { en: i.name.en, tr: i.name.tr }, qty: s.qty, revenue: s.revenue }))
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.en.localeCompare(b.name.en));
    if (rows[0]) rows[0].revenue += remaining;

    // Hours.
    const shares = HOUR_SHARE.map(([, w]) => w * (0.85 + rand() * 0.3));
    const hourRevenue = apportion(revenue, shares);
    const hourCovers = apportion(covers, shares);
    const byHour: HourSummary[] = HOUR_SHARE.map(([hour], i) => {
      const c = hourCovers[i] as number;
      return {
        hour,
        revenue: hourRevenue[i] as number,
        covers: c,
        checks: Math.max(1, Math.min(c, Math.round(c / 2.3))),
        comps: dayAdjustments.filter((a) => istanbulHour(a.at) === hour).reduce((s, a) => s + a.amount, 0),
      };
    });
    const ticketHours = (perCheck: number, minutes: number[], lo: number, hi: number): TicketHour[] =>
      byHour.map((b, i) => {
        const count = Math.max(1, Math.round(b.checks * perCheck));
        const avg = Math.min(hi, Math.max(lo, (minutes[i] as number) + (rand() - 0.5) * 1.2));
        return { hour: b.hour, count, totalMs: Math.round(count * avg * 60_000) };
      });
    const card = Math.round(revenue * (0.76 + rand() * 0.08));
    const sum = (kind: "comp" | "void") => {
      const xs = dayAdjustments.filter((a) => a.kind === kind);
      return { count: xs.length, amount: xs.reduce((s, a) => s + a.amount, 0) };
    };
    return {
      serviceDay,
      revenue,
      covers,
      checks: byHour.reduce((s, b) => s + b.checks, 0),
      comps: sum("comp"),
      voids: sum("void"),
      byHour,
      ticketTimes: { kitchen: ticketHours(2.1, KITCHEN_MIN, 9, 14.4), bar: ticketHours(1.9, BAR_MIN, 4, 7) },
      items: rows,
      payments: { card, cash: revenue - card },
      generated: true,
    };
  });

  await runWithTenant(tenantId, async () => {
    await Promise.all([models.DailySummary.insertMany(summaries), models.Adjustment.insertMany(adjustments)]);
  });
}
