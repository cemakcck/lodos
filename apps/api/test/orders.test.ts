import { checkTotals, lineTotal, serviceDayOf, type OrderRequest } from "@lodos/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import type { Realtime } from "../src/realtime/emit";
import { placeOrder } from "../src/orders/place";
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

async function mixedOrder(tenantId: string) {
  const ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
  const fries = await itemNamed(t, tenantId, "Truffle fries");
  const negroni = await itemNamed(t, tenantId, "Lodos Negroni");
  const body = orderBody([
    { itemId: ribeye.id, options: [{ groupId: "doneness", optionIds: ["medium-rare"] }], note: "No salt" },
    { itemId: negroni.id, qty: 2, options: [{ groupId: "gin", optionIds: ["barrel-aged"] }] },
    { itemId: fries.id },
  ]);
  return { ribeye, fries, negroni, body };
}

describe("POST /api/guest/orders", () => {
  it("a QR order at free T7 opens a check, one ticket per station, server-side totals, serverName null", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const { ribeye, fries, negroni, body } = await mixedOrder(tenantId);
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", body);
    expect(res.statusCode).toBe(201);
    const { orderId } = res.json() as { orderId: string };

    await runWithTenant(tenantId, async () => {
      const checks = await t.models.Check.find({ tableId: seed.tables.T7!.id });
      expect(checks).toHaveLength(1);
      const check = checks[0]!;
      expect(check.status).toBe("open");
      expect(check.covers).toBeNull();
      expect(String(check.serverStaffId)).toBe(seed.staff.waiter);
      expect(check.openedAt).toEqual(NOW);
      expect(check.orderCount).toBe(1);

      const order = (await t.models.Order.findById(orderId))!;
      expect(String(order.checkId)).toBe(String(check._id));
      expect(order.source).toBe("qr");
      expect(order.placedBy).toBeNull();
      expect(order.placedAt).toEqual(NOW);
      expect(order.items.map((l) => [String(l.itemId), l.unitPrice, l.qty, l.station])).toEqual([
        [ribeye.id, ribeye.price, 1, "kitchen"],
        [negroni.id, negroni.price, 2, "bar"],
        [fries.id, fries.price, 1, "kitchen"],
      ]);
      expect(order.items[0]!.note).toBe("No salt");
      expect(order.items[0]!.allergens).toEqual(["celery"]);
      expect(order.items[1]!.options.map((o) => [o.name.en, o.priceDelta])).toEqual([["Barrel-aged gin", 9000]]);
      expect(order.items[1]!.lineTotal).toBe(lineTotal(negroni.price, [9000], 2));

      const totals = checkTotals(order.items.map((l) => ({ station: l.station, lineTotal: l.lineTotal })));
      expect(totals.food).toBe(ribeye.price + fries.price);
      expect(totals.drinks).toBe((negroni.price + 9000) * 2);

      const tickets = await t.models.Ticket.find({ orderId }).sort({ station: 1 });
      expect(tickets.map((x) => x.station)).toEqual(["bar", "kitchen"]);
      for (const tk of tickets) {
        expect(tk.tableName).toBe("T7");
        expect(tk.serverName).toBeNull();
        expect(tk.covers).toBeNull();
        expect(tk.sentAt).toEqual(NOW);
        expect(tk.status).toBe("new");
        expect(String(tk.checkId)).toBe(String(check._id));
      }
      const [bar, kitchen] = tickets;
      expect(bar!.items.map((i) => [i.orderItemIndex, i.name.en, i.qty])).toEqual([[1, "Lodos Negroni", 2]]);
      expect(bar!.items[0]!.options.map((o) => o.en)).toEqual(["Barrel-aged gin"]);
      expect(kitchen!.items.map((i) => i.orderItemIndex)).toEqual([0, 2]);
      expect(kitchen!.items[0]!.note).toBe("No salt");
      expect(kitchen!.items[0]!.allergens).toEqual(["celery"]);

      const avail = await t.models.Availability.findOne({ serviceDay: serviceDayOf(NOW), itemId: ribeye.id });
      expect(avail!.remaining).toBe(1);
    });
  });

  it("a second order lands on the same open check", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    await runWithTenant(tenantId, async () => {
      expect(await t.models.Check.countDocuments({ tableId: seed.tables.T7!.id })).toBe(1);
      const check = await t.models.Check.findOne({ tableId: seed.tables.T7!.id });
      expect(await t.models.Order.countDocuments({ checkId: check!._id })).toBe(2);
    });
  });

  it("an order at a table whose check was paid opens a new check (the next party)", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    const first = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId: seed.tables.T7!.id }));
    await runWithTenant(tenantId, () => t.models.Check.updateOne({ _id: first!._id }, { status: "paid", closedAt: NOW }));
    const res = await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(res.statusCode).toBe(201);
    const order = await runWithTenant(tenantId, () => t.models.Order.findById(res.json().orderId));
    expect(String(order!.checkId)).not.toBe(String(first!._id));
  });

  it("emits ticket.created per ticket and check.updated for the new check, after commit", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const { body } = await mixedOrder(tenantId);
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", body);
    expect(res.statusCode).toBe(201);
    const tableId = seed.tables.T7!.id;
    const tickets = await runWithTenant(tenantId, () => t.models.Ticket.find({ orderId: res.json().orderId }));
    const created = emit.mock.calls.filter((c) => c[1] === "ticket.created");
    expect(created).toHaveLength(2);
    for (const tk of tickets) {
      expect(created).toContainEqual([tenantId, "ticket.created", { ids: [String(tk._id)], tableId }, [tk.station, "floor", "manager", "table"]]);
    }
    const check = await runWithTenant(tenantId, () => t.models.Check.findOne({ tableId }));
    expect(emit).toHaveBeenCalledWith(tenantId, "check.updated", { ids: [String(check!._id)], tableId }, ["floor", "manager", "table"]);
    // Every emitted id exists in the database: the emit ran after commit.
    for (const c of emit.mock.calls) expect(c[0]).toBe(tenantId);
  });

  it("emits nothing when the order fails with sold_out", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const prawns = await itemNamed(t, tenantId, "King prawns");
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", orderBody([{ itemId: prawns.id }]));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "sold_out", details: { itemId: prawns.id } });
    expect(emit).not.toHaveBeenCalled();
    expect(await runWithTenant(tenantId, () => t.models.Check.countDocuments({ tableId: seed.tables.T7!.id }))).toBe(0);
  });

  it("validates the body and rejects an unknown or missing token with 404", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const bad = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", { idempotencyKey: "nope", items: [] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("validation");
    expect((await guest(t, "not-a-token").post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(404);
    const none = await t.inject({ method: "POST", url: "/api/guest/orders", payload: orderBody([{ itemId: fries.id }]) });
    expect(none.statusCode).toBe(404);
  });
});

describe("expectedCheckId: a stale guest page cannot order onto the next party's check", () => {
  it("a stale id after close → 409 check_closed, no order, no new check", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const tableId = seed.tables.T7!.id;
    const g = guest(t, seed.tables.T7!.token);
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    const visit = (await g.get("/api/guest/table")).json().visit as { checkId: string };
    await runWithTenant(tenantId, () => t.models.Check.updateOne({ _id: visit.checkId }, { status: "paid", closedAt: NOW }));
    emit.mockClear();

    const res = await g.post("/api/guest/orders", { ...orderBody([{ itemId: fries.id }]), expectedCheckId: visit.checkId });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("check_closed");
    expect(emit).not.toHaveBeenCalled();
    await runWithTenant(tenantId, async () => {
      expect(await t.models.Check.countDocuments({ tableId })).toBe(1);
      expect(await t.models.Order.countDocuments({ tableId })).toBe(1);
    });
  });

  it("a stale id while another party's check is open → check_closed", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    const old = (await g.get("/api/guest/table")).json().visit.checkId as string;
    await runWithTenant(tenantId, () => t.models.Check.updateOne({ _id: old }, { status: "paid", closedAt: NOW }));
    await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }])); // the next party
    const res = await g.post("/api/guest/orders", { ...orderBody([{ itemId: fries.id }]), expectedCheckId: old });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("check_closed");
  });

  it("the matching id is accepted; absent at a free table opens a check", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    const visit = (await g.get("/api/guest/table")).json().visit as { checkId: string };
    const res = await g.post("/api/guest/orders", { ...orderBody([{ itemId: fries.id }]), expectedCheckId: visit.checkId });
    expect(res.statusCode).toBe(201);
    const order = await runWithTenant(tenantId, () => t.models.Order.findById(res.json().orderId));
    expect(String(order!.checkId)).toBe(visit.checkId);
    const check = await runWithTenant(tenantId, () => t.models.Check.findById(visit.checkId));
    expect(check!.orderCount).toBe(2);
  });

  it("an expectedCheckId at a free table → check_closed (the page belongs to an ended visit)", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const res = await guest(t, seed.tables.T7!.token).post("/api/guest/orders", {
      ...orderBody([{ itemId: fries.id }]),
      expectedCheckId: "665f0c0c0c0c0c0c0c0c0c0c",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("check_closed");
    expect(await runWithTenant(tenantId, () => t.models.Check.countDocuments({ tableId: seed.tables.T7!.id }))).toBe(0);
  });

  it("an idempotent replay returns the old order even after its check closed", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const g = guest(t, seed.tables.T7!.token);
    const body = orderBody([{ itemId: fries.id }]);
    const first = await g.post("/api/guest/orders", body);
    const checkId = (await g.get("/api/guest/table")).json().visit.checkId as string;
    await runWithTenant(tenantId, () => t.models.Check.updateOne({ _id: checkId }, { status: "paid", closedAt: NOW }));
    const again = await g.post("/api/guest/orders", { ...body, expectedCheckId: checkId });
    expect(again.statusCode).toBe(200);
    expect(again.json().orderId).toBe(first.json().orderId);
  });
});

describe("placeOrder for staff orders", () => {
  const req = (itemId: string): OrderRequest => ({ idempotencyKey: randomUUID(), items: [{ itemId, qty: 1, options: [] }] });

  it("requires an open check (the waiter seats the table first)", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    const run = runWithTenant(tenantId, () =>
      placeOrder(t.models, { tableId: seed.tables.T7!.id, source: "staff", placedBy: seed.staff.waiter, req: req(fries.id), now: NOW }),
    );
    await expect(run).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("uses the open check and names the check's server on tickets", async () => {
    const { tenantId, seed } = await seedTenant(t);
    const fries = await itemNamed(t, tenantId, "Truffle fries");
    // B1 is seated in Deniz's section.
    const result = await runWithTenant(tenantId, () =>
      placeOrder(t.models, { tableId: seed.tables.B1!.id, source: "staff", placedBy: seed.staff.waiter, req: req(fries.id), now: NOW }),
    );
    expect(result.checkOpened).toBe(false);
    expect(result.replayed).toBe(false);
    expect(String(result.order.placedBy)).toBe(seed.staff.waiter);
    expect(result.order.source).toBe("staff");
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]!.serverName).toBe("Deniz");
    expect(result.tickets[0]!.covers).toBe(4);
    expect(result.tickets[0]!.tableName).toBe("B1");
  });
});
