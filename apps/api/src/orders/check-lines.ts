import { guestItemStatus, type GuestItemStatus } from "@lodos/shared";
import type { Types } from "mongoose";
import { billOf, type BillAdjustment } from "../checks/bill";
import type { Models } from "../db/models";

type Name = { en: string; tr: string };

/** One order line on a check, with its status derived from its station's ticket for that order. */
export type CheckLine = {
  orderId: string;
  /** `orderId:index`, the line's ref in the bill. */
  lineRef: string;
  /** The station ticket carrying this line (null only if the ticket is missing). */
  ticketId: string | null;
  qty: number;
  name: Name;
  options: Name[];
  note: string | null;
  seat: number | null;
  status: GuestItemStatus;
  /** Charged amount: comped and voided units excluded. */
  lineTotal: number;
  compedQty: number;
  voidedQty: number;
  /** The line as ordered, before comps and voids. */
  originalTotal: number;
  adjustments: BillAdjustment[];
};

export type CheckTotals = { food: number; drinks: number; total: number };
export type CheckLines = { food: CheckLine[]; drinks: CheckLine[]; totals: CheckTotals };

/**
 * Every line on a check, oldest order first, grouped as Food (kitchen) and Drinks (bar), with charged totals from
 * `billOf`. Shared by the guest "Your table" view, the waiter's check detail and the print page.
 * Must run inside the check's tenant.
 */
export async function checkLines(models: Models, checkId: string | Types.ObjectId): Promise<CheckLines> {
  const [bill, tickets] = await Promise.all([billOf(models, checkId), models.Ticket.find({ checkId }).lean()]);
  const ticketOf = new Map(tickets.map((t) => [`${String(t.orderId)}:${t.station}`, t]));

  const food: CheckLine[] = [];
  const drinks: CheckLine[] = [];
  for (const line of bill.lines) {
    const ticket = ticketOf.get(`${line.orderId}:${line.station}`);
    const status: GuestItemStatus = ticket
      ? guestItemStatus({ status: ticket.status, servedAt: ticket.servedAt, anyChecked: ticket.items.some((i) => i.checked) })
      : "sent";
    const out: CheckLine = {
      orderId: line.orderId,
      lineRef: line.lineRef,
      ticketId: ticket ? String(ticket._id) : null,
      qty: line.qty,
      name: line.name,
      options: line.options,
      note: line.note,
      seat: line.seat,
      status,
      lineTotal: line.lineTotal,
      compedQty: line.compedQty,
      voidedQty: line.voidedQty,
      originalTotal: line.originalTotal,
      adjustments: line.adjustments,
    };
    (line.station === "kitchen" ? food : drinks).push(out);
  }
  return { food, drinks, totals: { food: bill.food, drinks: bill.drinks, total: bill.total } };
}
