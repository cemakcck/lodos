import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

describe("guest abuse limits", () => {
  it("Σqty 21 → 400 validation", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const cola = await itemNamed(t, tenantId, "Cold brew");
    const res = await guest(t, seed.tables.T7!.token, "10.0.1.1").post(
      "/api/guest/orders",
      orderBody([{ itemId: fries.id, qty: 11 }, { itemId: cola.id, qty: 10 }]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation");
  });

  it("the 31st order on a check → 409 limit_exceeded", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token, "10.0.1.2");
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    // Fill the check to 30 orders directly (the per-token rate limit would stop 30 real posts).
    await runWithTenant(tenantId, async () => {
      const first = (await t.models.Order.findOne({ tableId: seed.tables.T7!.id }).lean())!;
      const copy = (i: number) => ({ ...first, _id: undefined, idempotencyKey: `fill-${i}` });
      await t.models.Order.insertMany(Array.from({ length: 29 }, (_, i) => copy(i)));
      await t.models.Check.updateOne({ _id: first.checkId }, { orderCount: 30 });
    });
    const res = await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("limit_exceeded");
  });

  it("per table token: the 11th order within 10 minutes → 429; allowed again after the window", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token, "10.0.1.3");
    for (let i = 0; i < 10; i++) expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    const refused = await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe("rate_limited");
    // Another table at the same IP is unaffected.
    expect((await guest(t, seed.tables.T8!.token, "10.0.1.3").post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    t.clock.advance(10 * 60_000 + 1);
    try {
      expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    } finally {
      t.clock.set(NOW);
    }
  });

  it("per IP: the 31st order within 10 minutes → 429", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const ip = "10.0.1.4";
    for (const name of ["T4", "T5", "T6"]) {
      const g = guest(t, seed.tables[name]!.token, ip);
      for (let i = 0; i < 10; i++) expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    }
    const res = await guest(t, seed.tables.T8!.token, ip).post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(res.statusCode).toBe(429);
    expect((await guest(t, seed.tables.T8!.token, "10.0.1.5").post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
  });

  it("call cooldown: a second call within 60 s → 429, allowed at 61 s (fixed clock)", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const g = guest(t, seed.tables.T7!.token);
    try {
      expect((await g.post("/api/guest/calls", { reason: "wine" })).statusCode).toBe(201);
      t.clock.advance(30_000);
      const again = await g.post("/api/guest/calls", { reason: "other" });
      expect(again.statusCode).toBe(429);
      expect(again.json().error.code).toBe("rate_limited");
      // Another table is not affected.
      expect((await guest(t, seed.tables.T8!.token).post("/api/guest/calls", { reason: "problem" })).statusCode).toBe(201);
      t.clock.advance(31_000);
      expect((await g.post("/api/guest/calls", { reason: "problem" })).statusCode).toBe(201);
    } finally {
      t.clock.set(NOW);
    }
    expect(await runWithTenant(tenantId, () => t.models.Call.countDocuments({ tableId: seed.tables.T7!.id }))).toBe(2);
  });

  it("a token from another sandbox can't read this table", async () => {
    const a = await seedTenant(t);
    const b = await seedTenant(t);
    const res = await guest(t, b.seed.tables.T7!.token).get("/api/guest/table");
    expect(res.statusCode).toBe(200);
    expect(res.json().table.id).toBe(b.seed.tables.T7!.id);
    expect(res.json().table.id).not.toBe(a.seed.tables.T7!.id);
    // A forged token (A's table id) resolves nothing.
    expect((await guest(t, a.seed.tables.T7!.id).get("/api/guest/table")).statusCode).toBe(404);
  });
});
