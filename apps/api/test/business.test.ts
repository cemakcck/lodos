import { pctChange } from "@lodos/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { monthlyPnl } from "../src/business/pnl";
import { makeTestApp, type TestApp } from "./helpers";
import { businessFixture, KOFTE_ID, OCTOBER } from "./business-fixture";

const NOW = new Date("2026-11-14T12:00:00Z"); // Saturday, service day 2026-11-14, 15:00 Istanbul

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterEach(() => t.clock.set(NOW));
afterAll(() => t.close());

describe("monthlyPnl", () => {
  it("reconciles to the kuruş: profit = sales − food and drink − labour − other; margin = profit ÷ sales", async () => {
    const f = await businessFixture(t);
    const pnl = await f.inT(() => monthlyPnl(t.models, "2026-10", NOW));
    expect(pnl).toMatchObject({ sales: OCTOBER.sales, foodDrink: OCTOBER.foodDrink, labour: OCTOBER.labour, other: OCTOBER.other });
    expect(pnl.profit).toBe(pnl.sales - pnl.foodDrink - pnl.labour - pnl.other);
    expect(pnl.profit).toBe(OCTOBER.profit);
    expect(pnl.margin).toBe(pnl.profit / pnl.sales);
    expect(pnl.otherByCategory.map((c) => [c.name.en, c.spent])).toEqual([["Rent", 500_000], ["Utilities", 50_001]]);
    expect(pnl.otherByCategory.reduce((n, c) => n + c.spent, 0)).toBe(pnl.other);
  });

  it("first day of the month at 08:00 with no sales yet: margin null, pctChange null where prev is 0, no throw", async () => {
    const now = new Date("2026-12-01T05:00:00Z"); // 08:00 Istanbul, service day 2026-12-01
    t.clock.set(now);
    const f = await businessFixture(t);
    const pnl = await f.inT(() => monthlyPnl(t.models, "2026-12", now));
    expect(pnl).toMatchObject({ sales: 0, profit: 0, margin: null });
    const res = await f.get("/api/business/monthly");
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    expect(v).toMatchObject({ month: "2026-12", soFar: true, current: { from: "2026-12-01", to: "2026-12-01" }, previous: { month: "2026-11", from: "2026-11-01", to: "2026-11-01" } });
    expect(v.pnl.cur.margin).toBeNull();
    expect(v.pnl.prev.sales).toBe(0);
    expect(pctChange(v.pnl.cur.sales, v.pnl.prev.sales)).toBeNull();
    expect(v.sales.avgCheck).toEqual({ cur: 0, prev: 0 });
    expect(v.sales.turnsPerNight).toEqual({ cur: null, prev: null });
    expect(v.sales.salesPerLabourHour).toEqual({ cur: null, prev: null });
    expect(v.menu).toEqual([]);
    expect(v.ratings.restaurant).toEqual({ cur: null, prev: null });
  });
});

describe("GET /api/business/monthly", () => {
  it("a past month: the P&L equals monthlyPnl and the previous month is complete", async () => {
    const f = await businessFixture(t);
    const res = await f.get("/api/business/monthly?month=2026-10");
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    expect(v).toMatchObject({ month: "2026-10", soFar: false, current: { month: "2026-10", from: "2026-10-01", to: "2026-10-31" }, previous: { month: "2026-09", from: "2026-09-01", to: "2026-09-30" } });
    expect(v.pnl.cur).toEqual(JSON.parse(JSON.stringify(await f.inT(() => monthlyPnl(t.models, "2026-10", NOW)))));
    expect(v.pnl.cur.profit).toBe(OCTOBER.profit);
  });

  it("the current month is so far and compares with the previous month's days 1 … 14", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly")).json();
    expect(v).toMatchObject({ month: "2026-11", soFar: true, current: { from: "2026-11-01", to: "2026-11-14" }, previous: { month: "2026-10", from: "2026-10-01", to: "2026-10-14" } });
    // Previous: 3 Oct sales; labour of 3 and 5 Oct; expenses dated up to 14 Oct only.
    expect(v.pnl.prev).toMatchObject({ sales: 1_000_000, foodDrink: 300_000, labour: 80_000 + 96_000 + 96_000, other: 500_000, profit: -72_000 });
    expect(v.pnl.cur).toMatchObject({ sales: 1_500_000, foodDrink: 120_000, labour: 70_000, other: 500_000, profit: 810_000 });
    expect(v.sales.byDay.cur).toHaveLength(14);
    expect(v.sales.byDay.prev).toHaveLength(14);
    expect(v.sales.covers).toEqual({ cur: 50, prev: 40 });
    expect(v.expenses.byCategory.prev.find((c: { name: { en: string } }) => c.name.en === "Suppliers – drinks").spent).toBe(0);
  });

  it("sales patterns: by weekday and hour per open night, averages, sales per labour hour and table turns", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly?month=2026-10")).json();
    const s = v.sales;
    expect(s.byDay.cur).toHaveLength(31);
    expect(s.byDay.cur.find((d: { day: string }) => d.day === "2026-10-20")).toEqual({ day: "2026-10-20", revenue: 2_000_000, covers: 70, checks: 30 });
    // ISO weekdays: Saturday 6, Tuesday 2.
    expect(s.byWeekday.cur).toHaveLength(7);
    expect(s.byWeekday.cur[5]).toEqual({ weekday: 6, revenue: 1_000_000, nights: 1, avg: 1_000_000 });
    expect(s.byWeekday.cur[1]).toEqual({ weekday: 2, revenue: 2_000_000, nights: 1, avg: 2_000_000 });
    // Two open nights: hour 20 had 400_000 + 2_000_000 → 1_200_000 a night.
    expect(s.byHour.cur).toEqual([{ hour: 19, revenue: 300_000 }, { hour: 20, revenue: 1_200_000 }]);
    expect(s.avgCheck.cur).toBe(Math.round(3_000_000 / 45));
    expect(s.avgCover.cur).toBe(Math.round(3_000_000 / 110));
    expect(s.covers.cur).toBe(110);
    // Labour minutes 480 + 480 + 600 + 480 = 2040 = 34 h.
    expect(s.salesPerLabourHour.cur).toBe(Math.round(3_000_000 / 34));
    const tables = await f.inT(() => t.models.Table.countDocuments({ active: true }));
    expect(s.turnsPerNight.cur).toBe(Math.round((45 / tables / 2) * 100) / 100);
  });

  it("menu: every dish sold with rating joined by item id (generated rows by name) and its group", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly?month=2026-10")).json();
    const rows = v.menu.map((d: { itemId: string | null; name: { en: string }; qty: number; revenue: number; ratingAvg: number; ratingCount: number; group: string }) =>
      [d.itemId, d.name.en, d.qty, d.revenue, d.ratingAvg, d.ratingCount, d.group]);
    expect(rows).toEqual([
      [KOFTE_ID, "Köfte", 70, 1_400_000, 4.75, 4, "stars"],
      [null, "Mezze", 25, 500_000, 3.5, 2, "fix"],
      [null, "Salad", 10, 100_000, 4.5, 2, "hidden_gems"],
      [null, "Soup", 5, 50_000, 2, 1, "rethink"],
    ]);
  });

  it("staff: ranking rows plus labour cost; labour by group and overtime", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly?month=2026-10")).json();
    const deniz = v.staff.find((r: { staffId: string }) => r.staffId === f.ids.waiter);
    expect(deniz).toMatchObject({ name: "Deniz", role: "waiter", group: "floor", minutes: 1080, labourCost: 180_000, ratingCount: 2, ratingAvg: 4.5 });
    expect(deniz).toHaveProperty("score");
    expect(deniz).toHaveProperty("breakdown");
    const emre = v.staff.find((r: { staffId: string }) => r.staffId === f.ids.cook);
    expect(emre).toMatchObject({ group: "kitchen", labourCost: 96_000 });
    expect(v.labourByGroup.cur).toEqual({ floor: 180_000, kitchen: 96_000, bar: 0, managers: 96_000 });
    expect(v.overtimeMinutes).toEqual({ cur: 60, prev: 0 });
  });

  it("ratings: categories, the restaurant rating, distributions, by week and the latest 10 visible comments", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly?month=2026-10")).json();
    const r = v.ratings;
    expect(r.food.cur).toBe(4); // 5, 4, 3
    expect(r.cleanliness.cur).toBe(4);
    expect(r.atmosphere.cur).toBe(5);
    expect(r.restaurant.cur).toBeCloseTo(13 / 3, 10);
    expect(r.food.prev).toBeNull();
    expect(r.dist.restaurant.cur).toEqual([0, 0, 1, 3, 3]);
    expect(r.dist.waiter.cur).toEqual([0, 0, 0, 1, 1]);
    expect(r.dist.dish.cur).toEqual([0, 1, 1, 3, 4]);
    expect(r.byWeek.cur.map((w: { week: string }) => w.week)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(r.byWeek.cur[0]).toMatchObject({ week: "2026-09-28", food: 4.5, count: 6 });
    expect(r.comments).toHaveLength(10);
    expect(r.comments[0].comment).toBe("October comment 10");
    expect(r.comments.map((c: { comment: string }) => c.comment)).not.toContain("Hidden rude remark");
    expect(r.comments.map((c: { comment: string }) => c.comment)).not.toContain("November comment");
  });

  it("expenses: per category spent vs budget and the 5 biggest", async () => {
    const f = await businessFixture(t);
    const v = (await f.get("/api/business/monthly?month=2026-10")).json();
    expect(v.expenses.byCategory.cur.map((c: { name: { en: string }; spent: number; budget: number }) => [c.name.en, c.spent, c.budget])).toEqual([
      ["Suppliers – food", 300_000, 350_000],
      ["Suppliers – drinks", 100_000, 0],
      ["Rent", 500_000, 500_000],
      ["Utilities", 50_001, 40_000],
    ]);
    expect(v.expenses.biggest.map((e: { amount: number; date: string }) => [e.amount, e.date])).toEqual([
      [500_000, "2026-10-01"],
      [300_000, "2026-10-02"],
      [100_000, "2026-10-18"],
      [50_001, "2026-10-25"],
    ]);
    expect(v.expenses.biggest[0]).toMatchObject({ payee: "Landlord", category: { en: "Rent", tr: "Kira" } });
  });

  it("validates the month, and is manager only", async () => {
    const f = await businessFixture(t);
    expect((await f.get("/api/business/monthly?month=2026-13")).statusCode).toBe(400);
    for (const url of ["/api/business/monthly", "/api/business/monthly.pdf", "/api/business/monthly.csv?section=menu"]) {
      expect((await f.waiterGet(url)).statusCode, url).toBe(403);
    }
    expect((await f.get("/api/business/monthly.csv?section=nope")).statusCode).toBe(400);
  });
});

describe("GET /api/business/monthly.csv", () => {
  it("menu: a BOM, then the header with the group column and one row per dish", async () => {
    const f = await businessFixture(t);
    const res = await f.get("/api/business/monthly.csv?month=2026-10&section=menu");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toContain("lodos-menu-2026-10.csv");
    expect(res.body.startsWith("﻿")).toBe(true);
    const lines = res.body.slice(1).split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("item_en,item_tr,group,group_en,group_tr,qty,revenue_lira,rating_avg,rating_count");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('"Köfte","Köfte","stars","Stars","Yıldızlar",70,14000.00,4.75,4');
    expect(lines[3]).toBe('"Salad","Salata","hidden_gems","Hidden gems","Gizli hazineler",10,1000.00,4.50,2');
  });

  it("staff, expenses and days sections", async () => {
    const f = await businessFixture(t);
    const csv = async (section: string) => (await f.get(`/api/business/monthly.csv?month=2026-10&section=${section}`)).body.slice(1).split("\r\n").filter(Boolean);
    const staff = await csv("staff");
    expect(staff[0]).toBe("name,role,group,score,rating_avg,rating_count,hours,planned_hours,late_shifts,labour_cost_lira");
    expect(staff.find((l) => l.startsWith('"Deniz"'))).toBe('"Deniz","waiter","floor",,4.50,2,18.0,0.0,0,1800.00');
    const expenses = await csv("expenses");
    expect(expenses[0]).toBe("category_en,category_tr,kind,spent_lira,budget_lira");
    expect(expenses[4]).toBe('"Utilities","Faturalar","other",500.01,400.00');
    const days = await csv("days");
    expect(days[0]).toBe("service_day,weekday,revenue_lira,covers,checks");
    expect(days).toHaveLength(32);
    expect(days[3]).toBe('"2026-10-03",6,10000.00,40,15');
  });
});
