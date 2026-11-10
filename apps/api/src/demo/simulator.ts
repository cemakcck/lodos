import { serviceDayOf } from "@lodos/shared";
import { randomUUID } from "node:crypto";
import type { Models } from "../db/models";
import { runWithTenant, unscoped } from "../db/tenancy";
import { ApiError } from "../errors";
import { emitOrderPlaced, placeOrder } from "../orders/place";
import type { Realtime } from "../realtime/emit";

export const SIMULATOR_INTERVAL_MS = 30_000;
const MIN_GAP_S = 180;
const MAX_GAP_S = 300;
/** The free table the visitor is meant to try the guest flow on. */
const FREE_TABLE = "T7";

const pick = <T>(xs: T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))]!;

/**
 * Places one believable QR order from a seated table (never T7) in a sandbox, then schedules the next one 3-5 min out
 * (also when skipped, so an empty sandbox is not retried every scheduler pass). Domain errors (e.g. `sold_out` racing
 * the visitor) mean "skipped".
 */
export async function tickSimulator(
  models: Models,
  realtime: Realtime,
  tenantId: string,
  now: Date,
  rand: () => number,
): Promise<"placed" | "skipped"> {
  const nextSimAt = new Date(now.getTime() + (MIN_GAP_S + rand() * (MAX_GAP_S - MIN_GAP_S)) * 1000);
  const schedule = () =>
    unscoped("sandbox registry is not tenant-scoped", () => models.Sandbox.updateOne({ _id: tenantId }, { nextSimAt }));
  try {
    const result = await runWithTenant(tenantId, async () => {
      const open = await models.Check.find({ status: "open" }).lean();
      const tables = await models.Table.find({ _id: { $in: open.map((c) => c.tableId) }, active: true, name: { $ne: FREE_TABLE } }).lean();
      if (tables.length === 0) return null;
      const soldOut = new Set(
        (await models.Availability.find({ serviceDay: serviceDayOf(now), soldOut: true }).lean()).map((a) => String(a.itemId)),
      );
      const items = (await models.MenuItem.find({ active: true }).lean()).filter((i) => !soldOut.has(String(i._id)));
      if (items.length === 0) return null;

      const table = pick(tables, rand);
      const count = 1 + Math.floor(rand() * 3);
      const chosen = new Map<string, (typeof items)[number]>();
      for (let n = 0; n < count; n++) {
        const it = pick(items, rand);
        chosen.set(String(it._id), it);
      }
      const placed = await placeOrder(models, {
        tableId: String(table._id),
        source: "qr",
        placedBy: null,
        now,
        req: {
          idempotencyKey: randomUUID(),
          items: [...chosen.values()].map((it) => ({
            itemId: String(it._id),
            qty: 1,
            options: it.optionGroups
              .filter((g) => g.required && g.options.length > 0)
              .map((g) => ({ groupId: g.id, optionIds: [g.options[0]!.id] })),
          })),
        },
      });
      return placed;
    });
    if (!result) return "skipped";
    emitOrderPlaced(realtime, tenantId, result);
    return "placed";
  } catch (err) {
    if (err instanceof ApiError) return "skipped";
    throw err;
  } finally {
    await schedule();
  }
}

/** Ticks every connected sandbox whose simulator is on and due. One failing sandbox does not stop the rest. */
export async function runSimulatorDue(
  models: Models,
  realtime: Realtime,
  now: Date,
  isConnected: (tenantId: string) => boolean,
  rand: () => number,
  onError: (err: unknown, tenantId: string) => void = () => {},
): Promise<number> {
  const due = await unscoped("sandbox registry is not tenant-scoped", () =>
    models.Sandbox.find({ simulatorOn: true, $or: [{ nextSimAt: null }, { nextSimAt: { $lte: now } }] }).lean(),
  );
  let placed = 0;
  for (const s of due) {
    if (!isConnected(s._id)) continue;
    try {
      if ((await tickSimulator(models, realtime, s._id, now, rand)) === "placed") placed++;
    } catch (err) {
      onError(err, s._id);
    }
  }
  return placed;
}
