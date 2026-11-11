import { vatOf } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { billOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { itemNamed, makeTestApp, orderBody, LIVE_NO_HISTORY, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Method = "GET" | "POST" | "PUT";
type Req = (method: Method, path: string, payload?: object) => ReturnType<TestApp["inject"]>;
type Line = { label: string; name: { en: string; tr: string }; amount: number; comp: string | null };

let ipSeq = 0;
async function session(s: Seeded, who: keyof Seeded["seed"]["staff"]): Promise<Req> {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
  const remoteAddress = `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  return (method, path, payload) => t.inject({ method, url: path, cookies: { lodos_sid: sid }, remoteAddress, ...(payload ? { payload } : {}) });
}

const NAMES = ["Burrata", "Dry-aged ribeye", "Bergamot spritz"];

/** T7 seated with one order: Burrata, the ribeye and a spritz (food at 10 %, drink at 20 %). */
async function setup() {
  const s = await seedTenant(t, LIVE_NO_HISTORY);
  const w = await session(s, "waiter");
  const m = await session(s, "manager");
  const T7 = s.seed.tables.T7!.id;
  const seat = await w("POST", `/api/tables/${T7}/seat`, { covers: 2 });
  const checkId = seat.json().checkId as string;
  const items = await Promise.all(NAMES.map((n) => itemNamed(t, s.tenantId, n)));
  await runWithTenant(s.tenantId, () => t.models.Availability.deleteMany({ itemId: { $in: items.map((i) => i.id) } }));
  const placed = await w("POST", `/api/tables/${T7}/orders`, orderBody(items.map((i, n) => ({ itemId: i.id, qty: 1, ...(n === 1 ? { options: [{ groupId: "doneness", optionIds: ["rare"] }] } : {}) }))));
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().orderId as string;
  const receipt = async (q = "") => (await w("GET", `/api/checks/${checkId}/receipt${q}`)).json();
  const bill = () => runWithTenant(s.tenantId, () => billOf(t.models, checkId));
  const refs = async (name: string) => (await w("GET", `/api/checks/${checkId}/split`)).json().units.filter((u: { name: { en: string } }) => u.name.en.startsWith(name)).map((u: { ref: string }) => u.ref) as string[];
  return { s, w, m, checkId, orderId, items, receipt, bill, refs };
}

describe("whole check", () => {
  it("mixed check paid in full by card: total = payment, KDV per rate, last4", async () => {
    const c = await setup();
    expect((await c.w("POST", `/api/checks/${c.checkId}/close`, { method: "card" })).statusCode).toBe(200);
    const r = await c.receipt();
    const bill = await c.bill();
    expect(r.total).toBe(bill.total);
    expect(r.payment).toMatchObject({ method: "card", amount: bill.total });
    expect(r.payment.last4).toMatch(/^\d{4}$/);
    expect(r).toMatchObject({ paid: true, share: null, table: { id: c.s.seed.tables.T7!.id, name: "T7" }, covers: 2, payments: [] });
    expect(r.checkNo).toMatch(/^\d{4}$/);
    expect(r.lines).toHaveLength(3);
    expect(bill.grossByRate[10]).toBeGreaterThan(0);
    expect(bill.grossByRate[20]).toBeGreaterThan(0);
    expect(r.vat).toEqual([
      { rate: 10, amount: vatOf(bill.grossByRate[10], 10) },
      { rate: 20, amount: vatOf(bill.grossByRate[20], 20) },
    ]);
    expect(new Date(r.printedAt).getTime()).toBe(NOW.getTime());
  });

  it("pre-payment print of an open check: payment null, paid false", async () => {
    const c = await setup();
    const r = (await c.w("GET", `/api/checks/${c.checkId}/print`)).json();
    expect(r).toMatchObject({ payment: null, paid: false, closedAt: null, comps: { count: 0, amount: 0 } });
  });

  it("a comp prints as a ₺0 line with its reason; a void is omitted; comps count 1", async () => {
    const c = await setup();
    const adj = (kind: "comp" | "void", item: number, reason: string) =>
      c.m("POST", `/api/checks/${c.checkId}/adjustments`, { lineRef: `${c.orderId}:${item}`, kind, qty: 1, reason });
    expect((await adj("comp", 0, "celebration")).statusCode).toBe(201);
    expect((await adj("void", 2, "wrong_item")).statusCode).toBe(201);
    const r = await c.receipt();
    const bill = await c.bill();
    expect(r.lines.map((l: Line) => [l.name.en.slice(0, 7), l.amount, l.comp])).toEqual([
      ["Burrata", 0, "celebration"],
      ["Dry-age", bill.lines[1]!.lineTotal, null],
    ]);
    expect(r.comps).toEqual({ count: 1, amount: bill.compsAmount });
    expect(r.total).toBe(bill.total);
  });

  it("a check closed through shares has payment null and lists the share payments", async () => {
    const c = await setup();
    await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 2 });
    const bill = await c.bill();
    const a = Math.ceil(bill.total / 2);
    await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "card", amount: a });
    await c.w("POST", `/api/checks/${c.checkId}/shares/B/pay`, { method: "cash", amount: bill.total - a });
    const r = await c.receipt();
    expect(r).toMatchObject({ paid: true, payment: null });
    expect(r.payments).toMatchObject([{ label: "A", method: "card", amount: a }, { label: "B", method: "cash", last4: null }]);
  });
});

describe("shares", () => {
  it("by item: half the Burrata and the ribeye → lines ['½' Burrata, '' ribeye]; total = paid amount", async () => {
    const c = await setup();
    const [burrata] = await c.refs("Burrata");
    const [ribeye] = await c.refs("Dry-aged");
    const put = await c.w("PUT", `/api/checks/${c.checkId}/split`, {
      mode: "items",
      count: 2,
      assignments: [
        { unit: burrata, labels: ["A", "B"] },
        { unit: ribeye, labels: ["A"] },
      ],
    });
    expect(put.statusCode, put.body).toBe(200);
    const amount = put.json().shares[0].amount as number;
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "card", amount })).statusCode).toBe(200);
    const r = await c.receipt("?share=A");
    expect(r.lines.map((l: Line) => [l.label, l.name.en.slice(0, 7)])).toEqual([["½", "Burrata"], ["", "Dry-age"]]);
    expect(r.total).toBe(amount);
    expect(r.lines.reduce((n: number, l: Line) => n + l.amount, 0)).toBe(amount);
    expect(r.share).toEqual({ label: "A", index: 0, of: 2 });
    expect(r.paid).toBe(true);
    expect(r.payment).toMatchObject({ method: "card", amount });
    const vat = r.vat.reduce((n: number, v: { amount: number }) => n + v.amount, 0);
    expect(vat).toBeGreaterThan(0);
    const b = await c.receipt("?share=B");
    expect(b.paid).toBe(false);
    expect(b.payment).toBeNull();
  });

  it("even split of 4: one 'Guest C of 4 · check #N' line for the share, no check total; VAT allocated by rate", async () => {
    const c = await setup();
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 4 })).statusCode).toBe(200);
    const bill = await c.bill();
    const r = await c.receipt("?share=C");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toEqual({ label: "", name: { en: `Guest C of 4 · check #${r.checkNo}`, tr: `Misafir C / 4 · hesap #${r.checkNo}` }, options: [], amount: r.total, comp: null });
    expect(r.share).toEqual({ label: "C", index: 2, of: 4 });
    // The share's gross split across the rates in the bill's proportion (largest remainder), then KDV per rate.
    const g10 = Math.round((r.total * bill.grossByRate[10]) / bill.total);
    const g20 = r.total - g10;
    expect(Math.abs((r.total * bill.grossByRate[10]) / bill.total - g10)).toBeLessThanOrEqual(0.5);
    expect(r.vat).toEqual([
      { rate: 10, amount: vatOf(g10, 10) },
      { rate: 20, amount: vatOf(g20, 20) },
    ]);
  });

  it("even shares recalculated after an item is added: each receipt reads its own share and still adds up", async () => {
    const c = await setup();
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 4 })).statusCode).toBe(200);
    const a = (await c.w("GET", `/api/checks/${c.checkId}/split`)).json().shares[0].amount as number;
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "card", amount: a })).statusCode).toBe(200);
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    expect((await c.w("POST", `/api/tables/${c.s.seed.tables.T7!.id}/orders`, orderBody([{ itemId: fries.id }]))).statusCode).toBe(201);
    const shares = (await c.w("GET", `/api/checks/${c.checkId}/split`)).json().shares as { label: string; amount: number }[];
    const bill = await c.bill();
    expect(shares.reduce((n, x) => n + x.amount, 0)).toBe(bill.total);
    for (const sh of shares) {
      const r = await c.receipt(`?share=${sh.label}`);
      expect(r.total).toBe(sh.amount);
      expect(r.lines).toEqual([{ label: "", name: { en: `Guest ${sh.label} of 4 · check #${r.checkNo}`, tr: `Misafir ${sh.label} / 4 · hesap #${r.checkNo}` }, options: [], amount: sh.amount, comp: null }]);
    }
    expect(shares[1]!.amount).not.toBe(a);
  });

  it("labels: '2 ×' and a ₺0 comp line for a partly comped line; in a share '2 × ½', '2 ×' and a comped unit", async () => {
    const c = await setup();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    await runWithTenant(c.s.tenantId, () => t.models.Availability.deleteMany({ itemId: fries.id }));
    const placed = await c.w("POST", `/api/tables/${c.s.seed.tables.T7!.id}/orders`, orderBody([{ itemId: fries.id, qty: 5 }]));
    expect(placed.statusCode, placed.body).toBe(201);
    const ref = `${placed.json().orderId}:0`;
    expect((await c.m("POST", `/api/checks/${c.checkId}/adjustments`, { lineRef: ref, kind: "comp", qty: 1, reason: "regular" })).statusCode).toBe(201);

    const whole = await c.receipt();
    const friesLines = (whole.lines as Line[]).filter((l) => l.name.en.startsWith("Truffle"));
    expect(friesLines.map((l) => [l.label, l.amount, l.comp])).toEqual([
      ["4 ×", 4 * fries.price, null],
      ["", 0, "regular"],
    ]);

    const units = (await c.w("GET", `/api/checks/${c.checkId}/split`)).json().units as { ref: string; lineRef: string; comp: unknown }[];
    const fu = units.filter((u) => u.lineRef === ref);
    const comped = fu.filter((u) => u.comp !== null);
    const charged = fu.filter((u) => u.comp === null);
    expect([comped.length, charged.length]).toEqual([1, 4]);
    const put = await c.w("PUT", `/api/checks/${c.checkId}/split`, {
      mode: "items",
      count: 2,
      assignments: [
        { unit: charged[0]!.ref, labels: ["A", "B"] },
        { unit: charged[1]!.ref, labels: ["A", "B"] },
        { unit: charged[2]!.ref, labels: ["A"] },
        { unit: charged[3]!.ref, labels: ["A"] },
        { unit: comped[0]!.ref, labels: ["A"] },
      ],
    });
    expect(put.statusCode, put.body).toBe(200);
    const a = await c.receipt("?share=A");
    expect((a.lines as Line[]).map((l) => [l.label, l.name.en.slice(0, 7), l.amount, l.comp])).toEqual([
      ["2 ×", "Truffle", 2 * fries.price, null],
      ["2 × ½", "Truffle", fries.price, null],
      ["", "Truffle", 0, "regular"],
    ]);
    expect(a.total).toBe(3 * fries.price);
  });

  it("unknown share label, share on an unsplit check, unknown check → 404", async () => {
    const c = await setup();
    expect((await c.w("GET", `/api/checks/${c.checkId}/receipt?share=A`)).statusCode).toBe(404);
    await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 2 });
    expect((await c.w("GET", `/api/checks/${c.checkId}/receipt?share=Z`)).statusCode).toBe(404);
    expect((await c.w("GET", `/api/checks/${c.checkId}/receipt?share=C`)).statusCode).toBe(404);
    expect((await c.w("GET", `/api/checks/nope/receipt`)).statusCode).toBe(404);
    expect((await c.w("GET", `/api/checks/aaaaaaaaaaaaaaaaaaaaaaaa/receipt`)).statusCode).toBe(404);
  });
});
