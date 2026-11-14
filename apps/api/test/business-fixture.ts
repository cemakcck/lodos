import { emptyAgg, type Agg } from "@lodos/shared";
import { Types } from "mongoose";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";
import { newTenant, type TestApp } from "./helpers";

/**
 * A hand-made restaurant month for the business dashboard tests: generated summaries on 3 and 20 October and
 * 2 November, one raw clock entry on 5 October, and expenses in both months. Everything else is wiped.
 */
export const KOFTE_ID = new Types.ObjectId().toHexString();
const name = (en: string, tr = en) => ({ en, tr });
const agg = (stars: number[]): Agg => {
  const dist = [0, 0, 0, 0, 0] as Agg["dist"];
  for (const s of stars) dist[s - 1]! += 1;
  return { sum: stars.reduce((a, b) => a + b, 0), count: stars.length, dist };
};

export async function businessFixture(t: TestApp) {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, t.clock.now(), { liveService: false, history: false });
  const inT = <T>(fn: () => PromiseLike<T>) => runWithTenant(tenantId, fn);
  const m = t.models;
  const ids = await inT(async () => {
    await Promise.all([
      m.DailySummary.deleteMany({}), m.Rating.deleteMany({}), m.ClockEntry.deleteMany({}), m.Expense.deleteMany({}),
      m.ExpenseCategory.deleteMany({}), m.Check.deleteMany({}), m.Ticket.deleteMany({}), m.Adjustment.deleteMany({}), m.Shift.deleteMany({}),
    ]);
    const cook = String((await m.Staff.findOne({ name: "Emre Yıldız" }).lean().orFail())._id);
    const waiter = seed.staff.waiter;
    const manager = seed.staff.manager;
    const summary = (serviceDay: string, x: { revenue: number; covers: number; checks: number; items: object[]; byHour: object[]; people: object[]; ratings: object }) =>
      m.DailySummary.create({
        serviceDay, ...x, comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 }, ticketTimes: { kitchen: [], bar: [] },
        payments: { card: x.revenue, cash: 0 }, byServer: [{ staffId: waiter, checks: x.checks, covers: x.covers, sales: x.revenue }], generated: true,
      });
    const person = (staffId: string, minutes: number, labourCost: number, extra: object = {}) =>
      ({ staffId, minutes, labourCost, overtimeMinutes: 0, shifts: 1, lateShifts: 0, ...extra });
    // 2026-10-03 is a Saturday, 2026-10-20 a Tuesday, 2026-11-02 a Monday.
    await summary("2026-10-03", {
      revenue: 1_000_000, covers: 40, checks: 15,
      items: [
        { itemId: null, name: name("Köfte"), qty: 30, revenue: 600_000 },
        { itemId: null, name: name("Mezze"), qty: 15, revenue: 300_000 },
        { itemId: null, name: name("Salad", "Salata"), qty: 10, revenue: 100_000 },
      ],
      byHour: [{ hour: 19, revenue: 600_000, covers: 25, checks: 9, comps: 0 }, { hour: 20, revenue: 400_000, covers: 15, checks: 6, comps: 0 }],
      people: [person(waiter, 480, 80_000), person(cook, 480, 96_000, { overtimeMinutes: 60 })],
      ratings: {
        waiter: [{ staffId: waiter, ...agg([5, 4]) }],
        dishes: [{ itemId: null, name: name("Köfte"), ...agg([5, 5, 4]) }, { itemId: null, name: name("Salad", "Salata"), ...agg([5, 4]) }],
        food: agg([5, 4]), cleanliness: agg([4, 4]), atmosphere: agg([5, 5]),
      },
    });
    await summary("2026-10-20", {
      revenue: 2_000_000, covers: 70, checks: 30,
      items: [
        { itemId: KOFTE_ID, name: name("Köfte"), qty: 40, revenue: 800_000 },
        { itemId: null, name: name("Mezze"), qty: 10, revenue: 200_000 },
        { itemId: null, name: name("Soup", "Çorba"), qty: 5, revenue: 50_000 },
      ],
      byHour: [{ hour: 20, revenue: 2_000_000, covers: 70, checks: 30, comps: 0 }],
      people: [person(waiter, 600, 100_000)],
      ratings: {
        waiter: [], food: agg([3]), cleanliness: emptyAgg(), atmosphere: emptyAgg(),
        dishes: [{ itemId: KOFTE_ID, name: name("Köfte"), ...agg([5]) }, { itemId: null, name: name("Mezze"), ...agg([4, 3]) }, { itemId: null, name: name("Soup", "Çorba"), ...agg([2]) }],
      },
    });
    await summary("2026-11-02", {
      revenue: 1_500_000, covers: 50, checks: 20,
      items: [{ itemId: KOFTE_ID, name: name("Köfte"), qty: 25, revenue: 500_000 }],
      byHour: [{ hour: 21, revenue: 1_500_000, covers: 50, checks: 20, comps: 0 }],
      people: [person(waiter, 420, 70_000)],
      ratings: { waiter: [], dishes: [], food: agg([5]), cleanliness: emptyAgg(), atmosphere: emptyAgg() },
    });
    // A raw clock entry: 8 h at ₺120/h = 96_000 kuruş.
    await m.ClockEntry.create({ staffId: manager, serviceDay: "2026-10-05", in: new Date("2026-10-05T07:00:00Z"), out: new Date("2026-10-05T15:00:00Z"), rate: 12_000 });

    const cat = async (en: string, tr: string, kind: "food_drink" | "other", monthlyBudget: number, sort: number) =>
      String((await m.ExpenseCategory.create({ name: { en, tr }, kind, monthlyBudget, sort }))._id);
    const food = await cat("Suppliers – food", "Tedarikçi – yiyecek", "food_drink", 350_000, 0);
    const drinks = await cat("Suppliers – drinks", "Tedarikçi – içecek", "food_drink", 0, 1);
    const rent = await cat("Rent", "Kira", "other", 500_000, 2);
    const utilities = await cat("Utilities", "Faturalar", "other", 40_000, 3);
    const expense = (categoryId: string, amount: number, date: string, payee: string | null = null) =>
      m.Expense.create({ categoryId, amount, date, payee, createdBy: manager });
    await expense(rent, 500_000, "2026-10-01", "Landlord");
    await expense(food, 300_000, "2026-10-02", "Halil Bey");
    await expense(drinks, 100_000, "2026-10-18");
    await expense(utilities, 50_001, "2026-10-25");
    await expense(rent, 500_000, "2026-11-01", "Landlord");
    await expense(food, 120_000, "2026-11-03");

    // Comments: 11 visible in October (newest first by submittedAt), one hidden, one in November.
    const comment = (serviceDay: string, minute: number, text: string, hidden = false) =>
      m.Rating.create({
        serviceDay, paidAt: new Date(`${serviceDay}T18:00:00Z`), submittedAt: new Date(new Date(`${serviceDay}T19:00:00Z`).getTime() + minute * 60_000),
        comment: text, commentHidden: hidden,
      });
    for (let i = 0; i < 11; i++) await comment("2026-10-25", i, `October comment ${i}`);
    await comment("2026-10-26", 0, "Hidden rude remark", true);
    await comment("2026-11-03", 0, "November comment");
    return { cook, waiter, manager };
  });
  const sid = await createSession(m, seed.staff.manager, tenantId, "person", t.clock.now());
  const wsid = await createSession(m, seed.staff.waiter, tenantId, "person", t.clock.now());
  const get = (url: string, cookie = sid) => t.inject({ method: "GET", url, cookies: { lodos_sid: cookie } });
  return { tenantId, seed, inT, ids, get, waiterGet: (url: string) => get(url, wsid) };
}

/** October's figures, by hand. */
export const OCTOBER = {
  sales: 3_000_000,
  foodDrink: 400_000,
  labour: 80_000 + 96_000 + 100_000 + 96_000,
  other: 550_001,
  profit: 3_000_000 - 400_000 - 372_000 - 550_001,
};
