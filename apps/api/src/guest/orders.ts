import type { GuestItemStatus } from "@lodos/shared";
import type { Models } from "../db/models";
import { checkLines, type CheckLine } from "../orders/check-lines";

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
 * Built on `checkLines` (shared with the waiter's check detail), without the staff-only fields.
 */
export async function guestOrdersView(models: Models, tableId: string): Promise<GuestOrdersView> {
  const visit = await openVisit(models, tableId);
  if (!visit) return { visit: null };
  const { food, drinks, totals } = await checkLines(models, visit.checkId);
  const guestLine = ({ orderId, qty, name, options, note, status, lineTotal }: CheckLine): GuestOrderLine => ({
    orderId,
    qty,
    name,
    options,
    note,
    status,
    lineTotal,
  });
  return { visit, food: food.map(guestLine), drinks: drinks.map(guestLine), totals };
}
