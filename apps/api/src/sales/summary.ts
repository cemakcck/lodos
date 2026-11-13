import { istanbulHour, serviceDayOf, serviceDayStartOf, serviceHourIndex, TICKET_THRESHOLDS } from "@lodos/shared";
import { billsOf } from "../checks/bill";
import type { Models } from "../db/models/index";
import { runWithTenant, unscoped } from "../db/tenancy";

/**
 * Daily sales summaries (spec §4, data approach). `summarizeDay` computes one service day from the raw data;
 * `ensureSummaries` serves stored summaries and stores the missing past days. Everything here runs inside a tenant,
 * except `summaryJob`, which iterates the tenants itself.
 *
 * Dating rules (plan rulings "Sales revenue"): revenue is the sum of payments (full or share) bucketed by payment
 * time; checks and covers by the check's close time; comps and voids by when they were made. `byServer` follows the
 * checks closed in the day: each check's covers and all its payments go to its server.
 */

type Name = { en: string; tr: string };
type Station = "kitchen" | "bar";

export type HourSummary = { hour: number; revenue: number; covers: number; checks: number; comps: number };
/** `onTime`: tickets ready within the tenant's late threshold (`readyAt − sentAt ≤ lateMin`). */
export type TicketHour = { hour: number; count: number; totalMs: number; onTime: number };
export type ServerSummary = { staffId: string; checks: number; covers: number; sales: number };
export type ItemSummary = { itemId: string | null; name: Name; qty: number; revenue: number };

export type SummaryData = {
  serviceDay: string;
  revenue: number;
  covers: number;
  checks: number;
  comps: { count: number; amount: number };
  voids: { count: number; amount: number };
  /** Only hours with activity, in service-hour order (06 … 05). */
  byHour: HourSummary[];
  ticketTimes: Record<Station, TicketHour[]>;
  /** Charged units and amounts, most sold first. */
  items: ItemSummary[];
  payments: { card: number; cash: number };
  /** Per server of the day's closed checks, by staff id. */
  byServer: ServerSummary[];
  generated: boolean;
};

export const SUMMARY_INTERVAL_MS = 15 * 60_000;

const DAY_MS = 24 * 3_600_000;
const byServiceHour = (a: { hour: number }, b: { hour: number }) => serviceHourIndex(a.hour) - serviceHourIndex(b.hour);

type PaymentLean = { method: "card" | "cash"; amount: number; at: Date } | null | undefined;

/** One service day computed live from checks, adjustments and tickets. A pure read. */
export async function summarizeDay(models: Models, serviceDay: string): Promise<SummaryData> {
  const from = serviceDayStartOf(serviceDay);
  const to = new Date(from.getTime() + DAY_MS);
  const range = { $gte: from, $lt: to };
  const [withPayments, closed, adjustments, tickets, setting] = await Promise.all([
    // Any check holding a payment made in the day: a full payment, or a share (of a check maybe still open).
    models.Check.find({ $or: [{ "payment.at": range }, { "split.shares.payment.at": range }] }, { payment: 1, split: 1 }).lean(),
    models.Check.find({ status: "paid", closedAt: range }, { covers: 1, closedAt: 1, serverStaffId: 1, payment: 1, split: 1 }).lean(),
    models.Adjustment.find({ serviceDay, reversedAt: null }, { kind: 1, qty: 1, amount: 1, at: 1 }).lean(),
    models.Ticket.find({ sentAt: range, readyAt: { $ne: null }, voidedAt: null }, { station: 1, sentAt: 1, readyAt: 1 }).lean(),
    models.Setting.findOne({}, { lateMin: 1 }).lean(),
  ]);
  const lateMs = (setting?.lateMin ?? TICKET_THRESHOLDS.lateMin) * 60_000;

  const hours = new Map<number, HourSummary>();
  const hour = (at: Date) => {
    const h = istanbulHour(at);
    let b = hours.get(h);
    if (!b) hours.set(h, (b = { hour: h, revenue: 0, covers: 0, checks: 0, comps: 0 }));
    return b;
  };

  let revenue = 0;
  const payments = { card: 0, cash: 0 };
  const addPayment = (p: PaymentLean) => {
    if (!p || p.at < from || p.at >= to) return;
    revenue += p.amount;
    payments[p.method] += p.amount;
    hour(p.at).revenue += p.amount;
  };
  for (const c of withPayments) {
    addPayment(c.payment as PaymentLean);
    for (const s of c.split?.shares ?? []) addPayment(s.payment as PaymentLean);
  }

  let covers = 0;
  const servers = new Map<string, ServerSummary>();
  for (const c of closed) {
    const b = hour(c.closedAt!);
    b.checks += 1;
    b.covers += c.covers ?? 0;
    covers += c.covers ?? 0;
    if (!c.serverStaffId) continue;
    const staffId = String(c.serverStaffId);
    let s = servers.get(staffId);
    if (!s) servers.set(staffId, (s = { staffId, checks: 0, covers: 0, sales: 0 }));
    s.checks += 1;
    s.covers += c.covers ?? 0;
    s.sales += paidOn(c);
  }

  const comps = { count: 0, amount: 0 };
  const voids = { count: 0, amount: 0 };
  for (const a of adjustments) {
    const sum = a.kind === "comp" ? comps : voids;
    sum.count += 1; // one per adjustment (a log row), whatever its qty
    sum.amount += a.amount;
    hour(a.at).comps += a.amount;
  }

  const ticketHours: Record<Station, Map<number, TicketHour>> = { kitchen: new Map(), bar: new Map() };
  for (const tk of tickets) {
    const h = istanbulHour(tk.sentAt);
    const m = ticketHours[tk.station];
    let b = m.get(h);
    if (!b) m.set(h, (b = { hour: h, count: 0, totalMs: 0, onTime: 0 }));
    const ms = tk.readyAt!.getTime() - tk.sentAt.getTime();
    b.count += 1;
    b.totalMs += ms;
    if (ms <= lateMs) b.onTime += 1;
  }

  const items = new Map<string, ItemSummary>();
  const bills = await billsOf(models, closed.map((c) => c._id));
  for (const bill of bills.values()) {
    for (const l of bill.lines) {
      const qty = l.qty - l.compedQty - l.voidedQty;
      if (qty <= 0) continue;
      let it = items.get(l.itemId);
      if (!it) items.set(l.itemId, (it = { itemId: l.itemId, name: { en: l.name.en, tr: l.name.tr }, qty: 0, revenue: 0 }));
      it.qty += qty;
      it.revenue += l.lineTotal;
    }
  }

  return {
    serviceDay,
    revenue,
    covers,
    checks: closed.length,
    comps,
    voids,
    byHour: [...hours.values()].sort(byServiceHour),
    ticketTimes: {
      kitchen: [...ticketHours.kitchen.values()].sort(byServiceHour),
      bar: [...ticketHours.bar.values()].sort(byServiceHour),
    },
    items: [...items.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.en.localeCompare(b.name.en)),
    payments,
    byServer: [...servers.values()].sort((a, b) => a.staffId.localeCompare(b.staffId)),
    generated: false,
  };
}

/** Everything paid on a check: its full payment, or its shares' payments. */
function paidOn(c: { payment?: PaymentLean; split?: { shares?: { payment?: PaymentLean }[] } | null }): number {
  return (c.payment?.amount ?? 0) + (c.split?.shares ?? []).reduce((n, s) => n + (s.payment?.amount ?? 0), 0);
}

type StoredLean = SummaryData & { _id?: unknown; tenantId?: string; __v?: number };

/** A stored document as SummaryData (field by field, so ids and version keys never leak). */
function fromStored(d: StoredLean): SummaryData {
  // Summaries stored before phase 3 lack `onTime` and `byServer`: they read as empty.
  const hourRow = (h: TicketHour) => ({ hour: h.hour, count: h.count, totalMs: h.totalMs, onTime: h.onTime ?? 0 });
  return {
    serviceDay: d.serviceDay,
    revenue: d.revenue,
    covers: d.covers,
    checks: d.checks,
    comps: { count: d.comps.count, amount: d.comps.amount },
    voids: { count: d.voids.count, amount: d.voids.amount },
    byHour: d.byHour.map((h) => ({ hour: h.hour, revenue: h.revenue, covers: h.covers, checks: h.checks, comps: h.comps })),
    ticketTimes: { kitchen: d.ticketTimes.kitchen.map(hourRow), bar: d.ticketTimes.bar.map(hourRow) },
    items: d.items.map((i) => ({ itemId: i.itemId ?? null, name: { en: i.name.en, tr: i.name.tr }, qty: i.qty, revenue: i.revenue })),
    payments: { card: d.payments.card, cash: d.payments.cash },
    byServer: (d.byServer ?? []).map((s) => ({ staffId: s.staffId, checks: s.checks, covers: s.covers, sales: s.sales })),
    generated: d.generated,
  };
}

const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * Summaries of `days`, keyed by service day. Stored ones are read; missing ones are computed, and those before
 * `today` are stored. Today (and any later day) is computed live and never stored: it is not over yet.
 * A concurrent writer (the job, another request) can store the same day first: the unique (tenantId, serviceDay)
 * index rejects our insert and we return the stored document.
 */
export async function ensureSummaries(models: Models, days: string[], today: string): Promise<Map<string, SummaryData>> {
  const out = new Map<string, SummaryData>();
  const stored = await models.DailySummary.find({ serviceDay: { $in: days } }).lean<StoredLean[]>();
  for (const d of stored) out.set(d.serviceDay, fromStored(d));
  for (const day of new Set(days)) {
    if (out.has(day)) continue;
    const data = await summarizeDay(models, day);
    if (day < today) {
      try {
        await models.DailySummary.create(data);
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const winner = await models.DailySummary.findOne({ serviceDay: day }).lean<StoredLean>();
        if (winner) {
          out.set(day, fromStored(winner));
          continue;
        }
        throw err;
      }
    }
    out.set(day, data);
  }
  return out;
}

/** The service day before the one containing `now`. */
export function previousServiceDay(now: Date): string {
  return serviceDayOf(new Date(serviceDayStartOf(serviceDayOf(now)).getTime() - 1));
}

/**
 * Stores the previous service day's summary of every tenant that lacks one (plan ruling "summary job"; runs every
 * 15 min whenever `startJobs` is on, so a day ended during downtime is still written). One tenant's failure does
 * not stop the others.
 */
export async function summaryJob(
  models: Models,
  now: Date,
  onError: (err: unknown, tenantId: string) => void = () => {},
): Promise<void> {
  const today = serviceDayOf(now);
  const yesterday = previousServiceDay(now);
  const [tenants, done] = await unscoped("the summary job visits every tenant", () =>
    Promise.all([
      // A tenant created after yesterday ended (a new sandbox) has nothing to summarize for it, and its seeded
      // history must not race a stored empty day.
      models.Tenant.find({ createdAt: { $lt: serviceDayStartOf(today) } }, { tenantId: 1 }).lean(),
      models.DailySummary.find({ serviceDay: yesterday }, { tenantId: 1 }).lean(),
    ]),
  );
  const has = new Set(done.map((d) => d.tenantId));
  for (const { tenantId } of tenants) {
    if (has.has(tenantId)) continue;
    try {
      await runWithTenant(tenantId, () => ensureSummaries(models, [yesterday], today));
    } catch (err) {
      onError(err, tenantId);
    }
  }
}
