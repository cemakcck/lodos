import { serviceDayOf } from "@lodos/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import type { Realtime } from "../src/realtime/emit";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

let emit: Mock<Realtime["emit"]>;
beforeEach(() => {
  emit = vi.fn<Realtime["emit"]>();
  t.app.realtime.emit = emit;
});

const ribeyeLine = (itemId: string) => ({ itemId, options: [{ groupId: "doneness", optionIds: ["rare"] }] });

describe("idempotency", () => {
  it("the same key posted twice → one order, the same id, decremented once, events once", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
    const body = orderBody([ribeyeLine(ribeye.id)]);
    const g = guest(t, seed.tables.T7!.token);
    const first = await g.post("/api/guest/orders", body);
    const second = await g.post("/api/guest/orders", body);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().orderId).toBe(first.json().orderId);
    await runWithTenant(tenantId, async () => {
      expect(await t.models.Order.countDocuments({ idempotencyKey: body.idempotencyKey })).toBe(1);
      expect(await t.models.Ticket.countDocuments({ orderId: first.json().orderId })).toBe(1);
      const avail = await t.models.Availability.findOne({ serviceDay: serviceDayOf(NOW), itemId: ribeye.id });
      expect(avail!.remaining).toBe(1);
    });
    expect(emit.mock.calls.filter((c) => c[1] === "ticket.created")).toHaveLength(1);
  });

  it("concurrent requests with the same key → one order, every response carries its id", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
    const body = orderBody([ribeyeLine(ribeye.id)]);
    const g = guest(t, seed.tables.T7!.token);
    const results = await Promise.all([1, 2, 3].map(() => g.post("/api/guest/orders", body)));
    for (const r of results) expect([200, 201]).toContain(r.statusCode);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.json().orderId));
    expect(ids.size).toBe(1);
    await runWithTenant(tenantId, async () => {
      expect(await t.models.Order.countDocuments({ idempotencyKey: body.idempotencyKey })).toBe(1);
      expect(await t.models.Check.countDocuments({ tableId: seed.tables.T7!.id })).toBe(1);
      const avail = await t.models.Availability.findOne({ serviceDay: serviceDayOf(NOW), itemId: ribeye.id });
      expect(avail!.remaining).toBe(1);
    });
    expect(emit.mock.calls.filter((c) => c[1] === "ticket.created")).toHaveLength(1);
  });

  it("a key already used at another table → 409 conflict, no new order", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const body = orderBody([{ itemId: fries.id }]);
    expect((await guest(t, seed.tables.T7!.token).post("/api/guest/orders", body)).statusCode).toBe(201);
    const other = await guest(t, seed.tables.T8!.token).post("/api/guest/orders", body);
    expect(other.statusCode).toBe(409);
    expect(other.json().error.code).toBe("conflict");
    expect(await runWithTenant(tenantId, () => t.models.Check.countDocuments({ tableId: seed.tables.T8!.id }))).toBe(0);
  });
});
