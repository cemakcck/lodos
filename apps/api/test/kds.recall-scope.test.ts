import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Types } from "mongoose";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
let t: Awaited<ReturnType<typeof makeTestApp>>;
let sid: string;

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  const seed = await seedRestaurant(t.models, "main", NOW, { liveService: true, history: false });
  const res = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: seed.staff.bar, pin: "4444" }, remoteAddress: "10.7.0.1" });
  sid = res.cookies.find((c) => c.name === "lodos_sid")!.value;
});
afterAll(() => t.close());

const recall = () => t.inject({ method: "POST", url: "/api/kds/bar/recall", cookies: { lodos_sid: sid } });

/** A ready, unserved bar ticket on `checkId`, readied at `readyAt`. */
async function readyBar(checkId: Types.ObjectId, readyAt: Date) {
  return runWithTenant("main", async () => {
    const base = await t.models.Ticket.findOne({ station: "bar" }).lean().orFail();
    const doc = await t.models.Ticket.create({ orderId: base.orderId, checkId, tableId: base.tableId, tableName: base.tableName, station: "bar", status: "ready", sentAt: new Date(readyAt.getTime() - 60_000), readyAt, items: base.items });
    return String(doc._id);
  });
}

describe("recall scope (open checks, this service day)", () => {
  it("never recalls a ticket on a paid check or from yesterday's service day; recalls the normal one", async () => {
    const { paidId, openId } = await runWithTenant("main", async () => {
      await t.models.Ticket.deleteMany({ station: "bar", status: "ready", servedAt: null });
      const open = await t.models.Check.findOne({ status: "open" }).lean().orFail();
      const paid = await t.models.Check.create({ tableId: open.tableId, status: "paid", openedAt: new Date(NOW.getTime() - 3_600_000), closedAt: NOW });
      return { paidId: paid._id, openId: open._id };
    });
    const paidTicket = await readyBar(paidId, new Date(NOW.getTime() - 60_000)); // newest, but its check is paid
    const yesterday = await readyBar(openId, new Date("2026-11-10T02:30:00Z")); // 05:30 Istanbul: previous service day
    expect((await recall()).statusCode).toBe(404);

    const normal = await readyBar(openId, new Date(NOW.getTime() - 5 * 60_000));
    const res = await recall();
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.id).toBe(normal);
    const status = (id: string) => runWithTenant("main", async () => (await t.models.Ticket.findById(id).lean().orFail()).status);
    expect(await status(paidTicket)).toBe("ready");
    expect(await status(yesterday)).toBe("ready");
  });
});
