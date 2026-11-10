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

type Line = { orderId: string; qty: number; name: { en: string }; options: { en: string }[]; note: string | null; status: string; lineTotal: number };

describe("guest token", () => {
  it("an unknown, missing or inactive table's token → 404", async () => {
    const { tenantId, seed } = await seedTenant(t, { liveService: false });
    expect((await guest(t, "nope").get("/api/guest/table")).statusCode).toBe(404);
    expect((await t.inject({ method: "GET", url: "/api/guest/menu" })).statusCode).toBe(404);
    await runWithTenant(tenantId, () => t.models.Table.updateOne({ _id: seed.tables.T7!.id }, { active: false }));
    const res = await guest(t, seed.tables.T7!.token).get("/api/guest/menu");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("guests never get a cookie", async () => {
    const { seed } = await seedTenant(t, { liveService: false });
    const res = await guest(t, seed.tables.T7!.token).get("/api/guest/table");
    expect(res.cookies).toHaveLength(0);
  });
});

describe("GET /api/guest/table", () => {
  it("returns the table and the open visit, or null", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const g = guest(t, seed.tables.T7!.token);
    const before = await g.get("/api/guest/table");
    expect(before.json()).toEqual({ table: { id: seed.tables.T7!.id, name: "T7" }, visit: null });
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    const check = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId: seed.tables.T7!.id }));
    const after = await g.get("/api/guest/table");
    expect(after.json().visit).toEqual({ checkId: String(check!._id), openedAt: NOW.toISOString() });
  });
});

describe("GET /api/guest/menu", () => {
  it("hides inactive items and marks the seeded 86'd items soldOut, with N left", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const burrata = await itemNamed(t, tenantId, "Burrata");
    const prawns = await itemNamed(t, tenantId, "King prawns");
    const gelato = await itemNamed(t, tenantId, "Olive oil gelato");
    const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    await runWithTenant(tenantId, () => t.models.MenuItem.updateOne({ _id: burrata.id }, { active: false }));

    const res = await guest(t, seed.tables.T7!.token).get("/api/guest/menu");
    expect(res.statusCode).toBe(200);
    const { categories, items } = res.json() as {
      categories: { id: string; name: { en: string } }[];
      items: { id: string; categoryId: string; price: number; availability: { soldOut: boolean; remaining: number | null } }[];
    };
    expect(categories.map((c) => c.name.en)).toEqual(["To share", "Raw bar", "From the fire", "Sides", "Desserts", "Cocktails", "Wine", "Zero-proof"]);
    expect(items).toHaveLength(32);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.has(burrata.id)).toBe(false);
    expect(byId.get(prawns.id)!.availability).toEqual({ soldOut: true, remaining: null });
    expect(byId.get(gelato.id)!.availability).toEqual({ soldOut: true, remaining: null });
    expect(byId.get(ribeye.id)!.availability).toEqual({ soldOut: false, remaining: 2 });
    expect(byId.get(fries.id)!.availability).toEqual({ soldOut: false, remaining: null });
    expect(byId.get(fries.id)!.price).toBe(fries.price);
    expect(JSON.stringify(res.json())).not.toContain(tenantId);
  });
});

describe("GET /api/guest/orders", () => {
  it("is { visit: null } with no open check", async () => {
    const { seed } = await seedTenant(t);
    expect((await guest(t, seed.tables.T7!.token).get("/api/guest/orders")).json()).toEqual({ visit: null });
  });

  it("groups lines as food and drinks; sent → ready follows the line's ticket", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const negroni = await itemNamed(t, tenantId, "Lodos Negroni");
    const g = guest(t, seed.tables.T7!.token);
    const sent = orderBody([{ itemId: fries.id, qty: 2, note: "Crispy" }, { itemId: negroni.id, options: [{ groupId: "gin", optionIds: ["mastic"] }] }]);
    const placed = await g.post("/api/guest/orders", sent);
    const orderId = placed.json().orderId as string;

    const res = await g.get("/api/guest/orders");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { visit: { checkId: string; openedAt: string }; food: Line[]; drinks: Line[]; totals: { food: number; drinks: number; total: number } };
    const check = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId: seed.tables.T7!.id }));
    expect(body.visit).toEqual({ checkId: String(check!._id), openedAt: NOW.toISOString() });
    // The order reply names the check it landed on (also on a replay), so the guest's cart adopts it at once.
    expect(placed.json()).toEqual({ orderId, checkId: String(check!._id) });
    expect((await g.post("/api/guest/orders", sent)).json()).toEqual({ orderId, checkId: String(check!._id) });
    expect(body.food).toEqual([
      { orderId, qty: 2, name: { en: "Truffle fries, aged parmesan", tr: "Trüflü patates, olgun parmesan" }, options: [], note: "Crispy", status: "sent", lineTotal: fries.price * 2 },
    ]);
    expect(body.drinks).toHaveLength(1);
    expect(body.drinks[0]).toMatchObject({ orderId, qty: 1, note: null, status: "sent", lineTotal: negroni.price + 6000 });
    expect(body.drinks[0]!.options.map((o) => o.en)).toEqual(["Mastic gin"]);
    expect(body.totals).toEqual({ food: fries.price * 2, drinks: negroni.price + 6000, total: fries.price * 2 + negroni.price + 6000 });

    await runWithTenant(tenantId, () => t.models.Ticket.updateOne({ orderId, station: "kitchen" }, { status: "ready", readyAt: NOW }));
    const after = (await g.get("/api/guest/orders")).json() as { food: Line[]; drinks: Line[] };
    expect(after.food[0]!.status).toBe("ready");
    expect(after.drinks[0]!.status).toBe("sent");
  });

  it("does not show another table's lines", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    await guest(t, seed.tables.T8!.token).post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect((await guest(t, seed.tables.T7!.token).get("/api/guest/orders")).json()).toEqual({ visit: null });
  });
});

describe("POST /api/guest/calls", () => {
  it("opens a call with the open check (or none) and emits call.opened", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const tableId = seed.tables.T7!.id;
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/calls", { reason: "wine" });
    expect(res.statusCode).toBe(201);
    const call = await runWithTenant(tenantId, () => t.models.Call.findById(res.json().callId));
    expect(call).toMatchObject({ reason: "wine", checkId: null, answeredAt: null });
    expect(String(call!.tableId)).toBe(tableId);
    expect(call!.openedAt).toEqual(NOW);
    expect(emit).toHaveBeenCalledWith(tenantId, "call.opened", { ids: [String(call!._id)], tableId }, ["floor", "manager", "table"]);
  });

  it("links the open check; rejects an unknown reason with 400", async () => {
    const { tenantId, seed } = await seedTenant(t);
    // B1 is seated.
    const g = guest(t, seed.tables.B1!.token);
    expect((await g.post("/api/guest/calls", { reason: "dance" })).statusCode).toBe(400);
    const res = await g.post("/api/guest/calls", { reason: "problem" });
    expect(res.statusCode).toBe(201);
    const call = await runWithTenant(tenantId, () => t.models.Call.findById(res.json().callId));
    const check = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId: seed.tables.B1!.id, status: "open" }));
    expect(String(call!.checkId)).toBe(String(check!._id));
  });
});

describe("POST /api/guest/bill", () => {
  it("no open check → 409 conflict", async () => {
    const { seed } = await seedTenant(t);
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/bill", { method: "card" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("conflict");
    expect(emit).not.toHaveBeenCalled();
  });

  it("records the bill request and emits check.updated", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const tableId = seed.tables.T7!.id;
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    emit.mockClear();
    expect((await g.post("/api/guest/bill", { method: "bitcoin" })).statusCode).toBe(400);
    const res = await g.post("/api/guest/bill", { method: "cash" });
    expect(res.statusCode).toBe(200);
    const check = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId, status: "open" }));
    expect(check!.billRequestedAt).toEqual(NOW);
    expect(check!.billMethod).toBe("cash");
    expect(res.json()).toEqual({ checkId: String(check!._id), billRequestedAt: NOW.toISOString(), billMethod: "cash" });
    expect(emit).toHaveBeenCalledWith(tenantId, "check.updated", { ids: [String(check!._id)], tableId }, ["floor", "manager", "table"]);
  });
});
