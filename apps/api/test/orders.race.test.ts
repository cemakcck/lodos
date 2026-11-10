import { serviceDayOf } from "@lodos/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { placeOrder } from "../src/orders/place";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
const DAY = serviceDayOf(NOW);
const ribeyeLine = (itemId: string, qty = 1) => ({ itemId, qty, options: [{ groupId: "doneness", optionIds: ["rare"] }] });

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

async function setRemaining(tenantId: string, itemId: string, remaining: number) {
  await runWithTenant(tenantId, () => t.models.Availability.updateOne({ serviceDay: DAY, itemId }, { remaining, soldOut: false }));
}

describe("the last portion", () => {
  it("two concurrent orders for the last ribeye: exactly one 201, one 409 sold_out; the loser leaves no trace", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
    await setRemaining(tenantId, ribeye.id, 1);

    // Two free tables, so the loser would have opened its own check.
    const [a, b] = await Promise.all([
      guest(t, seed.tables.T7!.token).post("/api/guest/orders", orderBody([ribeyeLine(ribeye.id)])),
      guest(t, seed.tables.T1!.token).post("/api/guest/orders", orderBody([ribeyeLine(ribeye.id)])),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error).toMatchObject({ code: "sold_out", details: { itemId: ribeye.id } });

    await runWithTenant(tenantId, async () => {
      const avail = await t.models.Availability.findOne({ serviceDay: DAY, itemId: ribeye.id });
      expect(avail).toMatchObject({ remaining: 0, soldOut: true });
      const tables = [seed.tables.T7!.id, seed.tables.T1!.id];
      expect(await t.models.Check.countDocuments({ tableId: { $in: tables } })).toBe(1);
      expect(await t.models.Order.countDocuments({ tableId: { $in: tables } })).toBe(1);
      expect(await t.models.Ticket.countDocuments({ tableId: { $in: tables } })).toBe(1);
    });
  });

  it("qty above remaining → sold_out and remaining is unchanged; the whole order is rolled back", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    // Two lines of the same item sum against the same count.
    const res = await guest(t, seed.tables.T7!.token).post(
      "/api/guest/orders",
      orderBody([{ itemId: fries.id }, ribeyeLine(ribeye.id, 2), ribeyeLine(ribeye.id, 1)]),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("sold_out");
    await runWithTenant(tenantId, async () => {
      expect(await t.models.Availability.findOne({ serviceDay: DAY, itemId: ribeye.id })).toMatchObject({ remaining: 2, soldOut: false });
      expect(await t.models.Check.countDocuments({ tableId: seed.tables.T7!.id })).toBe(0);
    });
  });

  it("an item with no availability doc for today is unlimited; yesterday's 86 does not carry over", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const prawns = await itemNamed(t, tenantId, "King prawns");
    await runWithTenant(tenantId, () => t.models.Availability.updateOne({ itemId: prawns.id }, { serviceDay: "2026-11-09" }));
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", orderBody([{ itemId: prawns.id, qty: 5 }]));
    expect(res.statusCode).toBe(201);
  });
});

describe("the first order at a free table", () => {
  it("concurrent first orders open exactly one check and both land on it", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    const results = await Promise.all([1, 2, 3].map(() => g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    await runWithTenant(tenantId, async () => {
      const checks = await t.models.Check.find({ tableId: seed.tables.T7!.id });
      expect(checks).toHaveLength(1);
      expect(await t.models.Order.countDocuments({ checkId: checks[0]!._id })).toBe(3);
    });
  });
});

describe("deterministic interleavings (a competitor commits inside our transaction's window)", () => {
  it("a check opened by a competitor after our read is reused, not duplicated", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const tableId = seed.tables.T7!.id;
    const Check = t.models.Check;
    const original = Check.prototype.save;
    let competitorId: string | undefined;
    const spy = vi.spyOn(Check.prototype, "save").mockImplementation(async function (this: InstanceType<typeof Check>, ...args: unknown[]) {
      if (!competitorId) {
        // Outside our session: committed immediately, like a concurrent request that won.
        const c = await Check.collection.insertOne({ tenantId, tableId: this.tableId, status: "open", covers: null, openedAt: NOW, serverStaffId: null });
        competitorId = String(c.insertedId);
      }
      return original.apply(this, args as Parameters<typeof original>);
    });
    try {
      const result = await runWithTenant(tenantId, () =>
        placeOrder(t.models, { tableId, source: "qr", placedBy: null, req: { idempotencyKey: randomUUID(), items: [{ itemId: fries.id, qty: 1, options: [] }] }, now: NOW }),
      );
      expect(String(result.order.checkId)).toBe(competitorId);
      expect(result.checkOpened).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(await runWithTenant(tenantId, () => Check.countDocuments({ tableId }))).toBe(1);
  });

  it("an order committed by a competitor with our idempotency key is returned as a replay", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    // B1 is seated, so neither transaction writes before the order insert (the winner can commit while we wait).
    const tableId = seed.tables.B1!.id;
    const key = randomUUID();
    const req = { idempotencyKey: key, items: [{ itemId: fries.id, qty: 1, options: [] }] };
    const Order = t.models.Order;
    const original = Order.create.bind(Order);
    let winnerId: string | undefined;
    const spy = vi.spyOn(Order, "create").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      // The winning request: its own committed transaction, with the same key.
      const winner = await placeOrder(t.models, { tableId, source: "qr", placedBy: null, req, now: NOW });
      winnerId = String(winner.order._id);
      return original(...args);
    }) as typeof Order.create);
    try {
      const result = await runWithTenant(tenantId, () => placeOrder(t.models, { tableId, source: "qr", placedBy: null, req, now: NOW }));
      expect(result.replayed).toBe(true);
      expect(String(result.order._id)).toBe(winnerId);
    } finally {
      spy.mockRestore();
    }
    await runWithTenant(tenantId, async () => {
      expect(await Order.countDocuments({ idempotencyKey: key })).toBe(1);
      expect(await t.models.Check.countDocuments({ tableId, status: "open" })).toBe(1);
      expect(await t.models.Ticket.countDocuments({ orderId: winnerId })).toBe(1);
    });
  });
});
