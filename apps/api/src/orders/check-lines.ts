import { checkTotals, guestItemStatus, type GuestItemStatus } from "@lodos/shared";
import type { Types } from "mongoose";
import type { Models } from "../db/models";

type Name = { en: string; tr: string };

/** One order line on a check, with its status derived from its station's ticket for that order. */
export type CheckLine = {
  orderId: string;
  /** The station ticket carrying this line (null only if the ticket is missing). */
  ticketId: string | null;
  qty: number;
  name: Name;
  options: Name[];
  note: string | null;
  seat: number | null;
  status: GuestItemStatus;
  lineTotal: number;
};

export type CheckTotals = { food: number; drinks: number; total: number };
export type CheckLines = { food: CheckLine[]; drinks: CheckLine[]; totals: CheckTotals };

/**
 * Every line on a check, oldest order first, grouped as Food (kitchen) and Drinks (bar), with totals summed from the
 * stored price snapshots. Shared by the guest "Your table" view, the waiter's check detail and the print page.
 * Must run inside the check's tenant.
 */
export async function checkLines(models: Models, checkId: string | Types.ObjectId): Promise<CheckLines> {
  const [orders, tickets] = await Promise.all([
    models.Order.find({ checkId }).sort({ placedAt: 1, _id: 1 }).lean(),
    models.Ticket.find({ checkId }).lean(),
  ]);
  const ticketOf = new Map(tickets.map((t) => [`${String(t.orderId)}:${t.station}`, t]));

  const food: CheckLine[] = [];
  const drinks: CheckLine[] = [];
  const all: { station: "kitchen" | "bar"; lineTotal: number }[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    for (const line of order.items) {
      const ticket = ticketOf.get(`${orderId}:${line.station}`);
      const status: GuestItemStatus = ticket
        ? guestItemStatus({ status: ticket.status, servedAt: ticket.servedAt, anyChecked: ticket.items.some((i) => i.checked) })
        : "sent";
      const out: CheckLine = {
        orderId,
        ticketId: ticket ? String(ticket._id) : null,
        qty: line.qty,
        name: { en: line.name.en, tr: line.name.tr },
        options: line.options.map((o) => ({ en: o.name.en, tr: o.name.tr })),
        note: line.note ?? null,
        seat: line.seat ?? null,
        status,
        lineTotal: line.lineTotal,
      };
      (line.station === "kitchen" ? food : drinks).push(out);
      all.push({ station: line.station, lineTotal: line.lineTotal });
    }
  }
  return { food, drinks, totals: checkTotals(all) };
}
