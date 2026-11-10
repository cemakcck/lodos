import { checkTotals, guestItemStatus, type GuestItemStatus } from "@lodos/shared";
import type { Models } from "../db/models";

type Name = { en: string; tr: string };

export type GuestVisit = { checkId: string; openedAt: Date };

export type GuestOrderLine = {
  orderId: string;
  qty: number;
  name: Name;
  options: Name[];
  note: string | null;
  status: GuestItemStatus;
  lineTotal: number;
};

export type GuestOrdersView =
  | { visit: null }
  | { visit: GuestVisit; food: GuestOrderLine[]; drinks: GuestOrderLine[]; totals: { food: number; drinks: number; total: number } };

/** The table's open check, or null. Must run inside the table's tenant. */
export async function openVisit(models: Models, tableId: string): Promise<GuestVisit | null> {
  const check = await models.Check.findOne({ tableId, status: "open" }).lean();
  return check ? { checkId: String(check._id), openedAt: check.openedAt } : null;
}

/**
 * "Your table": every line on the table's open check, oldest order first, grouped as Food (kitchen) and Drinks (bar).
 * Each line's status comes from its station's ticket for that order. Totals are summed from the stored snapshots.
 */
export async function guestOrdersView(models: Models, tableId: string): Promise<GuestOrdersView> {
  const visit = await openVisit(models, tableId);
  if (!visit) return { visit: null };

  const [orders, tickets] = await Promise.all([
    models.Order.find({ checkId: visit.checkId }).sort({ placedAt: 1, _id: 1 }).lean(),
    models.Ticket.find({ checkId: visit.checkId }).lean(),
  ]);
  const ticketOf = new Map(tickets.map((t) => [`${String(t.orderId)}:${t.station}`, t]));

  const food: GuestOrderLine[] = [];
  const drinks: GuestOrderLine[] = [];
  const all: { station: "kitchen" | "bar"; lineTotal: number }[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    for (const line of order.items) {
      const ticket = ticketOf.get(`${orderId}:${line.station}`);
      const status: GuestItemStatus = ticket
        ? guestItemStatus({ status: ticket.status, servedAt: ticket.servedAt, anyChecked: ticket.items.some((i) => i.checked) })
        : "sent";
      const out: GuestOrderLine = {
        orderId,
        qty: line.qty,
        name: { en: line.name.en, tr: line.name.tr },
        options: line.options.map((o) => ({ en: o.name.en, tr: o.name.tr })),
        note: line.note ?? null,
        status,
        lineTotal: line.lineTotal,
      };
      (line.station === "kitchen" ? food : drinks).push(out);
      all.push({ station: line.station, lineTotal: line.lineTotal });
    }
  }
  return { visit, food, drinks, totals: checkTotals(all) };
}
