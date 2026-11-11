import { vatOf } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { billOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

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
  const s = await seedTenant(t);
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
    expect(r).toMatchObject({ paid: true, share: null, table: { name: "T7" }, covers: 2, payments: [] });
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

  it("even split of 4: one '¼' line, VAT allocated and ≤ the share's gross", async () => {
    const c = await setup();
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 4 })).statusCode).toBe(200);
    const bill = await c.bill();
    const r = await c.receipt("?share=C");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].label).toBe("¼");
    expect(r.lines[0].name.en).toMatch(/^of check #\d{4} \(₺/);
    expect(r.lines[0].name.tr).toMatch(/^#\d{4} hesabın \(₺/);
    expect(r.total).toBe(r.lines[0].amount);
    expect(r.share).toEqual({ label: "C", index: 2, of: 4 });
    expect(r.vat).toHaveLength(2);
    for (const v of r.vat as { rate: 10 | 20; amount: number }[]) expect(v.amount).toBeLessThanOrEqual(r.total);
    const grossShare = r.vat.reduce((n: number, v: { rate: 10 | 20; amount: number }) => n + v.amount, 0);
    expect(grossShare).toBeLessThan(r.total);
    expect(bill.total).toBeGreaterThan(r.total);
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
