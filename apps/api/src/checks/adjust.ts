import { serviceDayOf, unitRef, type AdjustBody, type AdjustmentKind } from "@lodos/shared";
import type { ClientSession, Types } from "mongoose";
import type { AuthStaff } from "../auth/sessions";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { CheckChangedError, inCheckTransaction } from "../floor/service";
import { isOid, notFound } from "../kds/service";
import { billOf, type Bill, type BillLine } from "./bill";
import { closeIfSettled, splitView, type SplitCheck } from "./split";

/**
 * Comps and voids (spec §3.2). An adjustment covers exact units of one order line, chosen by the server: the
 * highest-index units that are neither adjusted nor in a paid share. Each add or reversal is one transaction that
 * writes the check (`$inc splitVersion`, conditional on `open`), so it write-conflicts with `closeCheck`, `payShare`,
 * `setSplit` and `placeOrder`: an adjustment can never land on a check whose amount was already charged
 * (Review Focus 2). A void also strikes the units on the KDS ticket and gives "N left" portions back.
 * Must run inside the check's tenant (the routes use `staffRoute`).
 */

type Name = { en: string; tr: string };
type Station = "kitchen" | "bar";

export type AdjustmentView = {
  id: string;
  checkId: string;
  lineRef: string;
  kind: AdjustmentKind;
  qty: number;
  /** Unit refs (`o:i:u`). */
  units: string[];
  reason: string;
  note: string | null;
  amount: number;
  itemName: Name;
  tableName: string;
  station: Station;
  requestedBy: string | null;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string;
  at: Date;
  reversedAt: Date | null;
  reversedBy: string | null;
};

type AdjustmentLean = {
  _id: Types.ObjectId;
  checkId?: Types.ObjectId | null;
  orderId?: Types.ObjectId | null;
  itemIndex?: number | null;
  units: number[];
  qty: number;
  kind: AdjustmentKind;
  reason: string;
  note?: string | null;
  amount: number;
  itemName: Name;
  tableName: string;
  station: Station;
  requestedBy?: Types.ObjectId | null;
  requestedByName: string;
  approvedBy?: Types.ObjectId | null;
  approvedByName: string;
  at: Date;
  reversedAt?: Date | null;
  reversedBy?: Types.ObjectId | null;
};

function adjustmentView(a: AdjustmentLean): AdjustmentView {
  const orderId = String(a.orderId);
  const index = a.itemIndex ?? 0;
  return {
    id: String(a._id),
    checkId: String(a.checkId),
    lineRef: `${orderId}:${index}`,
    kind: a.kind,
    qty: a.qty,
    units: a.units.map((u) => unitRef(orderId, index, u)),
    reason: a.reason,
    note: a.note ?? null,
    amount: a.amount,
    itemName: { en: a.itemName.en, tr: a.itemName.tr },
    tableName: a.tableName,
    station: a.station,
    requestedBy: a.requestedBy ? String(a.requestedBy) : null,
    requestedByName: a.requestedByName,
    approvedBy: a.approvedBy ? String(a.approvedBy) : null,
    approvedByName: a.approvedByName,
    at: a.at,
    reversedAt: a.reversedAt ?? null,
    reversedBy: a.reversedBy ? String(a.reversedBy) : null,
  };
}

export type AdjustResult = {
  adjustment: AdjustmentView;
  checkId: string;
  tableId: string;
  station: Station;
  /** The check has a split (its share amounts changed). */
  split: boolean;
  /** Tickets whose lines changed (voids). */
  ticketIds: string[];
  /** Items whose "N left" changed. */
  availabilityChanged: string[];
  /** The adjustment settled a split check (every share paid, nothing unassigned), so it was closed. */
  closed: boolean;
  answeredCallIds: string[];
};

export type ReverseResult = Omit<AdjustResult, "closed" | "answeredCallIds"> & { changed: boolean };

type CheckLean = SplitCheck & { tableId: Types.ObjectId };

const checkClosed = () => new ApiError(409, "check_closed", "This check is already paid");
const splitLocked = () => new ApiError(409, "split_locked", "Part of this check is already paid");
const conflict = (message: string) => new ApiError(409, "conflict", message);

/** Labels of the paid shares, and whether the Evenly split is locked by them. */
function paidState(check: CheckLean): { paidLabels: Set<string>; evenLocked: boolean } {
  const paidLabels = new Set((check.split?.shares ?? []).filter((s) => s.payment != null).map((s) => s.label));
  return { paidLabels, evenLocked: check.split?.mode === "even" && paidLabels.size > 0 };
}

/** Unit refs frozen in a paid share (By item). */
function frozenUnits(check: CheckLean, paidLabels: Set<string>): Set<string> {
  if (check.split?.mode !== "items" || paidLabels.size === 0) return new Set();
  return new Set(check.split.assignments.filter((a) => a.labels.some((l) => paidLabels.has(l))).map((a) => a.unit));
}

async function loadOpenCheck(models: Models, session: ClientSession, checkId: string): Promise<CheckLean> {
  const check = await models.Check.findOne({ _id: checkId }).session(session).lean<CheckLean>();
  if (!check) throw notFound();
  if (check.status === "paid") throw checkClosed();
  return check;
}

/** Writes the check so the transaction conflicts with every other writer of it; `pull` drops voided units' labels. */
async function touchCheck(models: Models, session: ClientSession, check: CheckLean, pull: string[]): Promise<CheckLean> {
  const update: Record<string, unknown> = { $inc: { splitVersion: 1 } };
  if (pull.length > 0 && check.split?.mode === "items") update.$pull = { "split.assignments": { unit: { $in: pull } } };
  const updated = await models.Check.findOneAndUpdate({ _id: check._id, status: "open" }, update, { session, returnDocument: "after" }).lean<CheckLean>();
  if (!updated) throw new CheckChangedError();
  return updated;
}

/**
 * Gives `delta` portions back (> 0) or takes them back (< 0, floored at 0, never a sold-out error) on the item's
 * availability, when the order was placed in today's service day and the item has an "N left" limit.
 */
async function moveAvailability(
  models: Models,
  session: ClientSession,
  input: { itemId: string; placedAt: Date; now: Date; delta: number },
): Promise<boolean> {
  const day = serviceDayOf(input.now);
  if (serviceDayOf(input.placedAt) !== day) return false;
  const avail = await models.Availability.findOne({ serviceDay: day, itemId: input.itemId, remaining: { $ne: null } }).session(session).lean();
  if (!avail || avail.remaining == null) return false;
  if (input.delta > 0) {
    await models.Availability.updateOne({ _id: avail._id }, { $inc: { remaining: input.delta }, $set: { soldOut: false } }, { session });
    return true;
  }
  const remaining = Math.max(0, avail.remaining + input.delta);
  if (remaining === avail.remaining) return false;
  await models.Availability.updateOne({ _id: avail._id }, { $set: { remaining, soldOut: avail.soldOut || remaining === 0 } }, { session });
  return true;
}

/** Applies `delta` voided units to the ticket line of `orderId`/`index`, then sets or clears `voidedAt`. */
async function moveTicketVoids(
  models: Models,
  session: ClientSession,
  input: { orderId: Types.ObjectId | string; index: number; station: Station; delta: number; now: Date; guardReady: boolean },
): Promise<string | null> {
  const { orderId, index, station, delta, now, guardReady } = input;
  const ticket = await models.Ticket.findOne({ orderId, station }).session(session).lean();
  if (!ticket) return null;
  const pos = ticket.items.findIndex((i) => i.orderItemIndex === index);
  if (pos < 0) return null;
  const items = ticket.items.map((i, k) => (k === pos ? { qty: i.qty, voided: Math.min(i.qty, Math.max(0, (i.voidedQty ?? 0) + delta)) } : { qty: i.qty, voided: i.voidedQty ?? 0 }));
  const allVoided = items.every((i) => i.voided >= i.qty);
  const filter: Record<string, unknown> = { _id: ticket._id };
  // A void races a bump or a check-off: a line the station already marked done is "made", so the void fails.
  if (guardReady) Object.assign(filter, { status: { $ne: "ready" }, servedAt: null, [`items.${pos}.checked`]: { $ne: true } });
  const res = await models.Ticket.updateOne(
    filter,
    { $set: { [`items.${pos}.voidedQty`]: items[pos]!.voided, voidedAt: allVoided ? (ticket.voidedAt ?? now) : null } },
    { session },
  );
  if (res.matchedCount !== 1) throw voidAfterReady();
  return String(ticket._id);
}

const voidAfterReady = () => new ApiError(409, "void_after_ready", "Already made: comp it instead");

function findLine(bill: Bill, lineRef: string): BillLine {
  const line = bill.lines.find((l) => l.lineRef === lineRef);
  if (!line) throw conflict("That line is not on this check");
  return line;
}

/** Throws if any of the adjustment's units are frozen by the split. */
function assertNotLocked(check: CheckLean, refs: string[]): void {
  const { paidLabels, evenLocked } = paidState(check);
  if (evenLocked) throw splitLocked();
  const frozen = frozenUnits(check, paidLabels);
  if (refs.some((r) => frozen.has(r))) throw new ApiError(409, "split_locked", "Items in a paid share can't change");
}

/** 404 unless the check exists in this tenant (run before the slow approval, so a foreign id never costs a PIN try). */
export async function assertCheckExists(models: Models, checkId: string): Promise<void> {
  if (!isOid(checkId) || !(await models.Check.exists({ _id: checkId }))) throw notFound();
}

/** POST /api/checks/:id/adjustments, after `approve` (which runs outside, since argon2 is slow). */
export async function addAdjustment(
  models: Models,
  input: { checkId: string; body: AdjustBody; requester: AuthStaff; approver: { id: string; name: string }; now: Date },
): Promise<AdjustResult> {
  const { checkId, body, requester, approver, now } = input;
  if (!isOid(checkId)) throw notFound();
  return inCheckTransaction(models, async (session) => {
    const check = await loadOpenCheck(models, session, checkId);
    const { paidLabels, evenLocked } = paidState(check);
    if (evenLocked) throw splitLocked();

    const bill = await billOf(models, check._id, session);
    const line = findLine(bill, body.lineRef);
    const frozen = frozenUnits(check, paidLabels);
    const free = line.units.filter((u) => u.comp == null && !frozen.has(u.ref));
    if (body.qty > free.length) throw conflict(free.length === 0 ? "No units of this line can be adjusted" : `Only ${free.length} can be adjusted`);
    const chosen = free.slice(-body.qty).reverse();
    const unitIdx = chosen.map((u) => Number(u.ref.slice(u.ref.lastIndexOf(":") + 1)));

    const order = await models.Order.findOne({ _id: line.orderId, checkId: check._id }, { placedAt: 1 }).session(session).lean();
    if (!order) throw conflict("That line is not on this check");
    if (body.kind === "void") {
      // Ready = the ticket is ready or served, or the station checked this line off.
      const ticket = await models.Ticket.findOne({ orderId: order._id, station: line.station }, { status: 1, servedAt: 1, items: 1 }).session(session).lean();
      const checked = ticket?.items.some((i) => i.orderItemIndex === line.index && i.checked) ?? false;
      if (ticket && (ticket.status === "ready" || ticket.servedAt != null || checked)) throw voidAfterReady();
    }

    const updated = await touchCheck(models, session, check, body.kind === "void" ? chosen.map((u) => u.ref) : []);
    const table = await models.Table.findOne({ _id: check.tableId }, { name: 1 }).session(session).lean();
    const [created] = await models.Adjustment.create(
      [
        {
          checkId: check._id,
          orderId: order._id,
          itemIndex: line.index,
          units: unitIdx,
          qty: body.qty,
          kind: body.kind,
          reason: body.reason,
          note: body.note || null,
          amount: line.unitTotal * body.qty,
          itemId: line.itemId,
          itemName: line.name,
          tableName: table?.name ?? "",
          station: line.station,
          requestedBy: requester.id,
          requestedByName: requester.name,
          approvedBy: approver.id,
          approvedByName: approver.name,
          at: now,
          serviceDay: serviceDayOf(now),
        },
      ],
      { session },
    );
    if (!created) throw new Error("addAdjustment: adjustment not created");

    const ticketIds: string[] = [];
    const availabilityChanged: string[] = [];
    if (body.kind === "void") {
      const tid = await moveTicketVoids(models, session, { orderId: order._id, index: line.index, station: line.station, delta: body.qty, now, guardReady: true });
      if (tid) ticketIds.push(tid);
      if (await moveAvailability(models, session, { itemId: line.itemId, placedAt: order.placedAt, now, delta: body.qty })) availabilityChanged.push(line.itemId);
    }

    // A comp or void can take the last unassigned amount off a split whose shares are all paid: it closes the check.
    let settled = { closed: false, answeredCallIds: [] as string[] };
    if (updated.split) {
      const after = await billOf(models, check._id, session);
      const view = splitView({ check: updated, tableName: "", bill: after });
      settled = await closeIfSettled(models, session, { checkId: check._id, tableId: check.tableId, view, staffId: requester.id, now });
    }

    return {
      adjustment: adjustmentView(created.toObject() as AdjustmentLean),
      checkId: String(check._id),
      tableId: String(check.tableId),
      station: line.station,
      split: updated.split != null,
      ticketIds,
      availabilityChanged,
      ...settled,
    };
  });
}

/**
 * DELETE /api/checks/:id/adjustments/:adjId (manager, check open). Idempotent: an already-reversed adjustment →
 * `changed: false`. The same split locks as adding apply. A void's reversal restores the ticket line (and brings a
 * fully voided ticket back to the KDS) and takes its portions back, floored at 0; the restored units come back
 * unassigned in a By item split.
 */
export async function reverseAdjustment(models: Models, input: { checkId: string; adjustmentId: string; staffId: string; now: Date }): Promise<ReverseResult> {
  const { checkId, adjustmentId, staffId, now } = input;
  if (!isOid(checkId) || !isOid(adjustmentId)) throw notFound();
  return inCheckTransaction(models, async (session) => {
    const check = await models.Check.findOne({ _id: checkId }).session(session).lean<CheckLean>();
    if (!check) throw notFound();
    const adj = await models.Adjustment.findOne({ _id: adjustmentId, checkId: check._id }).session(session).lean<AdjustmentLean>();
    if (!adj) throw notFound();
    const base = {
      checkId: String(check._id),
      tableId: String(check.tableId),
      station: adj.station,
      split: check.split != null,
      ticketIds: [] as string[],
      availabilityChanged: [] as string[],
    };
    if (adj.reversedAt) return { ...base, changed: false, adjustment: adjustmentView(adj) };
    if (check.status === "paid") throw checkClosed();
    const orderId = String(adj.orderId);
    const index = adj.itemIndex ?? 0;
    assertNotLocked(check, adj.units.map((u) => unitRef(orderId, index, u)));

    await touchCheck(models, session, check, []);
    const reversed = await models.Adjustment.findOneAndUpdate(
      { _id: adj._id, reversedAt: null },
      { $set: { reversedAt: now, reversedBy: staffId } },
      { session, returnDocument: "after" },
    ).lean<AdjustmentLean>();
    if (!reversed) throw new CheckChangedError();

    if (adj.kind === "void" && adj.orderId) {
      const tid = await moveTicketVoids(models, session, { orderId: adj.orderId, index, station: adj.station, delta: -adj.qty, now, guardReady: false });
      if (tid) base.ticketIds.push(tid);
      const order = await models.Order.findOne({ _id: adj.orderId }, { placedAt: 1, items: 1 }).session(session).lean();
      const itemId = order?.items[index]?.itemId;
      if (order && itemId && (await moveAvailability(models, session, { itemId: String(itemId), placedAt: order.placedAt, now, delta: -adj.qty }))) {
        base.availabilityChanged.push(String(itemId));
      }
    }
    return { ...base, changed: true, adjustment: adjustmentView(reversed) };
  });
}
