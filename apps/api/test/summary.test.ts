import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { ensureSummaries, summarizeDay, summaryJob } from "../src/sales/summary";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

/** Service day 2026-11-10 runs 2026-11-10T03:00Z (06:00 Istanbul) to 2026-11-11T03:00Z. */
const DAY = "2026-11-10";
const at = (iso: string) => new Date(iso);

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: at("2026-11-10T14:00:00Z") });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Req = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload?: object) => ReturnType<TestApp["inject"]>;

async function session(s: Seeded, who: "waiter" | "waiter2" | "manager"): Promise<Req> {
  // Sessions are checked against the moving clock: create them at its current time.
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", t.clock.now());
  return (method, path, payload) => t.inject({ method, url: path, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}

/** A fresh tenant without live service, so only this test's checks exist. */
async function fresh() {
  t.clock.set(at("2026-11-10T14:00:00Z"));
  const s = await seedTenant(t, { liveService: false });
  const w = await session(s, "waiter");
  const m = await session(s, "manager");
  const inTenant = <T>(fn: () => PromiseLike<T>) => runWithTenant(s.tenantId, fn);
  const seat = async (table: string, covers: number) => {
    const res = await w("POST", `/api/tables/${s.seed.tables[table]!.id}/seat`, { covers });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().checkId as string;
  };
  const order = async (table: string, items: { itemId: string; qty?: number }[]) => {
    const res = await w("POST", `/api/tables/${s.seed.tables[table]!.id}/orders`, orderBody(items));
    expect(res.statusCode, res.body).toBe(201);
    return res.json().orderId as string;
  };
  const close = async (checkId: string, method: "card" | "cash") => {
    const res = await w("POST", `/api/checks/${checkId}/close`, { method });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().check.payment.amount as number;
  };
  return { s, w, m, inTenant, seat, order, close };
}

describe("daily summaries", () => {
  it("live equals stored: revenue, checks, covers, comps, voids, hours, ticket times, items, payments", async () => {
    const c = await fresh();
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const spritz = await itemNamed(t, c.s.tenantId, "Bergamot spritz");

    // 18:00 Istanbul: T7 (2 covers), Burrata × 2 + Spritz × 1; one Burrata comped at 18:05.
    t.clock.set(at("2026-11-10T15:00:00Z"));
    const a = await c.seat("T7", 2);
    const aOrder = await c.order("T7", [{ itemId: burrata.id, qty: 2 }, { itemId: spritz.id }]);
    t.clock.set(at("2026-11-10T15:05:00Z"));
    const comp = await c.m("POST", `/api/checks/${a}/adjustments`, { lineRef: `${aOrder}:0`, kind: "comp", qty: 1, reason: "celebration" });
    expect(comp.statusCode, comp.body).toBe(201);
    // Kitchen ticket ready after 12 min (sent 18:00), bar ticket after 4 min.
    const tickets = await c.inTenant(() => t.models.Ticket.find({ orderId: aOrder }).lean());
    const kitchenTicket = tickets.find((x) => x.station === "kitchen")!;
    const barTicket = tickets.find((x) => x.station === "bar")!;
    t.clock.set(at("2026-11-10T15:04:00Z"));
    expect((await c.m("POST", `/api/tickets/${String(barTicket._id)}/bump`)).statusCode).toBe(200);
    t.clock.set(at("2026-11-10T15:12:00Z"));
    expect((await c.m("POST", `/api/tickets/${String(kitchenTicket._id)}/bump`)).statusCode).toBe(200);
    // Closed (card) 19:30 Istanbul.
    t.clock.set(at("2026-11-10T16:30:00Z"));
    const aPaid = await c.close(a, "card");
    expect(aPaid).toBe(burrata.price + spritz.price);

    // 19:00 Istanbul: T8 (4 covers), Fries × 3; one voided at 19:05 (before ready). Closed (cash) 20:10.
    t.clock.set(at("2026-11-10T16:00:00Z"));
    const b = await c.seat("T8", 4);
    const bOrder = await c.order("T8", [{ itemId: fries.id, qty: 3 }]);
    t.clock.set(at("2026-11-10T16:05:00Z"));
    const voided = await c.m("POST", `/api/checks/${b}/adjustments`, { lineRef: `${bOrder}:0`, kind: "void", qty: 1, reason: "wrong_item" });
    expect(voided.statusCode, voided.body).toBe(201);
    t.clock.set(at("2026-11-10T17:10:00Z"));
    const bPaid = await c.close(b, "cash");
    expect(bPaid).toBe(2 * fries.price);

    // 20:00 Istanbul: T9 (3 covers), Burrata × 1 + Fries × 1, split evenly in two:
    // share A paid 21:10 (card), share B 22:05 (cash), which closes the check.
    t.clock.set(at("2026-11-10T17:00:00Z"));
    const cc = await c.seat("T9", 3);
    await c.order("T9", [{ itemId: burrata.id }, { itemId: fries.id }]);
    expect((await c.w("PUT", `/api/checks/${cc}/split`, { mode: "even", count: 2 })).statusCode).toBe(200);
    const shares = (await c.w("GET", `/api/checks/${cc}/split`)).json().shares as { label: string; amount: number }[];
    t.clock.set(at("2026-11-10T18:10:00Z"));
    expect((await c.w("POST", `/api/checks/${cc}/shares/A/pay`, { method: "card", amount: shares[0]!.amount })).statusCode).toBe(200);
    t.clock.set(at("2026-11-10T19:05:00Z"));
    expect((await c.w("POST", `/api/checks/${cc}/shares/B/pay`, { method: "cash", amount: shares[1]!.amount })).statusCode).toBe(200);
    expect((await c.inTenant(() => t.models.Check.findById(cc).lean().orFail())).status).toBe("paid");

    const total = aPaid + bPaid + shares[0]!.amount + shares[1]!.amount;
    expect(shares[0]!.amount + shares[1]!.amount).toBe(burrata.price + fries.price);

    t.clock.set(at("2026-11-11T09:00:00Z")); // the next service day
    const live = await c.inTenant(() => summarizeDay(t.models, DAY));
    expect(live).toMatchObject({
      serviceDay: DAY,
      revenue: total,
      checks: 3,
      covers: 9,
      comps: { count: 1, amount: burrata.price },
      voids: { count: 1, amount: fries.price },
      payments: { card: aPaid + shares[0]!.amount, cash: bPaid + shares[1]!.amount },
      generated: false,
    });
    expect(live.byHour).toEqual([
      { hour: 18, revenue: 0, covers: 0, checks: 0, comps: burrata.price },
      { hour: 19, revenue: aPaid, covers: 2, checks: 1, comps: fries.price },
      { hour: 20, revenue: bPaid, covers: 4, checks: 1, comps: 0 },
      { hour: 21, revenue: shares[0]!.amount, covers: 0, checks: 0, comps: 0 },
      { hour: 22, revenue: shares[1]!.amount, covers: 3, checks: 1, comps: 0 },
    ]);
    expect(live.ticketTimes).toEqual({
      kitchen: [{ hour: 18, count: 1, totalMs: 12 * 60_000, onTime: 1 }],
      bar: [{ hour: 18, count: 1, totalMs: 4 * 60_000, onTime: 1 }],
    });
    const items = Object.fromEntries(live.items.map((i) => [i.itemId, { qty: i.qty, revenue: i.revenue }]));
    expect(items).toEqual({
      // Burrata: 2 on T7 (1 comped, charged 1) + 1 on T9.
      [burrata.id]: { qty: 2, revenue: 2 * burrata.price },
      // Fries: 3 on T8 (1 voided) + 1 on T9.
      [fries.id]: { qty: 3, revenue: 3 * fries.price },
      [spritz.id]: { qty: 1, revenue: spritz.price },
    });
    expect(live.items.map((i) => i.itemId)).toEqual([fries.id, burrata.id, spritz.id]); // most sold first

    // spec §11: a stored summary equals a live computation of the same day.
    const ensured = await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    expect(ensured.get(DAY)).toEqual(live);
    const stored = await c.inTenant(() => t.models.DailySummary.find({}).lean());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ serviceDay: DAY, revenue: total, checks: 3, covers: 9, generated: false });
    // A second call reads the stored document (no recompute, no duplicate).
    const again = await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    expect(again.get(DAY)).toEqual(live);
    expect(await c.inTenant(() => t.models.DailySummary.countDocuments({}))).toBe(1);
  });

  it("byServer: per waiter checks, covers and the payments on their checks; the sums equal the day's", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    t.clock.set(at("2026-11-10T15:00:00Z"));
    const w2 = await session(c.s, "waiter2");
    // Deniz: T7 (2 covers, card) and T9 (3 covers, split in two, both shares paid). Mert: T8 (4 covers, cash).
    const a = await c.seat("T7", 2);
    await c.order("T7", [{ itemId: fries.id, qty: 2 }]);
    const cc = await c.seat("T9", 3);
    await c.order("T9", [{ itemId: burrata.id }, { itemId: fries.id }]);
    const seatB = await w2("POST", `/api/tables/${c.s.seed.tables.T8!.id}/seat`, { covers: 4 });
    expect(seatB.statusCode, seatB.body).toBe(201);
    const b = seatB.json().checkId as string;
    expect((await w2("POST", `/api/tables/${c.s.seed.tables.T8!.id}/orders`, orderBody([{ itemId: burrata.id, qty: 3 }]))).statusCode).toBe(201);
    t.clock.set(at("2026-11-10T16:00:00Z"));
    const aPaid = await c.close(a, "card");
    const bRes = await w2("POST", `/api/checks/${b}/close`, { method: "cash" });
    expect(bRes.statusCode, bRes.body).toBe(200);
    const bPaid = bRes.json().check.payment.amount as number;
    expect((await c.w("PUT", `/api/checks/${cc}/split`, { mode: "even", count: 2 })).statusCode).toBe(200);
    const shares = (await c.w("GET", `/api/checks/${cc}/split`)).json().shares as { amount: number }[];
    for (const [label, share] of [["A", shares[0]!], ["B", shares[1]!]] as const) {
      expect((await c.w("POST", `/api/checks/${cc}/shares/${label}/pay`, { method: "card", amount: share.amount })).statusCode).toBe(200);
    }

    const live = await c.inTenant(() => summarizeDay(t.models, DAY));
    const deniz = c.s.seed.staff.waiter;
    const mert = c.s.seed.staff.waiter2;
    expect(live.byServer).toEqual(
      [
        { staffId: deniz, checks: 2, covers: 5, sales: aPaid + shares[0]!.amount + shares[1]!.amount },
        { staffId: mert, checks: 1, covers: 4, sales: bPaid },
      ].sort((x, y) => x.staffId.localeCompare(y.staffId)),
    );
    const sum = (k: "checks" | "covers" | "sales") => live.byServer.reduce((n, r) => n + r[k], 0);
    expect([sum("checks"), sum("covers"), sum("sales")]).toEqual([live.checks, live.covers, live.revenue]);

    t.clock.set(at("2026-11-11T09:00:00Z"));
    const ensured = await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    expect(ensured.get(DAY)).toEqual(live);
    const again = await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    expect(again.get(DAY)!.byServer).toEqual(live.byServer);
  });

  it("onTime counts tickets ready within the tenant's late threshold, one at exactly lateMin included", async () => {
    const c = await fresh();
    await c.inTenant(() => t.models.Setting.updateOne({}, { $set: { lateMin: 12 } }));
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const ready = async (table: string, sentIso: string, readyIso: string) => {
      t.clock.set(at(sentIso));
      await c.seat(table, 2);
      const orderId = await c.order(table, [{ itemId: fries.id }]);
      const ticket = await c.inTenant(() => t.models.Ticket.findOne({ orderId }).lean().orFail());
      t.clock.set(at(readyIso));
      expect((await c.m("POST", `/api/tickets/${String(ticket._id)}/bump`)).statusCode).toBe(200);
    };
    await ready("T7", "2026-11-10T15:00:00Z", "2026-11-10T15:12:00Z"); // exactly 12 min: on time
    await ready("T8", "2026-11-10T15:10:00Z", "2026-11-10T15:22:01Z"); // 12 min 1 s: late
    await ready("T9", "2026-11-10T16:00:00Z", "2026-11-10T16:05:00Z"); // 5 min: on time
    const live = await c.inTenant(() => summarizeDay(t.models, DAY));
    expect(live.ticketTimes.kitchen).toEqual([
      { hour: 18, count: 2, totalMs: 12 * 60_000 + 12 * 60_000 + 1_000, onTime: 1 },
      { hour: 19, count: 1, totalMs: 5 * 60_000, onTime: 1 },
    ]);
  });

  it("payment time decides the service day: opened 05:30 and paid 06:10 counts on the new day; paid 05:59 on the previous", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    // Both opened 05:30 Istanbul on 2026-11-11 (still service day 2026-11-10).
    t.clock.set(at("2026-11-11T02:30:00Z"));
    const late = await session(c.s, "waiter");
    let res = await late("POST", `/api/tables/${c.s.seed.tables.T7!.id}/seat`, { covers: 2 });
    const early = res.json().checkId as string;
    res = await late("POST", `/api/tables/${c.s.seed.tables.T8!.id}/seat`, { covers: 3 });
    const next = res.json().checkId as string;
    await late("POST", `/api/tables/${c.s.seed.tables.T7!.id}/orders`, orderBody([{ itemId: fries.id }]));
    await late("POST", `/api/tables/${c.s.seed.tables.T8!.id}/orders`, orderBody([{ itemId: fries.id, qty: 2 }]));
    t.clock.set(at("2026-11-11T02:59:00Z")); // 05:59
    expect((await late("POST", `/api/checks/${early}/close`, { method: "card" })).statusCode).toBe(200);
    t.clock.set(at("2026-11-11T03:10:00Z")); // 06:10
    expect((await late("POST", `/api/checks/${next}/close`, { method: "cash" })).statusCode).toBe(200);

    const prev = await c.inTenant(() => summarizeDay(t.models, "2026-11-10"));
    const day = await c.inTenant(() => summarizeDay(t.models, "2026-11-11"));
    expect(prev).toMatchObject({ revenue: fries.price, checks: 1, covers: 2, payments: { card: fries.price, cash: 0 } });
    expect(prev.byHour).toEqual([{ hour: 5, revenue: fries.price, covers: 2, checks: 1, comps: 0 }]);
    expect(day).toMatchObject({ revenue: 2 * fries.price, checks: 1, covers: 3, payments: { card: 0, cash: 2 * fries.price } });
    expect(day.byHour).toEqual([{ hour: 6, revenue: 2 * fries.price, covers: 3, checks: 1, comps: 0 }]);
  });

  it("comps and voids count adjustments, not units: a comp of 2 units is count 1, amount both units", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    t.clock.set(at("2026-11-10T15:00:00Z"));
    const checkId = await c.seat("T7", 2);
    const orderId = await c.order("T7", [{ itemId: fries.id, qty: 3 }]);
    const comp = await c.m("POST", `/api/checks/${checkId}/adjustments`, { lineRef: `${orderId}:0`, kind: "comp", qty: 2, reason: "celebration" });
    expect(comp.statusCode, comp.body).toBe(201);
    const day = await c.inTenant(() => summarizeDay(t.models, DAY));
    expect(day.comps).toEqual({ count: 1, amount: 2 * fries.price });
    expect(day.voids).toEqual({ count: 0, amount: 0 });
  });

  it("undoing an adjustment of a stored past day drops that day's summary, so it is recomputed without it", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    // 01:00 Istanbul on the 11th is still service day the 10th; the check stays open past 06:00.
    t.clock.set(at("2026-11-10T22:00:00Z"));
    const checkId = await c.seat("T7", 2);
    const orderId = await c.order("T7", [{ itemId: fries.id, qty: 2 }]);
    const m1 = await session(c.s, "manager");
    const comp = await m1("POST", `/api/checks/${checkId}/adjustments`, { lineRef: `${orderId}:0`, kind: "comp", qty: 1, reason: "celebration" });
    expect(comp.statusCode, comp.body).toBe(201);
    t.clock.set(at("2026-11-11T05:00:00Z"));
    await c.inTenant(() => ensureSummaries(t.models, ["2026-11-09", DAY], "2026-11-11"));
    const stored = () => c.inTenant(() => t.models.DailySummary.find({}).sort({ serviceDay: 1 }).lean());
    expect((await stored()).map((d) => [d.serviceDay, d.comps.count])).toEqual([["2026-11-09", 0], [DAY, 1]]);

    const m2 = await session(c.s, "manager");
    const undo = await m2("DELETE", `/api/checks/${checkId}/adjustments/${comp.json().adjustment.id}`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect((await stored()).map((d) => d.serviceDay)).toEqual(["2026-11-09"]);
    const again = await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    expect(again.get(DAY)!.comps).toEqual({ count: 0, amount: 0 });
  });

  it("undoing an adjustment never drops a generated demo-history day (it has no raw checks to recompute from)", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    t.clock.set(at("2026-11-10T22:00:00Z"));
    const checkId = await c.seat("T7", 2);
    const orderId = await c.order("T7", [{ itemId: fries.id, qty: 2 }]);
    const m1 = await session(c.s, "manager");
    const comp = await m1("POST", `/api/checks/${checkId}/adjustments`, { lineRef: `${orderId}:0`, kind: "comp", qty: 1, reason: "celebration" });
    expect(comp.statusCode, comp.body).toBe(201);
    t.clock.set(at("2026-11-11T05:00:00Z"));
    await c.inTenant(() => ensureSummaries(t.models, [DAY], "2026-11-11"));
    // The stored day is demo history (as the seed writes it).
    await c.inTenant(() => t.models.DailySummary.updateOne({ serviceDay: DAY }, { $set: { generated: true } }));

    const m2 = await session(c.s, "manager");
    const undo = await m2("DELETE", `/api/checks/${checkId}/adjustments/${comp.json().adjustment.id}`);
    expect(undo.statusCode, undo.body).toBe(200);
    const kept = await c.inTenant(() => t.models.DailySummary.find({ serviceDay: DAY }).lean());
    expect(kept.map((d) => d.generated)).toEqual([true]);
  });

  it("never stores today (or a later day); past days are stored", async () => {
    const c = await fresh();
    const out = await c.inTenant(() => ensureSummaries(t.models, ["2026-11-09", "2026-11-10"], "2026-11-10"));
    expect([...out.keys()].sort()).toEqual(["2026-11-09", "2026-11-10"]);
    expect(out.get("2026-11-10")).toMatchObject({ revenue: 0, checks: 0, byHour: [] });
    const stored = await c.inTenant(() => t.models.DailySummary.find({}).lean());
    expect(stored.map((d) => d.serviceDay)).toEqual(["2026-11-09"]);
  });

  it("concurrent ensures of the same day store one summary", async () => {
    const c = await fresh();
    const runs = await Promise.all([1, 2, 3].map(() => c.inTenant(() => ensureSummaries(t.models, ["2026-11-08"], "2026-11-10"))));
    for (const r of runs) expect(r.get("2026-11-08")).toMatchObject({ serviceDay: "2026-11-08", revenue: 0 });
    expect(await c.inTenant(() => t.models.DailySummary.countDocuments({ serviceDay: "2026-11-08" }))).toBe(1);
  });

  it("the summary job writes yesterday's summary for every tenant, once", async () => {
    const c1 = await fresh();
    const c2 = await fresh();
    const now = at("2026-11-11T05:00:00Z"); // 08:00 Istanbul, service day 2026-11-11
    await summaryJob(t.models, now);
    await summaryJob(t.models, now);
    for (const c of [c1, c2]) {
      const docs = await c.inTenant(() => t.models.DailySummary.find({}).lean());
      expect(docs.map((d) => d.serviceDay)).toEqual(["2026-11-10"]);
    }
    // A tenant created today (e.g. a new sandbox) gets no summary for a day before it existed.
    t.clock.set(at("2026-11-11T04:00:00Z"));
    const newer = await seedTenant(t, { liveService: false });
    await summaryJob(t.models, now);
    expect(await runWithTenant(newer.tenantId, () => t.models.DailySummary.countDocuments({}))).toBe(0);
  });
});
