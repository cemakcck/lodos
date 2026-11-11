import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody, LIVE_NO_HISTORY, seedTenant, type TestApp } from "./helpers";

/** Review Focus 2: a dish hidden, deleted or repriced while it sits in a guest's cart. */
let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: new Date("2026-11-10T17:00:00Z") });
});
afterAll(() => t.close());

describe("stale carts", () => {
  it("a hidden item → 409 item_unavailable with its id; nothing written", async () => {
    const { tenantId, seed } = await seedTenant(t, LIVE_NO_HISTORY);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    await runWithTenant(tenantId, () => t.models.MenuItem.updateOne({ _id: burrata.id }, { active: false }));
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", orderBody([{ itemId: fries.id }, { itemId: burrata.id }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "item_unavailable", details: { itemId: burrata.id } });
    expect(await runWithTenant(tenantId, () => t.models.Check.countDocuments({ tableId: seed.tables.T7!.id }))).toBe(0);
  });

  it("a deleted item, or an id that is not an ObjectId → item_unavailable with that id", async () => {
    const { tenantId, seed } = await seedTenant(t, LIVE_NO_HISTORY);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    await runWithTenant(tenantId, () => t.models.MenuItem.deleteOne({ _id: burrata.id }));
    const g = guest(t, seed.tables.T7!.token);
    const res = await g.post("/api/guest/orders", orderBody([{ itemId: burrata.id }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "item_unavailable", details: { itemId: burrata.id } });
    const junk = await g.post("/api/guest/orders", orderBody([{ itemId: "not-an-id" }]));
    expect(junk.statusCode).toBe(409);
    expect(junk.json().error).toMatchObject({ code: "item_unavailable", details: { itemId: "not-an-id" } });
  });

  it("an item in an inactive or deleted category → item_unavailable with its id; nothing written", async () => {
    const { tenantId, seed } = await seedTenant(t, LIVE_NO_HISTORY);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const catOf = async (id: string) => (await runWithTenant(tenantId, () => t.models.MenuItem.findById(id).lean().orFail())).categoryId;
    const g = guest(t, seed.tables.T7!.token);
    await runWithTenant(tenantId, async () => t.models.Category.updateOne({ _id: await catOf(burrata.id) }, { active: false }));
    const hidden = await g.post("/api/guest/orders", orderBody([{ itemId: burrata.id }]));
    expect(hidden.statusCode).toBe(409);
    expect(hidden.json().error).toMatchObject({ code: "item_unavailable", details: { itemId: burrata.id } });
    expect(await runWithTenant(tenantId, () => t.models.Check.countDocuments({ tableId: seed.tables.T7!.id }))).toBe(0);

    const friesCat = await catOf(fries.id);
    await runWithTenant(tenantId, () => t.models.Category.deleteOne({ _id: friesCat }));
    const gone = await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(gone.statusCode).toBe(409);
    expect(gone.json().error).toMatchObject({ code: "item_unavailable", details: { itemId: fries.id } });
  });

  it("an item repriced after the cart was built is charged at the new price", async () => {
    const { tenantId, seed } = await seedTenant(t, LIVE_NO_HISTORY);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    const body = orderBody([{ itemId: burrata.id, qty: 2 }]);
    await runWithTenant(tenantId, () => t.models.MenuItem.updateOne({ _id: burrata.id }, { price: 61_000 }));
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", body);
    expect(res.statusCode).toBe(201);
    const order = await runWithTenant(tenantId, () => t.models.Order.findById(res.json().orderId));
    expect(order!.items[0]!.unitPrice).toBe(61_000);
    expect(order!.items[0]!.lineTotal).toBe(122_000);
  });

  it("client-sent price fields are ignored", async () => {
    const { tenantId, seed } = await seedTenant(t, LIVE_NO_HISTORY);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    const body = orderBody([{ itemId: burrata.id }]);
    const tampered = {
      ...body,
      total: 1,
      items: body.items.map((i) => ({ ...i, price: 1, unitPrice: 1, lineTotal: 1, name: { en: "x", tr: "x" }, station: "bar" })),
    };
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", tampered);
    expect(res.statusCode).toBe(201);
    const order = await runWithTenant(tenantId, () => t.models.Order.findById(res.json().orderId).lean());
    expect(order!.items[0]).toMatchObject({ unitPrice: burrata.price, lineTotal: burrata.price, station: "kitchen" });
    expect(order!.items[0]!.name.en).toMatch(/^Burrata/);
    expect(order).not.toHaveProperty("total");
  });
});
