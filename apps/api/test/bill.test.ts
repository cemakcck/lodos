import { serviceDayOf, unitRef } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { billOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody, LIVE_NO_HISTORY, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;

/** Seats T7 and orders Gelato ×3 + Negroni ×1 as one staff order (the seed 86s the gelato; it is restocked first). */
async function gelatoAndNegroni(s: Seeded) {
  const sid = await createSession(t.models, s.seed.staff.waiter, s.tenantId, "person", NOW);
  const w = (method: "GET" | "POST", url: string, payload?: object) =>
    t.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
  const T7 = s.seed.tables.T7!.id;
  const gelato = await itemNamed(t, s.tenantId, "Olive oil gelato");
  const negroni = await itemNamed(t, s.tenantId, "Lodos Negroni");
  await runWithTenant(s.tenantId, () => t.models.Availability.deleteMany({ itemId: gelato.id }));
  const seat = await w("POST", `/api/tables/${T7}/seat`, { covers: 2 });
  expect(seat.statusCode).toBe(201);
  const order = await w("POST", `/api/tables/${T7}/orders`, orderBody([{ itemId: gelato.id, qty: 3 }, { itemId: negroni.id, options: [{ groupId: "gin", optionIds: ["london-dry"] }] }]));
  expect(order.statusCode).toBe(201);
  const checkId = seat.json().checkId as string;
  const orderDoc = await runWithTenant(s.tenantId, () => t.models.Order.findOne({ checkId }).lean());
  const orderId = String(orderDoc!._id);
  const gelatoIndex = orderDoc!.items.findIndex((i) => String(i.itemId) === gelato.id);
  return { w, T7, gelato, negroni, checkId, orderId, gelatoIndex };
}

async function adjust(
  s: Seeded,
  o: Awaited<ReturnType<typeof gelatoAndNegroni>>,
  kind: "comp" | "void",
  units: number[],
  extra: { reversedAt?: Date } = {},
) {
  const doc = await runWithTenant(s.tenantId, () =>
    t.models.Adjustment.create({
      checkId: o.checkId,
      orderId: o.orderId,
      itemIndex: o.gelatoIndex,
      units,
      qty: units.length,
      kind,
      reason: kind === "comp" ? "celebration" : "wrong_item",
      note: null,
      amount: o.gelato.price * units.length,
      itemId: o.gelato.id,
      itemName: { en: "Olive oil gelato", tr: "Zeytinyağlı dondurma" },
      tableName: "T7",
      station: "kitchen",
      requestedBy: null,
      requestedByName: "Deniz",
      approvedBy: s.seed.staff.manager,
      approvedByName: "Selin",
      at: NOW,
      serviceDay: serviceDayOf(NOW),
      reversedAt: extra.reversedAt ?? null,
      reversedBy: null,
    }),
  );
  return String(doc._id);
}

const bill = (s: Seeded, checkId: string) => runWithTenant(s.tenantId, () => billOf(t.models, checkId));

describe("billOf", () => {
  it("with no adjustments: the total is every line, gross split by VAT rate", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    const b = await bill(s, o.checkId);
    expect(b.total).toBe(3 * o.gelato.price + o.negroni.price);
    expect(b.food).toBe(3 * o.gelato.price);
    expect(b.drinks).toBe(o.negroni.price);
    expect(b.grossByRate).toEqual({ 10: 3 * o.gelato.price, 20: o.negroni.price });
    expect(b.compsAmount).toBe(0);
    expect(b.voidsAmount).toBe(0);
    const line = b.lines.find((l) => l.itemId === o.gelato.id)!;
    expect(line).toMatchObject({
      lineRef: `${o.orderId}:${o.gelatoIndex}`,
      orderId: o.orderId,
      index: o.gelatoIndex,
      station: "kitchen",
      vatRate: 10,
      qty: 3,
      unitTotal: o.gelato.price,
      compedQty: 0,
      voidedQty: 0,
      lineTotal: 3 * o.gelato.price,
      originalTotal: 3 * o.gelato.price,
      adjustments: [],
    });
    expect(line.units.map((u) => u.ref)).toEqual([0, 1, 2].map((u) => unitRef(o.orderId, o.gelatoIndex, u)));
    expect(line.units.every((u) => u.unitAmount === o.gelato.price && u.comp === null && u.lineRef === line.lineRef)).toBe(true);
  });

  it("a comp of unit 2 charges 2 gelatos; the comped unit stays at ₺0 with its comp", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    const compId = await adjust(s, o, "comp", [2]);
    const b = await bill(s, o.checkId);
    const line = b.lines.find((l) => l.itemId === o.gelato.id)!;
    expect(line.lineTotal).toBe(2 * o.gelato.price);
    expect(line.compedQty).toBe(1);
    expect(line.originalTotal).toBe(3 * o.gelato.price);
    const u2 = line.units.find((u) => u.ref === unitRef(o.orderId, o.gelatoIndex, 2))!;
    expect(u2).toEqual({ ref: unitRef(o.orderId, o.gelatoIndex, 2), lineRef: line.lineRef, unitAmount: 0, comp: { id: compId, reason: "celebration" } });
    expect(line.adjustments).toEqual([{ id: compId, kind: "comp", qty: 1, reason: "celebration", note: null, approvedByName: "Selin", at: NOW }]);
    expect(b.compsAmount).toBe(o.gelato.price);
    expect(b.total).toBe(2 * o.gelato.price + o.negroni.price);
    expect(b.grossByRate).toEqual({ 10: 2 * o.gelato.price, 20: o.negroni.price });
  });

  it("a void of unit 1 as well removes that unit from the bill", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    await adjust(s, o, "comp", [2]);
    await adjust(s, o, "void", [1]);
    const b = await bill(s, o.checkId);
    const line = b.lines.find((l) => l.itemId === o.gelato.id)!;
    expect(line.units.map((u) => u.ref)).toEqual([0, 2].map((u) => unitRef(o.orderId, o.gelatoIndex, u)));
    expect(line.voidedQty).toBe(1);
    expect(line.lineTotal).toBe(o.gelato.price);
    expect(b.voidsAmount).toBe(o.gelato.price);
    expect(b.compsAmount).toBe(o.gelato.price);
    expect(b.total).toBe(o.gelato.price + o.negroni.price);
  });

  it("ignores a reversed adjustment", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    await adjust(s, o, "comp", [2], { reversedAt: NOW });
    const b = await bill(s, o.checkId);
    expect(b.total).toBe(3 * o.gelato.price + o.negroni.price);
    expect(b.compsAmount).toBe(0);
    expect(b.lines.find((l) => l.itemId === o.gelato.id)!.adjustments).toEqual([]);
  });

  it("the waiter's check detail and the guest's table view show charged totals", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    await adjust(s, o, "comp", [2]);
    await adjust(s, o, "void", [1]);
    const charged = o.gelato.price + o.negroni.price;

    const staffView = (await o.w("GET", `/api/tables/${o.T7}/check`)).json();
    expect(staffView.food[0]).toMatchObject({
      lineRef: `${o.orderId}:${o.gelatoIndex}`,
      qty: 3,
      compedQty: 1,
      voidedQty: 1,
      lineTotal: o.gelato.price,
      originalTotal: 3 * o.gelato.price,
    });
    expect(staffView.food[0].adjustments).toHaveLength(2);
    expect(staffView.totals).toEqual({ food: o.gelato.price, drinks: o.negroni.price, total: charged });

    const guestView = (await guest(t, s.seed.tables.T7!.token).get("/api/guest/orders")).json();
    expect(guestView.food[0].lineTotal).toBe(o.gelato.price);
    expect(guestView.totals.total).toBe(charged);
  });

  it("closing the check charges the bill total", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const o = await gelatoAndNegroni(s);
    await adjust(s, o, "comp", [2]);
    const res = await o.w("POST", `/api/checks/${o.checkId}/close`, { method: "card" });
    expect(res.statusCode).toBe(200);
    const paid = await runWithTenant(s.tenantId, () => t.models.Check.findById(o.checkId).lean());
    expect(paid!.payment!.amount).toBe(2 * o.gelato.price + o.negroni.price);
  });
});
