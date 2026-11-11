import { lineRef, unitRef, type AdjustmentKind } from "@lodos/shared";
import type { ClientSession, Types } from "mongoose";
import type { Models } from "../db/models";

/**
 * The one money reader. A check's bill is its order snapshots minus the units of its active (not reversed)
 * adjustments: a comped unit stays on the bill at ₺0, a voided unit leaves it. Every amount shown or charged
 * (check detail, guest view, close, split, receipt, floor and Tonight totals) comes from here.
 * Must run inside the check's tenant.
 */

type Id = string | Types.ObjectId;
type Name = { en: string; tr: string };
export type VatRate = 10 | 20;

export type BillUnit = {
  ref: string;
  lineRef: string;
  /** Kuruş; 0 when comped. */
  unitAmount: number;
  comp: { id: string; reason: string } | null;
};

export type BillAdjustment = { id: string; kind: AdjustmentKind; qty: number; reason: string; note: string | null; approvedByName: string; at: Date };

export type BillLine = {
  lineRef: string;
  orderId: string;
  index: number;
  itemId: string;
  name: Name;
  options: Name[];
  note: string | null;
  seat: number | null;
  station: "kitchen" | "bar";
  vatRate: VatRate;
  qty: number;
  unitTotal: number;
  compedQty: number;
  voidedQty: number;
  /** Charged: unitTotal × (qty − compedQty − voidedQty). */
  lineTotal: number;
  /** unitTotal × qty. */
  originalTotal: number;
  /** Voided units excluded. */
  units: BillUnit[];
  adjustments: BillAdjustment[];
};

export type Bill = {
  lines: BillLine[];
  total: number;
  food: number;
  drinks: number;
  grossByRate: Record<VatRate, number>;
  compsAmount: number;
  voidsAmount: number;
};

type OrderLean = {
  _id: Types.ObjectId;
  checkId: Types.ObjectId;
  items: {
    itemId: Types.ObjectId;
    name: Name;
    options: { name: Name }[];
    qty: number;
    note?: string | null;
    seat?: number | null;
    station: "kitchen" | "bar";
    vatRate?: number | null;
    lineTotal: number;
  }[];
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
  approvedByName: string;
  at: Date;
};

/** Builds one check's bill from its orders (oldest first) and its active adjustments (oldest first). */
function buildBill(orders: OrderLean[], adjustments: AdjustmentLean[]): Bill {
  const byLine = new Map<string, AdjustmentLean[]>();
  for (const a of adjustments) {
    if (a.orderId == null || a.itemIndex == null) continue;
    const key = lineRef(String(a.orderId), a.itemIndex);
    byLine.set(key, [...(byLine.get(key) ?? []), a]);
  }

  const lines: BillLine[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    order.items.forEach((item, index) => {
      const ref = lineRef(orderId, index);
      const adjs = byLine.get(ref) ?? [];
      const unitTotal = Math.round(item.lineTotal / item.qty);
      const voided = new Set<number>();
      const comped = new Map<number, AdjustmentLean>();
      for (const a of adjs) {
        for (const u of a.units) {
          if (!Number.isInteger(u) || u < 0 || u >= item.qty) continue;
          if (a.kind === "void") voided.add(u);
          else if (!comped.has(u)) comped.set(u, a);
        }
      }
      // A unit both voided and comped (should not happen) counts as voided only.
      for (const u of voided) comped.delete(u);
      const units: BillUnit[] = [];
      for (let u = 0; u < item.qty; u++) {
        if (voided.has(u)) continue;
        const comp = comped.get(u);
        units.push({
          ref: unitRef(orderId, index, u),
          lineRef: ref,
          unitAmount: comp ? 0 : unitTotal,
          comp: comp ? { id: String(comp._id), reason: comp.reason } : null,
        });
      }
      const compedQty = comped.size;
      const voidedQty = voided.size;
      lines.push({
        lineRef: ref,
        orderId,
        index,
        itemId: String(item.itemId),
        name: { en: item.name.en, tr: item.name.tr },
        options: item.options.map((o) => ({ en: o.name.en, tr: o.name.tr })),
        note: item.note ?? null,
        seat: item.seat ?? null,
        station: item.station,
        vatRate: item.vatRate === 20 ? 20 : 10,
        qty: item.qty,
        unitTotal,
        compedQty,
        voidedQty,
        lineTotal: unitTotal * (item.qty - compedQty - voidedQty),
        originalTotal: unitTotal * item.qty,
        units,
        adjustments: adjs.map((a) => ({
          id: String(a._id),
          kind: a.kind,
          qty: a.qty,
          reason: a.reason,
          note: a.note ?? null,
          approvedByName: a.approvedByName,
          at: a.at,
        })),
      });
    });
  }

  const bill: Bill = { lines, total: 0, food: 0, drinks: 0, grossByRate: { 10: 0, 20: 0 }, compsAmount: 0, voidsAmount: 0 };
  for (const l of lines) {
    bill.total += l.lineTotal;
    if (l.station === "kitchen") bill.food += l.lineTotal;
    else bill.drinks += l.lineTotal;
    bill.grossByRate[l.vatRate] += l.lineTotal;
    bill.compsAmount += l.unitTotal * l.compedQty;
    bill.voidsAmount += l.unitTotal * l.voidedQty;
  }
  return bill;
}

/** Bills of several checks in two queries, keyed by check id (a check with no orders gets an empty bill). */
export async function billsOf(models: Models, checkIds: Id[], session?: ClientSession): Promise<Map<string, Bill>> {
  const out = new Map<string, Bill>();
  if (checkIds.length === 0) return out;
  const ids = checkIds.map(String);
  const readOrders = () =>
    models.Order.find({ checkId: { $in: ids } }, { checkId: 1, items: 1, placedAt: 1 })
      .sort({ placedAt: 1, _id: 1 })
      .session(session ?? null)
      .lean<OrderLean[]>();
  const readAdjustments = () =>
    models.Adjustment.find({ checkId: { $in: ids }, reversedAt: null })
      .sort({ at: 1, _id: 1 })
      .session(session ?? null)
      .lean<AdjustmentLean[]>();
  // Operations inside a transaction must not run in parallel on its session.
  const [orders, adjustments] = session
    ? [await readOrders(), await readAdjustments()]
    : await Promise.all([readOrders(), readAdjustments()]);
  const group = <T extends { checkId?: Types.ObjectId | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r.checkId);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const ordersOf = group(orders);
  const adjsOf = group(adjustments);
  for (const id of ids) out.set(id, buildBill(ordersOf.get(id) ?? [], adjsOf.get(id) ?? []));
  return out;
}

/** One check's bill. Pass `session` to read inside a transaction (e.g. `closeCheck`). */
export async function billOf(models: Models, checkId: Id, session?: ClientSession): Promise<Bill> {
  return (await billsOf(models, [checkId], session)).get(String(checkId))!;
}
