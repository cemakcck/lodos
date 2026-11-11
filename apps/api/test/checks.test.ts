import { randomUUID } from "node:crypto";
import { serviceDayOf, serviceDayStartOf } from "@lodos/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { closeCheck } from "../src/floor/service";
import { placeOrder } from "../src/orders/place";
import { guest, itemNamed, makeTestApp, orderBody, LIVE_NO_HISTORY, seedTenant, type TestApp } from "./helpers";
import { closeSockets, connect, listen } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
let url: string;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  url = await listen(t);
});
afterEach(() => closeSockets());
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;

async function staff(s: Seeded, who: keyof Seeded["seed"]["staff"] = "waiter") {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
  return (method: "GET" | "POST", path: string, payload?: object) =>
    t.inject({ method, url: path, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}

/** Seats T7 with 2 covers and sends 1 burrata (food) + 1 spritz (drink) as a staff order. */
async function seatedT7WithOrder(s: Seeded) {
  const w = await staff(s);
  const T7 = s.seed.tables.T7!.id;
  const burrata = await itemNamed(t, s.tenantId, "Burrata");
  const spritz = await itemNamed(t, s.tenantId, "Bergamot spritz");
  const seat = await w("POST", `/api/tables/${T7}/seat`, { covers: 2 });
  expect(seat.statusCode).toBe(201);
  const order = await w("POST", `/api/tables/${T7}/orders`, orderBody([{ itemId: burrata.id, note: "no basil" }, { itemId: spritz.id, qty: 2 }]));
  expect(order.statusCode).toBe(201);
  return { w, T7, burrata, spritz, checkId: seat.json().checkId as string };
}

describe("seat, order and check detail", () => {
  it("seat T7 with 2 covers, staff order 1 food + 1 drink → /check has one Food line and one Drinks line; totals add up", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, T7, burrata, spritz, checkId } = await seatedT7WithOrder(s);
    const res = await w("GET", `/api/tables/${T7}/check`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.table).toMatchObject({ id: T7, name: "T7" });
    expect(body.check).toMatchObject({ id: checkId, covers: 2, openedAt: NOW.toISOString(), serverName: "Deniz", billRequestedAt: null, billMethod: null });
    expect(body.food).toHaveLength(1);
    expect(body.drinks).toHaveLength(1);
    expect(body.food[0]).toMatchObject({ qty: 1, note: "no basil", seat: null, status: "sent", lineTotal: burrata.price });
    expect(body.food[0].name.en).toMatch(/^Burrata/);
    expect(typeof body.food[0].ticketId).toBe("string");
    expect(typeof body.food[0].orderId).toBe("string");
    expect(body.drinks[0]).toMatchObject({ qty: 2, lineTotal: 2 * spritz.price });
    expect(body.totals).toEqual({ food: burrata.price, drinks: 2 * spritz.price, total: burrata.price + 2 * spritz.price });
    expect(body.calls).toEqual([]);
  });

  it("a free table's /check is { check: null }; an order on an unseated table → conflict", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const w = await staff(s);
    const T7 = s.seed.tables.T7!.id;
    const res = await w("GET", `/api/tables/${T7}/check`);
    expect(res.statusCode).toBe(200);
    expect(res.json().check).toBeNull();
    const fries = await itemNamed(t, s.tenantId, "Truffle fries");
    const order = await w("POST", `/api/tables/${T7}/orders`, orderBody([{ itemId: fries.id }]));
    expect(order.statusCode).toBe(409);
    expect(order.json().error.code).toBe("conflict");
  });

  it("seating twice → conflict; covers are validated", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const w = await staff(s);
    const T7 = s.seed.tables.T7!.id;
    expect((await w("POST", `/api/tables/${T7}/seat`, { covers: 0 })).statusCode).toBe(400);
    expect((await w("POST", `/api/tables/${T7}/seat`, { covers: 21 })).statusCode).toBe(400);
    const [a, b] = await Promise.all([w("POST", `/api/tables/${T7}/seat`, { covers: 2 }), w("POST", `/api/tables/${T7}/seat`, { covers: 3 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect((a.statusCode === 409 ? a : b).json().error.code).toBe("conflict");
    expect((await w("POST", `/api/tables/${s.seed.tables.B1!.id}/seat`, { covers: 2 })).statusCode).toBe(409);
    const checks = await runWithTenant(s.tenantId, () => t.models.Check.find({ tableId: T7 }).lean());
    expect(checks).toHaveLength(1);
    expect(String(checks[0]!.serverStaffId)).toBe(s.seed.staff.waiter);
  });

  it("seating a QR-opened check sets its covers instead of opening another", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const T7 = s.seed.tables.T7!.id;
    const fries = await itemNamed(t, s.tenantId, "Truffle fries");
    expect((await guest(t, s.seed.tables.T7!.token).post("/api/guest/orders", orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    const w = await staff(s, "waiter2");
    const res = await w("POST", `/api/tables/${T7}/seat`, { covers: 3 });
    expect(res.statusCode).toBe(200);
    const checks = await runWithTenant(s.tenantId, () => t.models.Check.find({ tableId: T7 }).lean());
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ covers: 3, status: "open" });
    expect(String(checks[0]!._id)).toBe(res.json().checkId);
    expect((await w("POST", `/api/tables/${T7}/seat`, { covers: 3 })).statusCode).toBe(409);
  });
});

describe("close the check", () => {
  it("close (card) → paid, amount = total, T7 free on /floor, calls answered; a guest order then opens a new check", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, T7, burrata, spritz, checkId } = await seatedT7WithOrder(s);
    await runWithTenant(s.tenantId, () => t.models.Call.create({ tableId: T7, checkId, reason: "other", openedAt: NOW }));
    const res = await w("POST", `/api/checks/${checkId}/close`, { method: "card" });
    expect(res.statusCode).toBe(200);
    const total = burrata.price + 2 * spritz.price;
    expect(res.json().check).toMatchObject({ id: checkId, status: "paid", closedAt: NOW.toISOString(), payment: { method: "card", amount: total, at: NOW.toISOString() } });

    const f = (await w("GET", "/api/floor")).json();
    const t7 = f.tables.find((x: { name: string }) => x.name === "T7");
    expect(t7).toMatchObject({ state: "free", checkId: null, covers: null });
    // Tonight's paid checks: the seeded ones plus this one, opened and closed at the same instant (a 0 ms turn).
    const paid = await runWithTenant(s.tenantId, () => t.models.Check.find({ status: "paid", closedAt: { $gte: serviceDayStartOf(serviceDayOf(NOW)) } }).lean());
    expect(paid.map((c) => String(c._id))).toContain(checkId);
    expect(paid.length).toBeGreaterThan(1);
    const turns = paid.map((c) => c.closedAt!.getTime() - c.openedAt.getTime());
    expect(f.stats.avgTurnMs).toBe(Math.round(turns.reduce((a, b) => a + b, 0) / turns.length));
    expect(await runWithTenant(s.tenantId, () => t.models.Call.countDocuments({ tableId: T7, answeredAt: null }))).toBe(0);
    expect((await w("GET", `/api/tables/${T7}/check`)).json().check).toBeNull();

    const fries = await itemNamed(t, s.tenantId, "Truffle fries");
    const g = await guest(t, s.seed.tables.T7!.token).post("/api/guest/orders", orderBody([{ itemId: fries.id }]));
    expect(g.statusCode).toBe(201);
    const next = await runWithTenant(s.tenantId, () => t.models.Check.findOne({ tableId: T7, status: "open" }).lean().orFail());
    expect(String(next._id)).not.toBe(checkId);
    expect(next.covers).toBeNull();
  });

  it("a guest socket for T7 receives check.updated on close", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, checkId } = await seatedT7WithOrder(s);
    const g = await connect(url, { tableToken: s.seed.tables.T7!.token });
    expect((await w("POST", `/api/checks/${checkId}/close`, { method: "cash" })).statusCode).toBe(200);
    const e = await g.next((x) => x.type === "check.updated" && x.ids.includes(checkId));
    expect(e.tableId).toBe(s.seed.tables.T7!.id);
  });

  it("a double tap is 200 both times with the same amount, one paid write and one event", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, checkId } = await seatedT7WithOrder(s);
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      const [a, b] = await Promise.all([
        w("POST", `/api/checks/${checkId}/close`, { method: "card" }),
        w("POST", `/api/checks/${checkId}/close`, { method: "cash" }),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(a.json().check.payment).toEqual(b.json().check.payment);
      expect(emit.mock.calls.filter((c) => c[1] === "check.updated")).toHaveLength(1);
    } finally {
      emit.mockRestore();
    }
    const again = await w("POST", `/api/checks/${checkId}/close`, { method: "cash" });
    expect(again.statusCode).toBe(200);
    const check = await runWithTenant(s.tenantId, () => t.models.Check.findById(checkId).lean().orFail());
    expect(again.json().check.payment).toEqual({ ...check.payment, at: check.payment!.at.toISOString() });
  });

  it("a stale confirmed amount → 409 amount_changed with the bill total, nothing written; the right amount closes", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, burrata, spritz, checkId } = await seatedT7WithOrder(s);
    const total = burrata.price + 2 * spritz.price;
    const stale = await w("POST", `/api/checks/${checkId}/close`, { method: "card", amount: total + 5000 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "amount_changed", details: { amount: total } });
    const still = await runWithTenant(s.tenantId, () => t.models.Check.findById(checkId).lean().orFail());
    expect(still).toMatchObject({ status: "open", payment: null });
    expect((await w("POST", `/api/checks/${checkId}/close`, { method: "card", amount: -1 })).statusCode).toBe(400);
    const ok = await w("POST", `/api/checks/${checkId}/close`, { method: "card", amount: total });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().check.payment).toMatchObject({ amount: total });
  });

  it("validation and ids: bad method → 400; malformed or unknown check → 404", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, checkId } = await seatedT7WithOrder(s);
    expect((await w("POST", `/api/checks/${checkId}/close`, { method: "bitcoin" })).statusCode).toBe(400);
    for (const path of ["/api/checks/nope/close", "/api/checks/aaaaaaaaaaaaaaaaaaaaaaaa/close"]) {
      expect((await w("POST", path, { method: "card" })).statusCode).toBe(404);
    }
    for (const path of ["/api/checks/nope/print", "/api/tables/nope/check", "/api/tables/aaaaaaaaaaaaaaaaaaaaaaaa/check"]) {
      expect((await w("GET", path)).statusCode).toBe(404);
    }
    for (const path of ["/api/tables/nope/seat", "/api/tables/aaaaaaaaaaaaaaaaaaaaaaaa/seat"]) {
      expect((await w("POST", path, { covers: 2 })).statusCode).toBe(404);
    }
    expect((await w("POST", "/api/tables/nope/orders", orderBody([]))).statusCode).toBe(404);
  });

  it("print data works for open and paid checks", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { w, checkId, burrata, spritz } = await seatedT7WithOrder(s);
    const open = (await w("GET", `/api/checks/${checkId}/print`)).json();
    expect(open).toMatchObject({ table: { name: "T7" }, paid: false, closedAt: null, openedAt: NOW.toISOString(), covers: 2, payment: null });
    expect(open.lines).toHaveLength(2);
    expect(open.total).toBe(burrata.price + 2 * spritz.price);
    await w("POST", `/api/checks/${checkId}/close`, { method: "cash" });
    const paid = (await w("GET", `/api/checks/${checkId}/print`)).json();
    expect(paid).toMatchObject({ paid: true, closedAt: NOW.toISOString(), payment: { method: "cash", amount: open.total } });
  });
});

describe("an order racing the close (deterministic interleavings)", () => {
  const fries = (s: Seeded) => itemNamed(t, s.tenantId, "Truffle fries");
  const staffOrder = (s: Seeded, tableId: string, itemId: string) =>
    placeOrder(t.models, { tableId, source: "staff", placedBy: s.seed.staff.waiter, req: { idempotencyKey: randomUUID(), items: [{ itemId, qty: 1, options: [] }] }, now: NOW });

  it("an order committed after close read the lines is included: close retries and charges it", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { T7, checkId } = await seatedT7WithOrder(s);
    const f = await fries(s);
    const Order = t.models.Order;
    const original = Order.find.bind(Order);
    let landed = false;
    // close reads the orders, then (before it writes the check) a staff order commits on the same check.
    const spy = vi.spyOn(Order, "find").mockImplementationOnce(((...args: Parameters<typeof original>) => {
      const q = original(...args);
      const exec = q.exec.bind(q);
      q.exec = (async () => {
        const out = await exec();
        await staffOrder(s, T7, f.id);
        landed = true;
        return out;
      }) as typeof q.exec;
      return q;
    }) as typeof Order.find);
    let result;
    try {
      result = await runWithTenant(s.tenantId, () => closeCheck(t.models, { checkId, method: "card", staffId: s.seed.staff.waiter, now: NOW }));
    } finally {
      spy.mockRestore();
    }
    expect(landed).toBe(true);
    const lines = await runWithTenant(s.tenantId, () => Order.find({ checkId }).lean());
    expect(lines).toHaveLength(2);
    const sum = lines.flatMap((o) => o.items).reduce((n, i) => n + i.lineTotal, 0);
    expect(result.check.payment!.amount).toBe(sum);
    expect(result.changed).toBe(true);
  });

  it("a close committed inside an order's transaction makes the staff order fail; the amount is unchanged", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { T7, checkId } = await seatedT7WithOrder(s);
    const f = await fries(s);
    const Check = t.models.Check;
    const original = Check.findOne.bind(Check);
    let paid: number | undefined;
    // After the order's snapshot (its idempotency read) and before it reads the check, the close runs and commits.
    const spy = vi.spyOn(Check, "findOne").mockImplementationOnce(((...args: Parameters<typeof original>) => {
      const q = original(...args);
      const exec = q.exec.bind(q);
      q.exec = (async () => {
        spy.mockRestore();
        paid = (await closeCheck(t.models, { checkId, method: "card", staffId: s.seed.staff.waiter, now: NOW })).check.payment!.amount;
        return exec();
      }) as typeof q.exec;
      return q;
    }) as typeof Check.findOne);
    await expect(runWithTenant(s.tenantId, () => staffOrder(s, T7, f.id))).rejects.toMatchObject({ status: 409, code: "conflict" });
    spy.mockRestore();
    const check = await runWithTenant(s.tenantId, () => Check.findById(checkId).lean().orFail());
    expect(check.payment!.amount).toBe(paid);
    expect(await runWithTenant(s.tenantId, () => t.models.Order.countDocuments({ checkId }))).toBe(1);
  });

  it("free-running: concurrent orders and closes never leave an order outside the charged amount", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const { T7, checkId } = await seatedT7WithOrder(s);
    const f = await fries(s);
    await Promise.allSettled([
      ...[1, 2, 3, 4].map(() => runWithTenant(s.tenantId, () => staffOrder(s, T7, f.id))),
      runWithTenant(s.tenantId, () => closeCheck(t.models, { checkId, method: "cash", staffId: s.seed.staff.waiter, now: NOW })),
      ...[5, 6].map(() => runWithTenant(s.tenantId, () => staffOrder(s, T7, f.id))),
    ]);
    const check = await runWithTenant(s.tenantId, () => t.models.Check.findById(checkId).lean().orFail());
    const orders = await runWithTenant(s.tenantId, () => t.models.Order.find({ checkId }).lean());
    expect(check.status).toBe("paid");
    expect(check.payment!.amount).toBe(orders.flatMap((o) => o.items).reduce((n, i) => n + i.lineTotal, 0));
  });
});

describe("profanity in guest notes", () => {
  it("staff check detail masks a listed word; the guest's own view keeps their words", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const T7 = s.seed.tables.T7!;
    const burrata = await itemNamed(t, s.tenantId, "Burrata");
    const g = guest(t, T7.token, "10.6.0.1");
    const placed = await g.post("/api/guest/orders", orderBody([{ itemId: burrata.id, note: "no basil, shit" }]));
    expect(placed.statusCode).toBe(201);
    const w = await staff(s);
    const detail = (await w("GET", `/api/tables/${T7.id}/check`)).json();
    expect(detail.food[0].note).toBe("no basil, •••");
    expect((await g.get("/api/guest/orders")).json().food[0].note).toBe("no basil, shit");
  });
});
