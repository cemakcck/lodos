import { lineTotal, resolveOptions, serviceDayOf, splitByStation, type OptionGroup, type OrderRequest } from "@lodos/shared";
import { isValidObjectId, type ClientSession } from "mongoose";
import type { Models, OrderDoc, TicketDoc } from "../db/models";
import { ApiError } from "../errors";
import type { Realtime } from "../realtime/emit";

export const MAX_ORDERS_PER_CHECK = 30;

export type PlaceOrderInput = {
  tableId: string;
  source: "qr" | "staff";
  /** Staff id for staff orders, null for QR orders. */
  placedBy: string | null;
  req: OrderRequest;
  now: Date;
};

export type PlaceOrderResult = {
  order: OrderDoc;
  tickets: TicketDoc[];
  /** A QR order opened the table's check. */
  checkOpened: boolean;
  /** The idempotency key was already used: this is the existing order and nothing was written. */
  replayed: boolean;
  /** Items whose "N left" count this order reduced. */
  availabilityChanged: string[];
};

/** Duplicate-key retries: a concurrent request committed the same idempotency key, or opened the same table's check. */
const MAX_ATTEMPTS = 5;
const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

/** The check read in this transaction stopped being open before we could touch it: re-run on a fresh snapshot. */
class CheckChangedError extends Error {
  constructor() {
    super("check changed during order placement");
  }
}

/**
 * Places an order atomically (one transaction): idempotency, the table's open check (opened by a first QR order),
 * the per-check limit, item / option / availability checks with "N left" decrements, the price snapshot, the order
 * and one ticket per station. Any failure aborts the transaction, so nothing is decremented or written.
 *
 * Must run inside `runWithTenant`. It emits nothing: callers call `emitOrderPlaced` after it returns (post-commit).
 *
 * Concurrency:
 * - Two orders for the last portion: both conditionally decrement the same availability doc; the second writer gets a
 *   write conflict, `withTransaction` retries it on a fresh snapshot, and it then sees `soldOut` → `sold_out`.
 * - An order racing a close of its check: the order writes the check (`$inc orderCount`, conditional on `open`), so
 *   the close and the order write-conflict and one is retried. A retried order then finds no open check: a QR order
 *   opens the next party's check (or, with a stale `expectedCheckId`, gets `check_closed`); a staff order gets `conflict`.
 *   The same conditional `$inc` enforces at most 30 orders per check, strictly.
 * - Two first orders at a free table, or two requests with one idempotency key: the loser either write-conflicts
 *   (retried by `withTransaction`) or hits the unique index (E11000, retried here). On the retry it reads the winner's
 *   committed check, or the winner's order, which it returns as a replay.
 */
export async function placeOrder(models: Models, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await placeInTransaction(models, input);
    } catch (err) {
      const retryable = isDuplicateKey(err) || err instanceof CheckChangedError;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

async function placeInTransaction(models: Models, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const session = await models.Order.db.startSession();
  try {
    let result: PlaceOrderResult | undefined;
    await session.withTransaction(async () => {
      result = await place(models, input, session);
    });
    if (!result) throw new Error("placeOrder: transaction finished without a result");
    return result;
  } finally {
    await session.endSession();
  }
}

const unavailable = (itemId: string) => new ApiError(409, "item_unavailable", "This item is no longer available", { itemId });
const soldOut = (itemId: string) => new ApiError(409, "sold_out", "Just sold out", { itemId });

async function place(models: Models, input: PlaceOrderInput, session: ClientSession): Promise<PlaceOrderResult> {
  const { Availability, Check, MenuItem, Order, Staff, Table, Ticket } = models;
  const { tableId, source, placedBy, req, now } = input;

  // 1. Idempotency: a retried request gets its order back, unchanged.
  const existing = await Order.findOne({ idempotencyKey: req.idempotencyKey }).session(session);
  if (existing) {
    if (String(existing.tableId) !== tableId) throw new ApiError(409, "conflict", "This order key was already used");
    const tickets = await Ticket.find({ orderId: existing._id }).sort({ station: 1 }).session(session);
    return { order: existing, tickets, checkOpened: false, replayed: true, availabilityChanged: [] };
  }

  const table = await Table.findOne({ _id: tableId, active: true }).session(session);
  if (!table) throw new ApiError(404, "not_found", "Table not found");

  // 2. Lines: current items, valid options, server-side prices. (Validated before touching the check.)
  for (const line of req.items) if (!isValidObjectId(line.itemId)) throw unavailable(line.itemId);
  const ids = [...new Set(req.items.map((l) => l.itemId))];
  const items = new Map((await MenuItem.find({ _id: { $in: ids } }).session(session)).map((i) => [String(i._id), i]));
  const lines = req.items.map((line) => {
    const item = items.get(line.itemId);
    if (!item || !item.active) throw unavailable(line.itemId);
    const resolved = resolveOptions(item.optionGroups as OptionGroup[], line.options);
    if (!resolved.ok) {
      throw new ApiError(400, "validation", resolved.errors.join("; "), { itemId: line.itemId, errors: resolved.errors });
    }
    const options = resolved.chosen.map((c) => ({ name: { en: c.name.en, tr: c.name.tr }, priceDelta: c.priceDelta }));
    return {
      itemId: item._id,
      name: { en: item.name.en, tr: item.name.tr },
      unitPrice: item.price,
      options,
      qty: line.qty,
      note: line.note?.trim() || null,
      seat: line.seat ?? null,
      station: item.station,
      allergens: [...item.allergens],
      lineTotal: lineTotal(item.price, options.map((o) => o.priceDelta), line.qty),
    };
  });

  // 3. The table's open check. Staff seat the table first; a first QR order opens it.
  let check = await Check.findOne({ tableId, status: "open" }).session(session);
  if (req.expectedCheckId !== undefined && (!check || String(check._id) !== req.expectedCheckId)) {
    throw new ApiError(409, "check_closed", "This table's visit has ended");
  }
  const checkOpened = !check;
  if (!check) {
    if (source === "staff") throw new ApiError(409, "conflict", "Seat the table before ordering");
    check = new Check({ tableId, status: "open", covers: null, openedAt: now, orderCount: 1, serverStaffId: table.sectionStaffId });
    await check.save({ session });
  } else {
    // Write the check we read: a close committed after our snapshot now write-conflicts, and `withTransaction` retries
    // on a fresh snapshot (where the check is no longer open). The filter also makes the per-check limit strict.
    const touched = await Check.updateOne(
      { _id: check._id, status: "open", orderCount: { $not: { $gte: MAX_ORDERS_PER_CHECK } } }, // a missing count is 0
      { $inc: { orderCount: 1 } },
      { session },
    );
    if (touched.modifiedCount !== 1) {
      const current = await Check.findById(check._id).session(session);
      if (current?.status === "open") {
        throw new ApiError(409, "limit_exceeded", `A check takes at most ${MAX_ORDERS_PER_CHECK} orders; please call your waiter`);
      }
      throw new CheckChangedError();
    }
  }

  // 4. Availability for today's service day. No doc = available, unlimited.
  const qtyByItem = new Map<string, number>();
  for (const line of req.items) qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? 0) + line.qty);
  const avails = await Availability.find({ serviceDay: serviceDayOf(now), itemId: { $in: ids } }).session(session);
  const availabilityChanged: string[] = [];
  for (const avail of avails) {
    const itemId = String(avail.itemId);
    const qty = qtyByItem.get(itemId) ?? 0;
    if (avail.soldOut) throw soldOut(itemId);
    if (avail.remaining == null) continue;
    if (avail.remaining < qty) throw soldOut(itemId);
    // Conditional on the value read: a concurrent decrement makes this match nothing (or write-conflict and retry).
    const left = avail.remaining - qty;
    const res = await Availability.updateOne(
      { _id: avail._id, soldOut: false, remaining: avail.remaining },
      { $inc: { remaining: -qty }, $set: { soldOut: left === 0 } },
      { session },
    );
    if (res.modifiedCount !== 1) throw soldOut(itemId);
    availabilityChanged.push(itemId);
  }

  // 5. The order (a snapshot) and one ticket per station.
  const [order] = await Order.create(
    [{ checkId: check._id, tableId, source, placedBy, placedAt: now, idempotencyKey: req.idempotencyKey, items: lines }],
    { session },
  );
  if (!order) throw new Error("placeOrder: order not created");

  const serverId = check.serverStaffId ?? table.sectionStaffId;
  const serverName = source === "qr" || !serverId ? null : ((await Staff.findById(serverId).session(session))?.name ?? null);
  const byStation = splitByStation(lines.map((l, orderItemIndex) => ({ ...l, orderItemIndex })));
  const ticketDocs = (["bar", "kitchen"] as const).flatMap((station) => {
    const stationLines = byStation[station];
    if (!stationLines) return [];
    return [
      {
        orderId: order._id,
        checkId: check._id,
        tableId,
        tableName: table.name,
        station,
        status: "new" as const,
        serverName,
        covers: check.covers,
        sentAt: now,
        items: stationLines.map((l) => ({
          orderItemIndex: l.orderItemIndex,
          name: l.name,
          qty: l.qty,
          options: l.options.map((o) => o.name),
          note: l.note,
          allergens: l.allergens,
          checked: false,
        })),
      },
    ];
  });
  const tickets = await Ticket.insertMany(ticketDocs, { session });

  return { order, tickets, checkOpened, replayed: false, availabilityChanged };
}

/** Post-commit events for a placed order (none for a replay). Shared by guest and staff order routes. */
export function emitOrderPlaced(realtime: Realtime, tenantId: string, result: PlaceOrderResult): void {
  if (result.replayed) return;
  const tableId = String(result.order.tableId);
  for (const ticket of result.tickets) {
    realtime.emit(tenantId, "ticket.created", { ids: [String(ticket._id)], tableId }, [ticket.station, "floor", "manager", "table"]);
  }
  if (result.checkOpened) {
    realtime.emit(tenantId, "check.updated", { ids: [String(result.order.checkId)], tableId }, ["floor", "manager", "table"]);
  }
  if (result.availabilityChanged.length > 0) {
    realtime.emit(tenantId, "availability.changed", { ids: result.availabilityChanged }, ["all"]);
  }
}
