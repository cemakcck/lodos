import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/sessions";
import type { Bill, BillLine } from "../src/checks/bill";
import { splitView } from "../src/checks/split";
import { runWithTenant } from "../src/db/tenancy";
import { makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Req = (method: "GET" | "POST" | "PUT", path: string, payload?: object) => ReturnType<TestApp["inject"]>;
type View = {
  checkId: string;
  status: "open" | "paid";
  total: number;
  mode: string;
  count: number;
  locked: boolean;
  units: { ref: string; name: { en: string }; unitAmount: number; labels: string[]; frozen: boolean }[];
  shares: { label: string; amount: number; units: { ref: string; part: number; parts: number }[]; payment: { method: string; amount: number; last4: string | null } | null }[];
  unassigned: { count: number; amount: number };
  paidCount: number;
  left: number;
};

async function session(s: Seeded, who: keyof Seeded["seed"]["staff"]): Promise<Req> {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
  return (method, path, payload) => t.inject({ method, url: path, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}

/** A fresh tenant with a manager-created menu of exact prices, and T7 seated with one order of `lines`. */
async function setup(prices: Record<string, number>, lines: { name: string; qty?: number }[]) {
  const s = await seedTenant(t);
  const w = await session(s, "waiter");
  const m = await session(s, "manager");
  const cat = await runWithTenant(s.tenantId, () => t.models.Category.findOne({}).lean().orFail());
  const ids: Record<string, string> = {};
  for (const [name, price] of Object.entries(prices)) {
    const res = await m("POST", "/api/manager/items", {
      categoryId: String(cat._id),
      name: { en: name, tr: name },
      description: { en: name, tr: name },
      price,
      station: "kitchen",
    });
    expect(res.statusCode).toBe(201);
    ids[name] = res.json().id;
  }
  const T7 = s.seed.tables.T7!.id;
  const seat = await w("POST", `/api/tables/${T7}/seat`, { covers: 3 });
  expect(seat.statusCode).toBe(201);
  const checkId = seat.json().checkId as string;
  const order = async (ls: { name: string; qty?: number }[]) => {
    const res = await w("POST", `/api/tables/${T7}/orders`, orderBody(ls.map((l) => ({ itemId: ids[l.name]!, qty: l.qty ?? 1 }))));
    expect(res.statusCode).toBe(201);
  };
  await order(lines);
  const view = async () => {
    const res = await w("GET", `/api/checks/${checkId}/split`);
    expect(res.statusCode).toBe(200);
    return res.json() as View;
  };
  const put = (body: object) => w("PUT", `/api/checks/${checkId}/split`, body);
  const pay = (label: string, amount: number, method: "card" | "cash" = "card") => w("POST", `/api/checks/${checkId}/shares/${label}/pay`, { method, amount });
  const check = () => runWithTenant(s.tenantId, () => t.models.Check.findById(checkId).lean().orFail());
  const unitsOf = async (name: string) => (await view()).units.filter((u) => u.name.en === name).map((u) => u.ref);
  const amountOf = async (label: string) => (await view()).shares.find((x) => x.label === label)!.amount;
  return { s, w, m, T7, checkId, order, view, put, pay, check, unitsOf, amountOf };
}

const EVEN_MENU = { Big: 60000, Small: 40001, Hundred: 10000 };
const evenCheck = () => setup(EVEN_MENU, [{ name: "Big" }, { name: "Small" }]);

const ITEM_MENU = { Burrata: 54001, Ribeye: 245000, Wine: 180003, Fries: 38000 };
const itemCheck = () => setup(ITEM_MENU, [{ name: "Burrata" }, { name: "Ribeye" }, { name: "Wine" }, { name: "Fries" }]);

const paidPayments = (c: { split?: { shares: { payment?: unknown }[] } | null }) => (c.split?.shares ?? []).filter((x) => x.payment != null).length;

describe("evenly", () => {
  it("total 100001 split 3 → [33334, 33334, 33333]", async () => {
    const c = await evenCheck();
    const res = await c.put({ mode: "even", count: 3 });
    expect(res.statusCode).toBe(200);
    const v = res.json() as View;
    expect(v).toMatchObject({ checkId: c.checkId, status: "open", total: 100001, mode: "even", count: 3, locked: false, paidCount: 0, left: 100001 });
    expect(v.shares.map((x) => [x.label, x.amount])).toEqual([
      ["A", 33334],
      ["B", 33334],
      ["C", 33333],
    ]);
    expect((await c.view()).shares.map((x) => x.amount)).toEqual([33334, 33334, 33333]);
    expect((await c.check()).splitVersion).toBe(1);
  });

  it("pay twice, then pay the rest: idempotent share, the last one closes the check and frees T7", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    const a = await c.pay("A", 33334);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ changed: true, closed: false, share: { label: "A", amount: 33334, payment: { method: "card", amount: 33334 } } });
    expect(a.json().share.payment.last4).toMatch(/^\d{4}$/);
    const again = await c.pay("A", 33334, "cash");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ changed: false, share: { label: "A", payment: { method: "card", amount: 33334 } } });
    expect(paidPayments(await c.check())).toBe(1);

    const b = await c.pay("B", 33334, "cash");
    expect(b.json()).toMatchObject({ changed: true, closed: false, share: { payment: { method: "cash", last4: null } } });
    const last = await c.pay("C", 33333);
    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({ changed: true, closed: true });
    const check = await c.check();
    expect(check.status).toBe("paid");
    expect(check.closedAt).toEqual(NOW);
    const t7 = (await c.w("GET", "/api/floor")).json().tables.find((x: { name: string }) => x.name === "T7");
    expect(t7).toMatchObject({ state: "free", checkId: null, paying: null });
    const v = await c.view();
    expect(v).toMatchObject({ status: "paid", paidCount: 3, left: 0, locked: true });
  });

  it("recalculates the unpaid shares when an order lands after a payment", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    expect((await c.pay("A", 33334)).statusCode).toBe(200);
    await c.order([{ name: "Hundred" }]);
    const v = await c.view();
    expect(v.total).toBe(110001);
    expect(v.shares.map((x) => x.amount)).toEqual([33334, 38334, 38333]);
    expect(v.shares.reduce((n, x) => n + x.amount, 0)).toBe(v.total);
    expect(v).toMatchObject({ paidCount: 1, left: 110001 - 33334 });
  });

  it("is locked after a payment: count, mode and a full close → split_locked; the same count is allowed", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    await c.pay("A", 33334);
    for (const body of [{ mode: "even", count: 4 }, { mode: "items", count: 3, assignments: [] }, { mode: "full" }]) {
      const res = await c.put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
      expect(res.json().error.code).toBe("split_locked");
    }
    const close = await c.w("POST", `/api/checks/${c.checkId}/close`, { method: "card" });
    expect(close.statusCode).toBe(409);
    expect(close.json().error.code).toBe("split_locked");
    expect((await c.check()).status).toBe("open");
    expect((await c.put({ mode: "even", count: 3 })).statusCode).toBe(200);
    expect((await c.view()).locked).toBe(true);
  });
});

describe("by item", () => {
  it("shared burrata, ribeye to A, a bottle four ways: parts sum exactly and the rest is unassigned", async () => {
    const c = await itemCheck();
    const [burrata] = await c.unitsOf("Burrata");
    const [ribeye] = await c.unitsOf("Ribeye");
    const [wine] = await c.unitsOf("Wine");
    const res = await c.put({
      mode: "items",
      count: 4,
      assignments: [
        { unit: burrata, labels: ["B", "A"] },
        { unit: ribeye, labels: ["A"] },
        { unit: wine, labels: ["A", "B", "C", "D"] },
      ],
    });
    expect(res.statusCode).toBe(200);
    const v = res.json() as View;
    expect(v.total).toBe(54001 + 245000 + 180003 + 38000);
    expect(v.shares.map((x) => [x.label, x.amount])).toEqual([
      ["A", 27001 + 245000 + 45001],
      ["B", 27000 + 45001],
      ["C", 45001],
      ["D", 45000],
    ]);
    expect(v.shares[0]!.units).toEqual([
      { ref: burrata, part: 27001, parts: 2 },
      { ref: ribeye, part: 245000, parts: 1 },
      { ref: wine, part: 45001, parts: 4 },
    ]);
    expect(v.unassigned).toEqual({ count: 1, amount: 38000 });
    expect(v.shares.reduce((n, x) => n + x.amount, 0) + v.unassigned.amount).toBe(v.total);
    expect(v.units.find((u) => u.ref === burrata)!.labels).toEqual(["A", "B"]);
    expect(v.units.find((u) => u.name.en === "Fries")!.labels).toEqual([]);
  });

  it("rejects unknown, duplicate and out-of-range refs and labels with 400", async () => {
    const c = await itemCheck();
    const [burrata] = await c.unitsOf("Burrata");
    const bad = [
      { mode: "items", count: 2, assignments: [{ unit: `${burrata}9`, labels: ["A"] }] },
      { mode: "items", count: 2, assignments: [{ unit: "nope", labels: ["A"] }] },
      { mode: "items", count: 2, assignments: [{ unit: burrata, labels: ["A"] }, { unit: burrata, labels: ["B"] }] },
      { mode: "items", count: 2, assignments: [{ unit: burrata, labels: ["C"] }] },
      { mode: "items", count: 2, assignments: [{ unit: burrata, labels: ["A", "A"] }] },
      { mode: "items", count: 1, assignments: [] },
      { mode: "even", count: 21 },
      { mode: "halves" },
    ];
    for (const body of bad) {
      const res = await c.put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code).toBe("validation");
    }
    expect((await c.check()).split ?? null).toBeNull();
  });

  it("freezes a paid share: moving its unit → split_locked, an unassigned unit can move, a paid label can't go", async () => {
    const c = await itemCheck();
    const [burrata] = await c.unitsOf("Burrata");
    const [ribeye] = await c.unitsOf("Ribeye");
    const [fries] = await c.unitsOf("Fries");
    const base = [
      { unit: burrata, labels: ["A", "B"] },
      { unit: ribeye, labels: ["A"] },
    ];
    await c.put({ mode: "items", count: 3, assignments: base });
    const a = await c.pay("A", 27001 + 245000);
    expect(a.json()).toMatchObject({ changed: true, closed: false });
    const v = await c.view();
    expect(v.locked).toBe(true);
    expect(v.units.find((u) => u.ref === ribeye)!.frozen).toBe(true);
    expect(v.units.find((u) => u.ref === fries)!.frozen).toBe(false);

    const locked = async (body: object) => {
      const res = await c.put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
      expect(res.json().error.code).toBe("split_locked");
    };
    await locked({ mode: "items", count: 3, assignments: [base[0], { unit: ribeye, labels: ["B"] }] });
    await locked({ mode: "items", count: 3, assignments: [base[0]] });
    await locked({ mode: "items", count: 3, assignments: [...base, { unit: fries, labels: ["A"] }] });
    await locked({ mode: "even", count: 3 });

    const moved = await c.put({ mode: "items", count: 3, assignments: [...base, { unit: fries, labels: ["B"] }] });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as View).shares[0]!.amount).toBe(27001 + 245000);

    // A paid C can't be dropped by lowering the count.
    await c.put({ mode: "items", count: 3, assignments: [...base, { unit: fries, labels: ["C"] }] });
    expect((await c.pay("C", 38000)).statusCode).toBe(200);
    await locked({ mode: "items", count: 2, assignments: base });
    // A label with units that disappears is a validation error.
    await c.put({ mode: "items", count: 4, assignments: [...base, { unit: fries, labels: ["C"] }] });
    const [wine] = await c.unitsOf("Wine");
    await c.put({ mode: "items", count: 4, assignments: [...base, { unit: fries, labels: ["C"] }, { unit: wine, labels: ["D"] }] });
    expect((await c.put({ mode: "items", count: 3, assignments: [...base, { unit: fries, labels: ["C"] }, { unit: wine, labels: ["D"] }] })).statusCode).toBe(400);
  });

  it("a wrong amount → 409 amount_changed with the right amount", async () => {
    const c = await itemCheck();
    const [ribeye] = await c.unitsOf("Ribeye");
    await c.put({ mode: "items", count: 2, assignments: [{ unit: ribeye, labels: ["A"] }] });
    const res = await c.pay("A", 1);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "amount_changed", details: { amount: 245000 } });
    expect(paidPayments(await c.check())).toBe(0);
  });

  it("an unassigned unit blocks closing; an empty share can't be paid; assigning and paying the last share closes", async () => {
    const c = await itemCheck();
    const [burrata] = await c.unitsOf("Burrata");
    const [ribeye] = await c.unitsOf("Ribeye");
    const [wine] = await c.unitsOf("Wine");
    const [fries] = await c.unitsOf("Fries");
    const base = [
      { unit: burrata, labels: ["A"] },
      { unit: ribeye, labels: ["B"] },
      { unit: wine, labels: ["B"] },
    ];
    await c.put({ mode: "items", count: 2, assignments: base });
    expect((await c.pay("A", 54001)).json()).toMatchObject({ changed: true, closed: false });
    expect((await c.pay("B", 245000 + 180003)).json()).toMatchObject({ changed: true, closed: false });
    expect((await c.check()).status).toBe("open");
    const v = await c.view();
    expect(v).toMatchObject({ unassigned: { count: 1, amount: 38000 }, paidCount: 2, left: 38000 });

    expect((await c.put({ mode: "items", count: 3, assignments: base })).statusCode).toBe(200);
    const empty = await c.pay("C", 0);
    expect(empty.statusCode).toBe(409);
    expect(empty.json().error.code).toBe("conflict");

    expect((await c.put({ mode: "items", count: 3, assignments: [...base, { unit: fries, labels: ["C"] }] })).statusCode).toBe(200);
    expect((await c.pay("C", 38000)).json()).toMatchObject({ changed: true, closed: true });
    expect((await c.check()).status).toBe("paid");
  });

  it("a new order during a split lands unassigned", async () => {
    const c = await itemCheck();
    const [ribeye] = await c.unitsOf("Ribeye");
    await c.put({ mode: "items", count: 2, assignments: [{ unit: ribeye, labels: ["A"] }] });
    const before = await c.view();
    await c.order([{ name: "Fries", qty: 2 }]);
    const v = await c.view();
    const added = v.units.filter((u) => !before.units.some((b) => b.ref === u.ref));
    expect(added).toHaveLength(2);
    for (const u of added) expect(u).toMatchObject({ labels: [], frozen: false, unitAmount: 38000 });
    expect(v.unassigned).toEqual({ count: before.unassigned.count + 2, amount: before.unassigned.amount + 76000 });
  });
});

describe("payments and the floor", () => {
  it("Review Focus 1: parallel pay of one share records one payment", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    const [x, y] = await Promise.all([c.pay("B", 33334, "card"), c.pay("B", 33334, "cash")]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect([x.json().changed, y.json().changed].sort()).toEqual([false, true]);
    expect(x.json().share.payment).toEqual(y.json().share.payment);
    expect(paidPayments(await c.check())).toBe(1);
  });

  it("parallel pays of the last two shares close the check once", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    await c.pay("A", 33334);
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      const rs = await Promise.all([c.pay("B", 33334), c.pay("C", 33333), c.pay("C", 33333)]);
      expect(rs.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(rs.filter((r) => r.json().changed)).toHaveLength(2);
      expect(emit.mock.calls.filter((call) => call[1] === "check.updated")).toHaveLength(1);
    } finally {
      emit.mockRestore();
    }
    const check = await c.check();
    expect(check.status).toBe("paid");
    expect(paidPayments(check)).toBe(3);
  });

  it("Tonight's revenue counts share payments when they are made", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    const revenue = async () => (await c.m("GET", "/api/manager/tonight")).json().revenue as number;
    const before = await revenue();
    await c.pay("A", 33334);
    expect(await revenue()).toBe(before + 33334);
    await c.pay("B", 33334);
    await c.pay("C", 33333);
    expect(await revenue()).toBe(before + 100001);
  });

  it("/api/floor shows paying: { paid: 1, of: 3 }", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    const t7 = async () => (await c.w("GET", "/api/floor")).json().tables.find((x: { name: string }) => x.name === "T7");
    expect((await t7()).paying).toBeNull();
    await c.pay("A", 33334);
    expect((await t7()).paying).toEqual({ paid: 1, of: 3 });
  });

  it("emits split.updated to floor and manager on PUT and pay", async () => {
    const c = await evenCheck();
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      await c.put({ mode: "even", count: 3 });
      await c.pay("A", 33334);
      const split = emit.mock.calls.filter((call) => call[1] === "split.updated");
      expect(split).toHaveLength(2);
      for (const call of split) {
        expect(call[2]).toEqual({ ids: [c.checkId], tableId: c.T7 });
        expect(call[3]).toEqual(["floor", "manager"]);
      }
    } finally {
      emit.mockRestore();
    }
  });

  it("a full close clears an unpaid split and stores a card's last 4; a paid check refuses split and pay", async () => {
    const c = await evenCheck();
    await c.put({ mode: "even", count: 3 });
    const close = await c.w("POST", `/api/checks/${c.checkId}/close`, { method: "card" });
    expect(close.statusCode).toBe(200);
    expect(close.json().check.payment.last4).toMatch(/^\d{4}$/);
    const check = await c.check();
    expect(check.split ?? null).toBeNull();
    expect(check.payment).toMatchObject({ method: "card", amount: 100001 });
    expect(check.payment!.last4).toMatch(/^\d{4}$/);
    for (const res of [await c.put({ mode: "even", count: 2 }), await c.pay("A", 50001)]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("check_closed");
    }
    const v = await c.view();
    expect(v).toMatchObject({ mode: "full", status: "paid", count: 1, paidCount: 1, left: 0 });
    expect(v.shares[0]).toMatchObject({ label: "A", amount: 100001, payment: { method: "card", amount: 100001 } });
  });

  it("cash in full stores last4 null; full mode view is one share A; PUT full removes the split", async () => {
    const c = await evenCheck();
    const v = await c.view();
    expect(v).toMatchObject({ mode: "full", count: 1, locked: false, unassigned: { count: 0, amount: 0 }, paidCount: 0, left: 100001 });
    expect(v.shares).toHaveLength(1);
    expect(v.shares[0]).toMatchObject({ label: "A", amount: 100001, payment: null });
    expect(v.shares[0]!.units.map((u) => u.part)).toEqual([60000, 40001]);
    await c.put({ mode: "even", count: 2 });
    const full = await c.put({ mode: "full" });
    expect(full.statusCode).toBe(200);
    expect((full.json() as View).mode).toBe("full");
    expect((await c.check()).split ?? null).toBeNull();
    const close = await c.w("POST", `/api/checks/${c.checkId}/close`, { method: "cash" });
    expect(close.json().check.payment).toMatchObject({ method: "cash", last4: null });
  });

  it("ids: malformed or unknown check → 404; unknown share label → 404; bad body → 400", async () => {
    const c = await evenCheck();
    for (const id of ["nope", "aaaaaaaaaaaaaaaaaaaaaaaa"]) {
      expect((await c.w("GET", `/api/checks/${id}/split`)).statusCode).toBe(404);
      expect((await c.w("PUT", `/api/checks/${id}/split`, { mode: "even", count: 2 })).statusCode).toBe(404);
      expect((await c.w("POST", `/api/checks/${id}/shares/A/pay`, { method: "card", amount: 1 })).statusCode).toBe(404);
    }
    await c.put({ mode: "even", count: 2 });
    expect((await c.pay("C", 1)).statusCode).toBe(404);
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "bitcoin", amount: 1 })).statusCode).toBe(400);
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "card", amount: 1.5 })).statusCode).toBe(400);
  });
});

describe("splitView (pure)", () => {
  const line = (over: Partial<BillLine>): BillLine => ({
    lineRef: "o:0",
    orderId: "o",
    index: 0,
    itemId: "i",
    name: { en: "X", tr: "X" },
    options: [],
    note: null,
    seat: null,
    station: "kitchen",
    vatRate: 10,
    qty: 1,
    unitTotal: 1000,
    compedQty: 0,
    voidedQty: 0,
    lineTotal: 1000,
    originalTotal: 1000,
    units: [],
    adjustments: [],
    ...over,
  });
  const bill: Bill = {
    lines: [
      line({
        qty: 2,
        lineTotal: 1000,
        compedQty: 1,
        units: [
          { ref: "o:0:0", lineRef: "o:0", unitAmount: 1000, comp: null },
          { ref: "o:0:1", lineRef: "o:0", unitAmount: 0, comp: { id: "c", reason: "celebration" } },
        ],
      }),
    ],
    total: 1000,
    food: 1000,
    drinks: 0,
    grossByRate: { 10: 1000, 20: 0 },
    compsAmount: 1000,
    voidsAmount: 0,
  };

  it("an unassigned comped unit doesn't count as unassigned; stale refs are ignored", () => {
    const v = splitView({
      check: { _id: "c1", status: "open", payment: null, split: { mode: "items", count: 2, shares: [{ label: "A", payment: null }, { label: "B", payment: null }], assignments: [{ unit: "o:0:0", labels: ["A"] }, { unit: "gone:0:0", labels: ["B"] }] } },
      tableName: "T1",
      bill,
    });
    expect(v.unassigned).toEqual({ count: 0, amount: 0 });
    expect(v.units.map((u) => [u.ref, u.labels, u.comp])).toEqual([
      ["o:0:0", ["A"], null],
      ["o:0:1", [], { reason: "celebration" }],
    ]);
    expect(v.shares.map((s) => s.amount)).toEqual([1000, 0]);
    expect(v.shares[1]!.units).toEqual([]);
  });
});
