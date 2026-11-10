import {
  maskProfanity,
  noteMentionsAllergy,
  serviceDayOf,
  TICKET_THRESHOLDS,
  ticketAgeState,
  type AgeState,
  type TicketStatus,
} from "@lodos/shared";
import type { Models } from "../db/models/index";
import { claimFirst, clearHits } from "../auth/rate-limit";
import { ApiError } from "../errors";

export type Station = "kitchen" | "bar";
export type Tab = "active" | "held" | "done";
type Loc = { en: string; tr: string };

export type TicketItemView = {
  index: number;
  name: Loc;
  qty: number;
  options: Loc[];
  note: string | null;
  allergens: string[];
  allergyFlag: boolean;
  checked: boolean;
};
export type TicketView = {
  id: string;
  orderId: string;
  tableId: string;
  tableName: string;
  station: Station;
  status: TicketStatus;
  serverName: string | null;
  covers: number | null;
  sentAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  ageState: AgeState;
  items: TicketItemView[];
};
export type KdsView = {
  now: string;
  thresholds: { warnMin: number; lateMin: number };
  tickets: TicketView[];
  allDay: { itemName: Loc; qty: number }[];
  eightySix: { itemId: string; name: Loc; soldOut: boolean; remaining: number | null }[];
  stats: { open: number; items: number; avgTicketMs: number; late: number };
};

const OID_RE = /^[0-9a-f]{24}$/i;
export const isOid = (s: string): boolean => OID_RE.test(s);
export const notFound = () => new ApiError(404, "not_found");

/** Start instant (UTC) of the service day containing `at`: 06:00 Istanbul (fixed UTC+3) = 03:00Z of its date. */
export function serviceDayStart(at: Date): Date {
  const [y, m, d] = serviceDayOf(at).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

async function thresholds(models: Models) {
  const s = await models.Setting.findOne().lean();
  return s ? { warnMin: s.warnMin, lateMin: s.lateMin } : TICKET_THRESHOLDS;
}

type Lean = Awaited<ReturnType<typeof loadLean>>[number];
const loadLean = (models: Models, filter: object) => models.Ticket.find(filter).lean();

function view(t: Lean, now: Date, th: { warnMin: number; lateMin: number }): TicketView {
  return {
    id: String(t._id),
    orderId: String(t.orderId),
    tableId: String(t.tableId),
    tableName: t.tableName,
    station: t.station as Station,
    status: t.status as TicketStatus,
    serverName: t.serverName ?? null,
    covers: t.covers ?? null,
    sentAt: t.sentAt,
    startedAt: t.startedAt ?? null,
    readyAt: t.readyAt ?? null,
    servedAt: t.servedAt ?? null,
    ageState: ticketAgeState(t.sentAt, now, th),
    items: t.items.map((i, index) => ({
      index,
      name: { en: i.name.en, tr: i.name.tr },
      qty: i.qty,
      options: i.options.map((o) => ({ en: o.en, tr: o.tr })),
      note: i.note ? maskProfanity(i.note) : null,
      allergens: [...i.allergens],
      allergyFlag: i.allergens.length > 0 || (!!i.note && noteMentionsAllergy(i.note)),
      checked: i.checked,
    })),
  };
}

export async function kdsView(models: Models, station: Station, tab: Tab, now: Date): Promise<KdsView> {
  const th = await thresholds(models);
  const dayStart = serviceDayStart(now);
  const [active, held, done] = await Promise.all([
    loadLean(models, { station, status: { $in: ["new", "started"] } }),
    tab === "held" ? loadLean(models, { station, status: "held" }) : Promise.resolve([]),
    models.Ticket.find({ station, status: "ready", readyAt: { $gte: dayStart } })
      .sort({ readyAt: -1 })
      .lean(),
  ]);
  active.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  held.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const shown = tab === "active" ? active : tab === "held" ? held : done.slice(0, 50);

  // allDay: not-yet-checked quantity per menu item (the ticket line points into Order.items, which has the itemId).
  const orders = await models.Order.find({ _id: { $in: active.map((t) => t.orderId) } }, { items: 1 }).lean();
  const itemIdOf = new Map(orders.map((o) => [String(o._id), o.items.map((i) => String(i.itemId))]));
  const tally = new Map<string, { itemName: Loc; qty: number }>();
  for (const t of active) {
    for (const l of t.items) {
      if (l.checked) continue;
      const key = itemIdOf.get(String(t.orderId))?.[l.orderItemIndex] ?? l.name.en;
      const cur = tally.get(key);
      if (cur) cur.qty += l.qty;
      else tally.set(key, { itemName: { en: l.name.en, tr: l.name.tr }, qty: l.qty });
    }
  }
  const allDay = [...tally.values()].sort((a, b) => b.qty - a.qty);

  const avail = await models.Availability.find({
    serviceDay: serviceDayOf(now),
    $or: [{ soldOut: true }, { remaining: { $ne: null } }],
  }).lean();
  const menu = await models.MenuItem.find({ _id: { $in: avail.map((a) => a.itemId) }, station }, { name: 1 }).lean();
  const nameOf = new Map(menu.map((m) => [String(m._id), { en: m.name.en, tr: m.name.tr }]));
  const eightySix = avail
    .filter((a) => nameOf.has(String(a.itemId)))
    .map((a) => ({ itemId: String(a.itemId), name: nameOf.get(String(a.itemId))!, soldOut: a.soldOut, remaining: a.remaining ?? null }));

  const cook = done.map((t) => (t.readyAt as Date).getTime() - t.sentAt.getTime());
  return {
    now: now.toISOString(),
    thresholds: th,
    tickets: shown.map((t) => view(t, now, th)),
    allDay,
    eightySix,
    stats: {
      open: active.length,
      items: active.reduce((n, t) => n + t.items.reduce((m, i) => m + i.qty, 0), 0),
      avgTicketMs: cook.length ? Math.round(cook.reduce((a, b) => a + b, 0) / cook.length) : 0,
      late: active.filter((t) => ticketAgeState(t.sentAt, now, th) === "late").length,
    },
  };
}

export type Action = "start" | "hold" | "unhold" | "bump";
export type ActionResult = { ticket: TicketView; changed: boolean };

const RULES: Record<Action, { from: TicketStatus[]; to: TicketStatus }> = {
  start: { from: ["new"], to: "started" },
  hold: { from: ["new", "started"], to: "held" },
  unhold: { from: ["held"], to: "started" },
  bump: { from: ["new", "started"], to: "ready" },
};

/** A ticket by id, scoped to the caller's station (null = any station, for managers). Wrong station or bad id: 404. */
async function loadScoped(models: Models, id: string, scope: Station | null) {
  if (!isOid(id)) throw notFound();
  const t = await models.Ticket.findOne({ _id: id, ...(scope ? { station: scope } : {}) }).lean();
  if (!t) throw notFound();
  return t;
}

export async function ticketAction(models: Models, id: string, scope: Station | null, action: Action, now: Date): Promise<ActionResult> {
  const before = await loadScoped(models, id, scope);
  const rule = RULES[action];
  const set: Record<string, unknown> = { status: rule.to };
  if (action === "start") set.startedAt = now;
  if (action === "unhold") set.startedAt = before.startedAt ?? now;
  if (action === "bump") set.readyAt = now;
  const update: Record<string, unknown> = { $set: set };
  if (action === "bump") set["items.$[].checked"] = true;
  const won = await models.Ticket.findOneAndUpdate(
    { _id: id, status: { $in: rule.from }, servedAt: null },
    update,
    { returnDocument: "after" },
  ).lean();
  const th = await thresholds(models);
  if (won) return { ticket: view(won, now, th), changed: true };
  // Lost: either already bumped (idempotent) or an invalid transition. Re-read, since a concurrent tap may have won.
  const cur = await loadScoped(models, id, scope);
  if (action === "bump" && cur.status === "ready") return { ticket: view(cur, now, th), changed: false };
  throw new ApiError(409, "conflict");
}

export async function toggleItem(models: Models, id: string, scope: Station | null, idx: string, now: Date): Promise<ActionResult> {
  const th = await thresholds(models);
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await loadScoped(models, id, scope);
    if (!/^\d+$/.test(idx) || Number(idx) >= cur.items.length) throw notFound();
    const i = Number(idx);
    if (cur.servedAt) throw new ApiError(409, "conflict");
    const was = cur.items[i]!.checked;
    // Conditional on the value we read, so two concurrent taps flip twice instead of both setting the same value.
    const won = await models.Ticket.findOneAndUpdate(
      { _id: id, servedAt: null, [`items.${i}.checked`]: was },
      { $set: { [`items.${i}.checked`]: !was } },
      { returnDocument: "after" },
    ).lean();
    if (won) return { ticket: view(won, now, th), changed: true };
  }
  throw new ApiError(409, "conflict");
}

export const RECALL_WINDOW_MS = 3000;

/**
 * Recall the latest bumped, unserved ticket. Double-tap safe in two layers:
 * 1. `claimFirst()` on a per-(tenant, station) marker admits exactly one recall per 3 s window (insert, then win only
 *    if ours is the earliest event, `_id` breaking ties), so parallel taps cannot both pass and cannot both be refused.
 *    Refused taps return the ticket recalled inside the window (changed:false), waiting briefly for the winner's write.
 * 2. The conditional update (status "ready", servedAt null) is the final guard; a lost race returns the ticket the
 *    winner took back instead of moving to a different ticket.
 */
export async function recall(models: Models, station: Station, now: Date, tenantId: string): Promise<ActionResult> {
  const key = `recall:${tenantId}:${station}`;
  const th = await thresholds(models);
  const recentlyRecalled = () =>
    models.Ticket.findOne({ station, status: "started", servedAt: null, recalledAt: { $gte: new Date(now.getTime() - RECALL_WINDOW_MS) } })
      .sort({ recalledAt: -1 })
      .lean();

  if (!(await claimFirst(models, key, RECALL_WINDOW_MS, now))) {
    // The winner may still be writing; give it a moment to finish.
    for (let i = 0; i < 10; i++) {
      const prior = await recentlyRecalled();
      if (prior) return { ticket: view(prior, now, th), changed: false };
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new ApiError(409, "conflict");
  }
  const release = () => clearHits(models, key);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await models.Ticket.findOne({ station, status: "ready", servedAt: null }).sort({ readyAt: -1 }).lean();
      if (!last) throw notFound();
      const won = await models.Ticket.findOneAndUpdate(
        { _id: last._id, status: "ready", servedAt: null },
        { $set: { status: "started", readyAt: null, startedAt: last.startedAt ?? now, recalledAt: now } },
        { returnDocument: "after" },
      ).lean();
      if (won) return { ticket: view(won, now, th), changed: true };
      const cur = await models.Ticket.findOne({ _id: last._id }).lean();
      if (cur && cur.status !== "ready") return { ticket: view(cur, now, th), changed: false };
    }
    throw new ApiError(409, "conflict");
  } catch (err) {
    await release(); // nothing was recalled: do not hold the window
    throw err;
  }
}
