import { checkTotals } from "@lodos/shared";
import type { Models } from "../db/models/index";
import { serviceDayStart } from "../kds/service";

export type Tonight = {
  covers: number;
  revenue: number;
  openChecks: number;
  openTotal: number;
  avgTicketMs: number;
  topItems: { name: { en: string; tr: string }; qty: number }[];
};

/** Summary of the service day containing `now` (06:00 Istanbul start). Must run inside the manager's tenant. */
export async function tonight(models: Models, now: Date): Promise<Tonight> {
  const from = serviceDayStart(now);
  const to = serviceDayStart(new Date(from.getTime() + 27 * 3_600_000));
  const day = { $gte: from, $lt: to };
  const [opened, paid, open, ready, top] = await Promise.all([
    models.Check.find({ openedAt: day }, { covers: 1 }).lean(),
    models.Check.find({ status: "paid", "payment.at": day }, { payment: 1 }).lean(),
    // "Open checks" means every check currently open, not only those opened today.
    models.Check.find({ status: "open" }, { _id: 1 }).lean(),
    models.Ticket.find({ status: "ready", readyAt: day }, { sentAt: 1, readyAt: 1 }).lean(),
    models.Order.aggregate<{ _id: unknown; name: { en: string; tr: string }; qty: number }>([
      { $match: { placedAt: day } },
      { $unwind: "$items" },
      { $group: { _id: "$items.itemId", name: { $first: "$items.name" }, qty: { $sum: "$items.qty" } } },
      { $sort: { qty: -1, _id: 1 } },
      { $limit: 5 },
    ]),
  ]);
  const openOrders = open.length ? await models.Order.find({ checkId: { $in: open.map((c) => c._id) } }, { items: 1 }).lean() : [];
  const times = ready.filter((t) => t.readyAt).map((t) => t.readyAt!.getTime() - t.sentAt.getTime());
  return {
    covers: opened.reduce((n, c) => n + (c.covers ?? 0), 0),
    revenue: paid.reduce((n, c) => n + (c.payment?.amount ?? 0), 0),
    openChecks: open.length,
    openTotal: checkTotals(openOrders.flatMap((o) => o.items.map((i) => ({ station: i.station, lineTotal: i.lineTotal })))).total,
    avgTicketMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    topItems: top.map((r) => ({ name: { en: r.name.en, tr: r.name.tr }, qty: r.qty })),
  };
}
