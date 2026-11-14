import { shiftSpan } from "@lodos/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { monthlyPnl } from "../src/business/pnl";
import { businessFixture } from "./business-fixture";
import { makeTestApp, type TestApp } from "./helpers";

const NOW = new Date("2026-11-14T12:00:00Z"); // Saturday, service day 2026-11-14, 15:00 Istanbul
const at = (iso: string) => new Date(iso);

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterEach(() => t.clock.set(NOW));
afterAll(() => t.close());

/** Today's rota, built relative to the fixed clock: every attendance state once. */
async function withRota() {
  const f = await businessFixture(t);
  const { waiter, waiter2, kitchen, bar, manager } = f.seed.staff;
  const m = t.models;
  await f.inT(async () => {
    const shift = (staffId: string, start: string, end: string) =>
      m.Shift.create({ staffId, serviceDay: "2026-11-14", ...shiftSpan("2026-11-14", start, end), area: "salon" });
    await shift(waiter, "14:00", "22:00"); // in on time
    await shift(waiter2, "14:00", "22:00"); // in 18 min late
    await shift(kitchen, "21:00", "23:00"); // later today
    await shift(manager, "14:00", "22:00"); // started 60 min ago, not in
    await m.ClockEntry.create({ staffId: waiter, serviceDay: "2026-11-14", in: at("2026-11-14T11:00:00Z"), rate: 10_000 });
    await m.ClockEntry.create({ staffId: waiter2, serviceDay: "2026-11-14", in: at("2026-11-14T11:18:00Z"), rate: 10_000 });
    await m.ClockEntry.create({ staffId: bar, serviceDay: "2026-11-14", in: at("2026-11-14T11:30:00Z"), rate: 10_000 }); // no shift
    const rate = (n: number, name: { en: string; tr: string }, stars: number) =>
      m.Rating.create({
        serviceDay: "2026-11-13", paidAt: at("2026-11-13T18:00:00Z"), submittedAt: at(`2026-11-13T19:0${n}:00Z`),
        dishes: [{ itemId: null, name, station: "kitchen", stars }],
      });
    for (let i = 0; i < 5; i++) await rate(i, { en: "Manti", tr: "Mantı" }, 3);
    for (let i = 0; i < 5; i++) await rate(i, { en: "Sea bass", tr: "Levrek" }, 5);
    for (let i = 0; i < 4; i++) await rate(i, { en: "Soup", tr: "Çorba" }, 2); // too few ratings
  });
  return f;
}

describe("GET /api/business/overview", () => {
  it("month is monthlyPnl of this month, the same as the monthly page's pnl.cur", async () => {
    const f = await withRota();
    const res = await f.get("/api/business/overview");
    expect(res.statusCode, res.body).toBe(200);
    const o = res.json();
    const monthly = (await f.get("/api/business/monthly")).json();
    const { budgetTotal, expensesTotal, ...pnl } = o.month;
    expect(pnl).toEqual(monthly.pnl.cur);
    expect(pnl).toEqual(JSON.parse(JSON.stringify(await f.inT(() => monthlyPnl(t.models, "2026-11", NOW)))));
    expect(expensesTotal).toBe(500_000 + 120_000);
    expect(budgetTotal).toBe(350_000 + 0 + 500_000 + 40_000);
    expect(o.expenses).toMatchObject({ total: expensesTotal, budget: budgetTotal });
    // This month's only: October's utilities bill is not among the latest.
    expect(o.expenses.latest.map((e: { amount: number; date: string }) => [e.date, e.amount])).toEqual([["2026-11-03", 120_000], ["2026-11-01", 500_000]]);
    expect(o.expenses.latest[0].category.en).toBe("Suppliers – food");
  });

  it("working: on_shift, late (with minutes), later and missing for the rota, plus an unscheduled clock-in", async () => {
    const f = await withRota();
    const { waiter, waiter2, kitchen, bar, manager } = f.seed.staff;
    const o = (await f.get("/api/business/overview")).json();
    const by = new Map<string, { status: string; lateMin?: number; in?: string; shift?: object }>(o.working.map((w: { staffId: string }) => [w.staffId, w]));
    expect(by.get(waiter)).toMatchObject({ status: "on_shift", in: "2026-11-14T11:00:00.000Z" });
    expect(by.get(waiter2)).toMatchObject({ status: "late", lateMin: 18 });
    expect(by.get(kitchen)).toMatchObject({ status: "later" });
    expect(by.get(manager)).toMatchObject({ status: "missing" });
    expect(by.get(bar)).toMatchObject({ status: "unscheduled", in: "2026-11-14T11:30:00.000Z" });
    expect(by.get(bar)!.shift).toBeUndefined();
    expect(by.get(waiter)!.shift).toBeDefined();
    expect(o.working).toHaveLength(5);
    expect(o.working.at(-1).staffId).toBe(bar); // unscheduled last
  });

  it("dishes: best by average, needs work below 4.0 with at least 5 ratings in the last 7 days", async () => {
    const f = await withRota();
    const o = (await f.get("/api/business/overview")).json();
    expect(o.dishes.best.map((d: { name: { en: string } }) => d.name.en)).toEqual(["Sea bass", "Manti"]);
    expect(o.dishes.needsWork).toEqual([{ itemId: null, name: { en: "Manti", tr: "Mantı" }, avg: 3, count: 5 }]);
    expect(o.rating7d).toEqual({ restaurant: null, prev: 5 }); // no category ratings last week; the fixture has a 5-star food rating on 2 Nov
  });

  it("carries today against last week, the top-staff groups and a rating shape", async () => {
    const f = await withRota();
    const o = (await f.get("/api/business/overview")).json();
    expect(o.today).toEqual({ sales: 0, salesPrev: 0, covers: 0, coversPrev: 0 });
    expect(Object.keys(o.topStaff).sort()).toEqual(["bar", "floor", "kitchen"]);
  });

  it("is manager only: a waiter gets 403", async () => {
    const f = await businessFixture(t);
    expect((await f.waiterGet("/api/business/overview")).statusCode).toBe(403);
  });
});
