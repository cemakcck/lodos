import { randomInt } from "node:crypto";
import { deriveTableState, maskProfanity, type TableState } from "@lodos/shared";
import type { ClientSession, Types } from "mongoose";
import { billOf, billsOf } from "../checks/bill";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { isOid, notFound, serviceDayStart } from "../kds/service";
import { checkLines, type CheckLine, type CheckLines, type CheckTotals } from "../orders/check-lines";

/** All functions here must run inside `runWithTenant` (the floor routes use `staffRoute`). */

type Id = string | Types.ObjectId;
const idOf = (v: Id | null | undefined): string | null => (v == null ? null : String(v));
const conflict = (message: string) => new ApiError(409, "conflict", message);
const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

/** Staff views of guest notes are masked (the guest's own "Your table" view keeps their words). */
function maskedLines(lines: CheckLines): CheckLines {
  const mask = (l: CheckLine): CheckLine => (l.note ? { ...l, note: maskProfanity(l.note) } : l);
  return { ...lines, food: lines.food.map(mask), drinks: lines.drinks.map(mask) };
}

/** "Deniz" → "D", "Ayşe Nur" → "AN". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr"))
    .join("");
}

// ─── Floor snapshot ──────────────────────────────────────────────────────────────────────────────────────────────────

export type ChipKind = "calling" | "ready" | "bill";
export type FloorChip = { kind: ChipKind; tableId: string; tableName: string; since: Date };
export type FloorTable = {
  id: string;
  name: string;
  roomId: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  /** The waiter whose section the table is in ("My tables"). */
  sectionStaffId: string | null;
  /** The open check's server, else the section waiter. */
  serverStaffId: string | null;
  serverInitials: string | null;
  state: TableState;
  covers: number | null;
  seatedAt: Date | null;
  checkId: string | null;
  /** The open check's split progress, once at least one share is paid ("Paying · 2 of 4"). */
  paying: { paid: number; of: number } | null;
};
export type FloorStats = { seated: number; totalTables: number; covers: number; avgTurnMs: number; openChecksTotal: number };
export type FloorSnapshot = { now: Date; rooms: { id: string; name: string }[]; tables: FloorTable[]; chips: FloorChip[]; stats: FloorStats };

const CHIP_ORDER: Record<ChipKind, number> = { calling: 0, ready: 1, bill: 2 };
const earliest = (a: Date | undefined, b: Date) => (a && a <= b ? a : b);

/**
 * The live floor: every active table with its derived state, attention chips and the stats strip.
 * "Ready" means a ready, unserved ticket on the table's *open* check (a closed visit's leftovers do not flag a free
 * table). Calls count while unanswered, with or without a check.
 */
export async function floorSnapshot(models: Models, now: Date): Promise<FloorSnapshot> {
  const { Call, Check, Room, Staff, Table, Ticket } = models;
  const [rooms, tables, openChecks, openCalls, staff, paidToday] = await Promise.all([
    Room.find().sort({ sort: 1, _id: 1 }).lean(),
    Table.find({ active: true }).sort({ _id: 1 }).lean(),
    Check.find({ status: "open" }).lean(),
    Call.find({ answeredAt: null }, { tableId: 1, openedAt: 1 }).lean(),
    Staff.find({}, { name: 1 }).lean(),
    Check.find({ status: "paid", closedAt: { $gte: serviceDayStart(now) } }, { openedAt: 1, closedAt: 1 }).lean(),
  ]);
  const checkIds = openChecks.map((c) => c._id);
  const [readyTickets, openBills] = await Promise.all([
    Ticket.find({ checkId: { $in: checkIds }, status: "ready", servedAt: null }, { tableId: 1, readyAt: 1, sentAt: 1 }).lean(),
    billsOf(models, checkIds),
  ]);

  const nameOf = new Map(staff.map((s) => [String(s._id), s.name]));
  const checkOf = new Map(openChecks.map((c) => [String(c.tableId), c]));
  const callSince = new Map<string, Date>();
  for (const c of openCalls) callSince.set(String(c.tableId), earliest(callSince.get(String(c.tableId)), c.openedAt));
  const readySince = new Map<string, Date>();
  for (const tk of readyTickets) readySince.set(String(tk.tableId), earliest(readySince.get(String(tk.tableId)), tk.readyAt ?? tk.sentAt));

  const chips: FloorChip[] = [];
  const out = tables.map((table): FloorTable => {
    const id = String(table._id);
    const check = checkOf.get(id);
    const calling = callSince.get(id);
    const ready = readySince.get(id);
    const bill = check?.billRequestedAt ?? null;
    if (calling) chips.push({ kind: "calling", tableId: id, tableName: table.name, since: calling });
    if (ready) chips.push({ kind: "ready", tableId: id, tableName: table.name, since: ready });
    if (bill) chips.push({ kind: "bill", tableId: id, tableName: table.name, since: bill });
    const serverStaffId = idOf(check?.serverStaffId ?? table.sectionStaffId);
    const serverName = serverStaffId ? nameOf.get(serverStaffId) : undefined;
    const paidShares = check?.split?.shares.filter((x) => x.payment != null).length ?? 0;
    return {
      id,
      name: table.name,
      roomId: String(table.roomId),
      shape: table.shape,
      x: table.x,
      y: table.y,
      w: table.w,
      h: table.h,
      capacity: table.capacity,
      sectionStaffId: idOf(table.sectionStaffId),
      serverStaffId,
      serverInitials: serverName ? initials(serverName) : null,
      state: deriveTableState({ openCheck: !!check, openCall: !!calling, readyUnserved: !!ready, billRequested: !!bill }),
      covers: check?.covers ?? null,
      seatedAt: check?.openedAt ?? null,
      checkId: check ? String(check._id) : null,
      paying: check?.split && paidShares > 0 ? { paid: paidShares, of: check.split.shares.length } : null,
    };
  });
  chips.sort(
    (a, b) => CHIP_ORDER[a.kind] - CHIP_ORDER[b.kind] || a.since.getTime() - b.since.getTime() || a.tableName.localeCompare(b.tableName),
  );

  const activeIds = new Set(out.map((t) => t.id));
  const seatedChecks = openChecks.filter((c) => activeIds.has(String(c.tableId)));
  const turns = paidToday.map((c) => (c.closedAt as Date).getTime() - c.openedAt.getTime());
  return {
    now,
    rooms: rooms.map((r) => ({ id: String(r._id), name: r.name })),
    tables: out,
    chips,
    stats: {
      seated: seatedChecks.length,
      totalTables: out.length,
      covers: seatedChecks.reduce((n, c) => n + (c.covers ?? 0), 0),
      avgTurnMs: turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length) : 0,
      openChecksTotal: [...openBills.values()].reduce((n, b) => n + b.total, 0),
    },
  };
}

// ─── Check detail and print ──────────────────────────────────────────────────────────────────────────────────────────

export type OpenCallView = { id: string; reason: string; openedAt: Date };
export type TableCheckView = {
  table: { id: string; name: string; capacity: number; sectionStaffId: string | null };
  /** Unanswered calls at the table (the "Answer call" action needs their ids). */
  calls: OpenCallView[];
} & (
  | { check: null }
  | {
      check: {
        id: string;
        covers: number | null;
        openedAt: Date;
        serverStaffId: string | null;
        serverName: string | null;
        billRequestedAt: Date | null;
        billMethod: "card" | "cash" | null;
      };
      food: CheckLine[];
      drinks: CheckLine[];
      totals: CheckTotals;
    }
);

async function staffName(models: Models, id: Id | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await models.Staff.findById(id, { name: 1 }).lean())?.name ?? null;
}

/** The table detail panel: the open check as Food and Drinks with totals, or `check: null` for a free table. */
export async function tableCheck(models: Models, tableId: string): Promise<TableCheckView> {
  if (!isOid(tableId)) throw notFound();
  const table = await models.Table.findOne({ _id: tableId }).lean();
  if (!table) throw notFound();
  const [check, calls] = await Promise.all([
    models.Check.findOne({ tableId, status: "open" }).lean(),
    models.Call.find({ tableId, answeredAt: null }).sort({ openedAt: 1 }).lean(),
  ]);
  const base = {
    table: { id: String(table._id), name: table.name, capacity: table.capacity, sectionStaffId: idOf(table.sectionStaffId) },
    calls: calls.map((c) => ({ id: String(c._id), reason: c.reason, openedAt: c.openedAt })),
  };
  if (!check) return { ...base, check: null };
  const [lines, serverName] = await Promise.all([checkLines(models, check._id).then(maskedLines), staffName(models, check.serverStaffId)]);
  return {
    ...base,
    check: {
      id: String(check._id),
      covers: check.covers ?? null,
      openedAt: check.openedAt,
      serverStaffId: idOf(check.serverStaffId),
      serverName,
      billRequestedAt: check.billRequestedAt ?? null,
      billMethod: check.billMethod ?? null,
    },
    ...lines,
  };
}

export type Payment = { method: "card" | "cash"; amount: number; at: Date; last4: string | null };

/** A simulated payment: a card gets four random "last 4" digits (plan ruling "Card last 4"), cash gets null. */
export function newPayment(method: "card" | "cash", amount: number, at: Date): Payment {
  return { method, amount, at, last4: method === "card" ? String(randomInt(0, 10_000)).padStart(4, "0") : null };
}

const paymentView = (p: { method: "card" | "cash"; amount: number; at: Date; last4?: string | null } | null | undefined): Payment | null =>
  p ? { method: p.method, amount: p.amount, at: p.at, last4: p.last4 ?? null } : null;

// ─── Actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SeatResult = { checkId: string; tableId: string; covers: number; opened: boolean };

/**
 * Seats a table. A free table gets a new check served by the acting waiter (the partial unique index allows one open
 * check per table, so a concurrent seat or first QR order makes our insert fail with E11000). A QR-opened check
 * (covers null) gets its covers set instead. A check that already has covers → `conflict`.
 * On a duplicate key we re-read once more: if the winner was a QR order its check takes our covers; if it was
 * another seat, it has covers → `conflict`.
 */
export async function seatTable(models: Models, input: { tableId: string; covers: number; staffId: string; now: Date }): Promise<SeatResult> {
  const { tableId, covers, staffId, now } = input;
  if (!isOid(tableId)) throw notFound();
  const table = await models.Table.findOne({ _id: tableId, active: true }, { _id: 1 }).lean();
  if (!table) throw notFound();
  for (let attempt = 0; attempt < 3; attempt++) {
    const open = await models.Check.findOne({ tableId, status: "open" }).lean();
    if (!open) {
      try {
        const check = await models.Check.create({ tableId, status: "open", covers, openedAt: now, serverStaffId: staffId, orderCount: 0 });
        return { checkId: String(check._id), tableId, covers, opened: true };
      } catch (err) {
        if (isDuplicateKey(err)) continue;
        throw err;
      }
    }
    if (open.covers != null) throw conflict("This table is already seated");
    const set = await models.Check.updateOne({ _id: open._id, status: "open", covers: null }, { $set: { covers } });
    if (set.modifiedCount === 1) return { checkId: String(open._id), tableId, covers, opened: false };
  }
  throw conflict("This table is already seated");
}

export type ServedTicket = { id: string; tableId: string; station: "kitchen" | "bar"; status: string; servedAt: Date | null };

/** Marks a ready ticket served (picked up). Idempotent: a served ticket returns `changed: false`. Not ready → conflict. */
export async function markServed(models: Models, ticketId: string, now: Date): Promise<{ ticket: ServedTicket; changed: boolean }> {
  if (!isOid(ticketId)) throw notFound();
  const view = (t: { _id: Types.ObjectId; tableId: Types.ObjectId; station: "kitchen" | "bar"; status: string; servedAt?: Date | null }) => ({
    id: String(t._id),
    tableId: String(t.tableId),
    station: t.station,
    status: t.status,
    servedAt: t.servedAt ?? null,
  });
  const won = await models.Ticket.findOneAndUpdate(
    { _id: ticketId, status: "ready", servedAt: null },
    { $set: { servedAt: now } },
    { returnDocument: "after" },
  ).lean();
  if (won) return { ticket: view(won), changed: true };
  const cur = await models.Ticket.findOne({ _id: ticketId }).lean();
  if (!cur) throw notFound();
  if (cur.servedAt) return { ticket: view(cur), changed: false };
  throw conflict("Only a ready ticket can be marked served");
}

export type AnsweredCall = { id: string; tableId: string; answeredAt: Date | null; answeredBy: string | null };

/** Answers a waiter call. Idempotent: an answered call returns `changed: false` (and keeps who answered it first). */
export async function answerCall(models: Models, input: { callId: string; staffId: string; now: Date }): Promise<{ call: AnsweredCall; changed: boolean }> {
  const { callId, staffId, now } = input;
  if (!isOid(callId)) throw notFound();
  const view = (c: { _id: Types.ObjectId; tableId: Types.ObjectId; answeredAt?: Date | null; answeredBy?: Types.ObjectId | null }) => ({
    id: String(c._id),
    tableId: String(c.tableId),
    answeredAt: c.answeredAt ?? null,
    answeredBy: idOf(c.answeredBy),
  });
  const won = await models.Call.findOneAndUpdate(
    { _id: callId, answeredAt: null },
    { $set: { answeredAt: now, answeredBy: staffId } },
    { returnDocument: "after" },
  ).lean();
  if (won) return { call: view(won), changed: true };
  const cur = await models.Call.findOne({ _id: callId }).lean();
  if (!cur) throw notFound();
  return { call: view(cur), changed: false };
}

export type ClosedCheck = {
  id: string;
  tableId: string;
  status: "open" | "paid";
  covers: number | null;
  openedAt: Date;
  closedAt: Date | null;
  payment: Payment | null;
};
export type CloseResult = {
  check: ClosedCheck;
  /** False when the check was already paid (a double tap or a concurrent close): nothing was written. */
  changed: boolean;
  /** Calls at the table this close answered. */
  answeredCallIds: string[];
};

/** The check was not open in our snapshot's write (should not happen inside a transaction): re-run fresh. */
export class CheckChangedError extends Error {}

/**
 * Runs `fn` in a transaction on a fresh session; `withTransaction` retries write conflicts, and a `CheckChangedError`
 * (a conditional write that matched nothing) re-runs it up to 5 times.
 */
export async function inCheckTransaction<T>(models: Models, fn: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const session = await models.Check.db.startSession();
    try {
      let result: { value: T } | undefined;
      await session.withTransaction(async () => {
        result = { value: await fn(session) };
      });
      if (!result) throw new Error("transaction finished without a result");
      return result.value;
    } catch (err) {
      if (!(err instanceof CheckChangedError) || attempt >= 5) throw err;
    } finally {
      await session.endSession();
    }
  }
}

type PaidCheckLean = Parameters<typeof closedView>[0];

/**
 * The shared end of a check, inside the caller's transaction: moves the check `open → paid` conditionally (with
 * `set`, e.g. the full payment), and answers the table's open calls. Not open → `CheckChangedError` (the caller
 * re-runs on a fresh snapshot). Used by `closeCheck` (in full) and `payShare` (the last share).
 */
export async function markPaid(
  models: Models,
  session: ClientSession,
  input: { checkId: Id; tableId: Id; staffId: string; now: Date; set?: Record<string, unknown> },
): Promise<{ check: ClosedCheck; answeredCallIds: string[] }> {
  const { checkId, tableId, staffId, now, set } = input;
  const paid = await models.Check.findOneAndUpdate(
    { _id: checkId, status: "open" },
    { $set: { ...set, status: "paid", closedAt: now } },
    { session, returnDocument: "after" },
  ).lean<PaidCheckLean>();
  if (!paid) throw new CheckChangedError();
  const calls = await models.Call.find({ tableId, answeredAt: null }, { _id: 1 }).session(session).lean();
  if (calls.length > 0) {
    await models.Call.updateMany({ _id: { $in: calls.map((c) => c._id) }, answeredAt: null }, { $set: { answeredAt: now, answeredBy: staffId } }, { session });
  }
  return { check: closedView(paid), answeredCallIds: calls.map((c) => String(c._id)) };
}

/**
 * Closes a check with a simulated payment, in one transaction: the amount is the bill total (`billOf`: order
 * snapshots minus active comps and voids) read in the same transaction, the check moves `open → paid` conditionally,
 * and the table's open calls are answered. Already paid → `changed: false` with the stored payment (never charged
 * twice, amount never changed). A split with any paid share → `split_locked` (pay the shares instead); an unpaid split
 * is dropped. A card payment gets a random "last 4". An `amount` (the total
 * the waiter confirmed) that differs from the bill total → `amount_changed` with the current total, nothing written.
 *
 * Concurrency: `placeOrder` writes the check (`$inc orderCount` conditional on `open`) and so do we, so an order and
 * a close that overlap write-conflict and `withTransaction` re-runs the loser on a fresh snapshot. An order that
 * committed before our retry is read and charged; an order retried after our commit finds the check paid (staff →
 * `conflict`, QR → the next party's check). An order can never land on the check after its amount was fixed.
 */
export async function closeCheck(
  models: Models,
  input: { checkId: string; method: "card" | "cash"; amount?: number; staffId: string; now: Date },
): Promise<CloseResult> {
  const { checkId, method, staffId, now } = input;
  if (!isOid(checkId)) throw notFound();
  return inCheckTransaction(models, async (session) => {
    const check = await models.Check.findOne({ _id: checkId }).session(session).lean();
    if (!check) throw notFound();
    if (check.status === "paid") return { check: closedView(check), changed: false, answeredCallIds: [] };
    if (check.split?.shares.some((x) => x.payment != null)) throw new ApiError(409, "split_locked", "Part of this check is already paid");
    const amount = (await billOf(models, check._id, session)).total;
    if (input.amount !== undefined && input.amount !== amount) throw new ApiError(409, "amount_changed", "The total of this check changed", { amount });
    // Paying in full drops an unpaid split.
    const r = await markPaid(models, session, { checkId: check._id, tableId: check.tableId, staffId, now, set: { payment: newPayment(method, amount, now), split: null } });
    return { ...r, changed: true };
  });
}

function closedView(c: {
  _id: Types.ObjectId;
  tableId: Types.ObjectId;
  status: "open" | "paid";
  covers?: number | null;
  openedAt: Date;
  closedAt?: Date | null;
  payment?: { method: "card" | "cash"; amount: number; at: Date; last4?: string | null } | null;
}): ClosedCheck {
  return {
    id: String(c._id),
    tableId: String(c.tableId),
    status: c.status,
    covers: c.covers ?? null,
    openedAt: c.openedAt,
    closedAt: c.closedAt ?? null,
    payment: paymentView(c.payment),
  };
}
