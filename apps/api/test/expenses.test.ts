import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { expensesForMonth, seedExpenseCategories } from "../src/expenses/service";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z"); // service day 2026-11-10

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

async function fresh() {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false, history: false });
  await runWithTenant(tenantId, () => seedExpenseCategories(t.models));
  const sid = await createSession(t.models, seed.staff.manager, tenantId, "person", NOW);
  const wsid = await createSession(t.models, seed.staff.waiter, tenantId, "person", NOW);
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, cookie = sid) =>
    t.inject({ method, url, cookies: { lodos_sid: cookie }, ...(payload ? { payload } : {}) });
  const cats = async () =>
    ((await call("GET", "/api/expense-categories")).json().categories as { id: string; name: { en: string; tr: string }; kind: string }[]);
  const cat = async (en: string) => (await cats()).find((c) => c.name.en === en)!;
  return { tenantId, call, wsid, cats, cat };
}

describe("seedExpenseCategories", () => {
  it("creates the 7 categories with budget 0, and twice adds nothing", async () => {
    const f = await fresh();
    await runWithTenant(f.tenantId, () => seedExpenseCategories(t.models));
    const cats = (await f.call("GET", "/api/expense-categories")).json().categories;
    expect(cats.map((c: { name: { en: string; tr: string } }) => `${c.name.en} / ${c.name.tr}`)).toEqual([
      "Suppliers – food / Tedarikçi – yiyecek",
      "Suppliers – drinks / Tedarikçi – içecek",
      "Rent / Kira",
      "Utilities / Faturalar",
      "Repairs and maintenance / Bakım ve onarım",
      "Marketing / Pazarlama",
      "Other / Diğer",
    ]);
    expect(cats.map((c: { kind: string }) => c.kind)).toEqual(["food_drink", "food_drink", "other", "other", "other", "other", "other"]);
    expect(cats.every((c: { monthlyBudget: number }) => c.monthlyBudget === 0)).toBe(true);
  });
});

describe("expenses", () => {
  it("creates, lists, updates and deletes; byCategory and totals add up; other months are excluded", async () => {
    const f = await fresh();
    const food = await f.cat("Suppliers – food");
    const rent = await f.cat("Rent");
    await f.call("PUT", `/api/expense-categories/${rent.id}`, { name: rent.name, kind: "other", monthlyBudget: 5_000_00 });
    const mk = async (categoryId: string, amount: number, date: string, extra: object = {}) => {
      const res = await f.call("POST", "/api/expenses", { categoryId, amount, date, ...extra });
      expect(res.statusCode, res.body).toBe(201);
      return res.json().id as string;
    };
    const a = await mk(food.id, 1_200_00, "2026-11-03", { payee: "Metro" });
    await mk(food.id, 300_50, "2026-11-10");
    await mk(rent.id, 4_000_00, "2026-11-01", { note: "Nov" });
    await mk(rent.id, 999_00, "2026-10-31");

    const view = (await f.call("GET", "/api/expenses?month=2026-11")).json();
    expect(view.expenses).toHaveLength(3);
    expect(view.expenses.map((e: { date: string }) => e.date)).toEqual(["2026-11-10", "2026-11-03", "2026-11-01"]);
    const row = (en: string) => view.byCategory.find((c: { name: { en: string } }) => c.name.en === en);
    expect(row("Suppliers – food")).toMatchObject({ kind: "food_drink", spent: 1_500_50, budget: 0 });
    expect(row("Rent")).toMatchObject({ spent: 4_000_00, budget: 5_000_00 });
    expect(view.total).toBe(5_500_50);
    expect(view.budgetTotal).toBe(5_000_00);

    const only = (await f.call("GET", `/api/expenses?month=2026-11&categoryId=${rent.id}`)).json();
    expect(only.expenses).toHaveLength(1);
    expect(only.total).toBe(5_500_50);
    // The default month is the app clock's.
    expect((await f.call("GET", "/api/expenses")).json().month).toBe("2026-11");

    expect((await f.call("PUT", `/api/expenses/${a}`, { categoryId: food.id, amount: 100_00, date: "2026-11-03", payee: null })).statusCode).toBe(200);
    expect((await f.call("GET", "/api/expenses?month=2026-11")).json().total).toBe(4_400_50);
    expect((await f.call("DELETE", `/api/expenses/${a}`)).statusCode).toBe(200);
    expect((await f.call("DELETE", `/api/expenses/${a}`)).statusCode).toBe(404);
    expect((await f.call("PUT", `/api/expenses/${a}`, { categoryId: food.id, amount: 1, date: "2026-11-03" })).statusCode).toBe(404);
    expect((await f.call("GET", "/api/expenses?month=2026-11")).json().total).toBe(4_300_50);

    const spend = await runWithTenant(f.tenantId, () => expensesForMonth(t.models, "2026-11"));
    expect(spend).toMatchObject({ foodDrink: 300_50, other: 4_000_00 });
  });

  it("rejects a future date (service-day compare), bad amounts and months, unknown or archived categories", async () => {
    const f = await fresh();
    const rent = await f.cat("Rent");
    const post = (b: object) => f.call("POST", "/api/expenses", { categoryId: rent.id, amount: 100, date: "2026-11-10", ...b });
    expect((await post({})).statusCode).toBe(201);
    expect((await post({ date: "2026-11-11" })).statusCode).toBe(400);
    expect((await post({ date: "2026-02-30" })).statusCode).toBe(400);
    for (const amount of [0, -5, 1.5]) expect((await post({ amount })).statusCode).toBe(400);
    expect((await post({ categoryId: "0".repeat(24) })).statusCode).toBe(404);
    expect((await f.call("GET", "/api/expenses?month=2026-13")).statusCode).toBe(400);
    // 04:00 Istanbul on Nov 11 is still service day Nov 10: the wall-clock date would be Nov 11.
    t.clock.set(new Date("2026-11-11T01:00:00Z"));
    expect((await post({ date: "2026-11-10" })).statusCode).toBe(201);
    expect((await post({ date: "2026-11-11" })).statusCode).toBe(400);
    t.clock.set(NOW);
    await f.call("PUT", `/api/expense-categories/${rent.id}`, { name: rent.name, kind: "other", monthlyBudget: 0, archived: true });
    expect((await post({})).statusCode).toBe(400);
  });

  it("exports CSV with a BOM, plain lira and the Turkish name quoted and formula-safe", async () => {
    const f = await fresh();
    const repairs = await f.cat("Repairs and maintenance");
    await f.call("POST", "/api/expenses", { categoryId: repairs.id, amount: 1_250_50, date: "2026-11-04", payee: "=cmd", note: 'said "hi", ok' });
    const res = await f.call("GET", "/api/expenses.csv?month=2026-11");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("lodos-expenses-2026-11.csv");
    expect(res.body.startsWith("﻿date,category_en")).toBe(true);
    expect(res.body.split("\r\n")[1]).toBe(
      `"2026-11-04","Repairs and maintenance","Bakım ve onarım","other",1250.50,"'=cmd","said ""hi"", ok"`,
    );
  });

  it("a waiter gets 403 on every endpoint, an anonymous caller 401", async () => {
    const f = await fresh();
    const rent = await f.cat("Rent");
    for (const [m, u, p] of [
      ["GET", "/api/expenses"],
      ["GET", "/api/expenses.csv"],
      ["POST", "/api/expenses", { categoryId: rent.id, amount: 1, date: "2026-11-10" }],
      ["PUT", `/api/expenses/${rent.id}`, { categoryId: rent.id, amount: 1, date: "2026-11-10" }],
      ["DELETE", `/api/expenses/${rent.id}`],
      ["GET", "/api/expense-categories"],
      ["POST", "/api/expense-categories", { name: rent.name, kind: "other", monthlyBudget: 0 }],
      ["PUT", `/api/expense-categories/${rent.id}`, { name: rent.name, kind: "other", monthlyBudget: 0 }],
    ] as const) {
      expect((await f.call(m, u, p, f.wsid)).statusCode, `${m} ${u}`).toBe(403);
      expect((await t.inject({ method: m, url: u })).statusCode, `anon ${m} ${u}`).toBe(401);
    }
  });
});

describe("expense categories", () => {
  it("creates, edits budget and name, archives (never deletes); an in-use category can't change kind", async () => {
    const f = await fresh();
    const res = await f.call("POST", "/api/expense-categories", { name: { en: "Music", tr: "Müzik" }, kind: "other", monthlyBudget: 750_00 });
    expect(res.statusCode).toBe(201);
    const cat = res.json().category;
    expect(cat).toMatchObject({ name: { en: "Music", tr: "Müzik" }, kind: "other", monthlyBudget: 750_00, archived: false });
    expect((await f.cats()).at(-1)!.name.en).toBe("Music");

    // Unused: kind may change.
    const k = await f.call("PUT", `/api/expense-categories/${cat.id}`, { name: cat.name, kind: "food_drink", monthlyBudget: 800_00 });
    expect(k.statusCode).toBe(200);
    expect(k.json().category).toMatchObject({ kind: "food_drink", monthlyBudget: 800_00 });

    await f.call("POST", "/api/expenses", { categoryId: cat.id, amount: 50_00, date: "2026-11-02" });
    const bad = await f.call("PUT", `/api/expense-categories/${cat.id}`, { name: cat.name, kind: "other", monthlyBudget: 800_00 });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe("conflict");
    // Name, budget and archive are still editable.
    const ar = await f.call("PUT", `/api/expense-categories/${cat.id}`, { name: { en: "Music!", tr: "Müzik!" }, kind: "food_drink", monthlyBudget: 0, archived: true });
    expect(ar.json().category).toMatchObject({ name: { en: "Music!" }, archived: true });

    // Archived with spending still shows in that month; archived without spending does not.
    const nov = (await f.call("GET", "/api/expenses?month=2026-11")).json();
    expect(nov.byCategory.some((c: { name: { en: string } }) => c.name.en === "Music!")).toBe(true);
    const dec = (await f.call("GET", "/api/expenses?month=2026-12")).json();
    expect(dec.byCategory.some((c: { name: { en: string } }) => c.name.en === "Music!")).toBe(false);
    expect((await f.call("DELETE", `/api/expense-categories/${cat.id}`)).statusCode).toBe(404);

    expect((await f.call("POST", "/api/expense-categories", { name: { en: "", tr: "x" }, kind: "other", monthlyBudget: 0 })).statusCode).toBe(400);
    expect((await f.call("POST", "/api/expense-categories", { name: cat.name, kind: "other", monthlyBudget: -1 })).statusCode).toBe(400);
    expect((await f.call("PUT", `/api/expense-categories/${"0".repeat(24)}`, { name: cat.name, kind: "other", monthlyBudget: 0 })).statusCode).toBe(404);
  });
});
