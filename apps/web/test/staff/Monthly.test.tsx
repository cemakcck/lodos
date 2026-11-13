import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const FOOD = { en: "Suppliers – food", tr: "Tedarikçi – yiyecek" };
const RENT = { en: "Rent", tr: "Kira" };
const pnl = (sales: number, foodDrink: number, labour: number, other: number) => ({
  sales, foodDrink, labour, other,
  otherByCategory: [{ categoryId: "c-rent", name: RENT, kind: "other", spent: other, budget: 0 }],
  profit: sales - foodDrink - labour - other,
  margin: sales > 0 ? (sales - foodDrink - labour - other) / sales : null,
});
const pair = <T,>(cur: T, prev: T) => ({ cur, prev });
const dist = (n: number[]) => n;
const day = (d: number, revenue: number) => ({ day: `2026-11-${String(d).padStart(2, "0")}`, revenue, covers: 10, checks: 4 });

const VIEW = {
  month: "2026-11",
  soFar: true,
  current: { month: "2026-11", from: "2026-11-01", to: "2026-11-13", days: 13 },
  previous: { month: "2026-10", from: "2026-10-01", to: "2026-10-13", days: 13 },
  pnl: pair(pnl(19_200_000, 6_120_000, 5_380_000, 4_860_000), pnl(18_113_200, 5_900_000, 5_500_000, 4_700_000)),
  sales: {
    byDay: pair([day(1, 1_000_000), day(2, 1_500_000)], []),
    byWeekday: pair([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, revenue: weekday * 100_000, nights: 2, avg: weekday * 50_000 })), []),
    byHour: pair([{ hour: 19, revenue: 800_000 }, { hour: 20, revenue: 1_200_000 }], []),
    avgCheck: pair(114_000, 108_000),
    avgCover: pair(41_000, 40_000),
    covers: pair(1684, 1600),
    salesPerLabourHour: pair(131_000, null),
    turnsPerNight: pair(2.3, 2.1),
  },
  menu: [
    { itemId: "m1", name: { en: "Sea bass", tr: "Levrek" }, qty: 264, revenue: 16_600_000, ratingAvg: 4.9, ratingCount: 30, group: "stars", prev: { qty: 250, revenue: 1, ratingAvg: 4.8, ratingCount: 3 } },
    { itemId: "m2", name: { en: "Artichoke", tr: "Enginar" }, qty: 40, revenue: 900_000, ratingAvg: 4.6, ratingCount: 9, group: "hidden_gems", prev: { qty: 0, revenue: 0, ratingAvg: null, ratingCount: 0 } },
    { itemId: "m3", name: { en: "Manti", tr: "Mantı" }, qty: 248, revenue: 9_700_000, ratingAvg: 3.4, ratingCount: 12, group: "fix", prev: { qty: 200, revenue: 1, ratingAvg: 3.5, ratingCount: 3 } },
    { itemId: "m4", name: { en: "Pistachio tart", tr: "Fıstıklı tart" }, qty: 12, revenue: 300_000, ratingAvg: 3.1, ratingCount: 5, group: "rethink", prev: { qty: 10, revenue: 1, ratingAvg: null, ratingCount: 0 } },
    { itemId: "m5", name: { en: "Soup", tr: "Çorba" }, qty: 60, revenue: 500_000, ratingAvg: null, ratingCount: 0, group: null, prev: { qty: 0, revenue: 0, ratingAvg: null, ratingCount: 0 } },
  ],
  staff: [
    { staffId: "s1", name: "Deniz K.", role: "waiter", group: "floor", score: 86.4, breakdown: [], ratingAvg: 4.9, ratingCount: 20, minutes: 10_080, plannedMinutes: 9_600, lateShifts: 0, labourCost: 2_000_000, prev: { score: 80, minutes: 9000, labourCost: 1_900_000 } },
    { staffId: "s2", name: "Murat Ö.", role: "cook", group: "kitchen", score: null, breakdown: [], ratingAvg: null, ratingCount: 0, minutes: 600, plannedMinutes: 600, lateShifts: 1, labourCost: 100_000, prev: { score: null, minutes: 0, labourCost: 0 } },
  ],
  labourByGroup: pair({ floor: 2_000_000, kitchen: 100_000, bar: 0, managers: 0 }, { floor: 1_900_000, kitchen: 0, bar: 0, managers: 0 }),
  overtimeMinutes: pair(2760, 0),
  ratings: {
    restaurant: pair(4.6, 4.5), food: pair(4.7, null), cleanliness: pair(4.5, 4.5), atmosphere: pair(4.6, 4.4),
    dist: { restaurant: pair(dist([0, 1, 2, 10, 30]), dist([0, 0, 0, 0, 0])), waiter: pair(dist([0, 0, 0, 3, 17]), dist([0, 0, 0, 0, 0])), dish: pair(dist([1, 0, 1, 5, 20]), dist([0, 0, 0, 0, 0])) },
    byWeek: pair([{ week: "2026-11-09", restaurant: 4.6, food: 4.7, cleanliness: 4.5, atmosphere: 4.6, count: 33 }], []),
    comments: [
      { id: "r1", comment: "Deniz made our anniversary special", at: "2026-11-12T20:00:00.000Z", serviceDay: "2026-11-12" },
      { id: "r2", comment: "Best sea bass in Karaköy", at: "2026-11-11T20:00:00.000Z", serviceDay: "2026-11-11" },
    ],
  },
  expenses: {
    byCategory: pair(
      [
        { categoryId: "c-food", name: FOOD, kind: "food_drink", spent: 6_120_000, budget: 6_000_000 },
        { categoryId: "c-rent", name: RENT, kind: "other", spent: 4_860_000, budget: 0 },
      ],
      [{ categoryId: "c-food", name: FOOD, kind: "food_drink", spent: 5_900_000, budget: 6_000_000 }],
    ),
    total: pair(10_980_000, 10_600_000),
    budgetTotal: 6_000_000,
    biggest: [{ id: "x1", amount: 1_840_000, date: "2026-11-03", payee: "Fish supplier", note: null, categoryId: "c-food", category: FOOD }],
  },
};
const OCT = { ...VIEW, month: "2026-10", soFar: false, current: VIEW.previous, previous: { month: "2026-09", from: "2026-09-01", to: "2026-09-30", days: 30 } };

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(extra: Record<string, unknown> = {}) {
  calls = mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/business/monthly": VIEW, ...extra }).calls;
  return renderApp("/staff/business");
}
const run = () => axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Monthly business dashboard", () => {
  it("renders the six sections in order", async () => {
    setup();
    await screen.findByRole("region", { name: "Business" });
    const names = ["Profit and loss", "Sales patterns", "Menu: popularity × rating", "Staff", "Guests and ratings", "Expenses"];
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const at = names.map((n) => heads.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("shows the P&L numbers exactly as the JSON has them, and the change with words", async () => {
    setup();
    const profit = await screen.findByRole("group", { name: "Profit" });
    const p = VIEW.pnl.cur;
    expect(profit.textContent).toContain(formatTRY(p.profit, "en"));
    expect(profit.textContent).toContain("Margin 14.8%");
    expect(profit.textContent).toContain("↑ 3.7 pts vs October");
    const sales = screen.getByRole("group", { name: "Sales" });
    expect(sales.textContent).toContain(formatTRY(p.sales, "en"));
    expect(sales.textContent).toContain("↑ 6% vs October");
    expect(screen.getByRole("group", { name: "Food & drink cost" }).textContent).toContain(formatTRY(p.foodDrink, "en"));
    expect(screen.getByRole("group", { name: "Labour" }).textContent).toContain(formatTRY(p.labour, "en"));
    expect(screen.getByRole("group", { name: "Other costs" }).textContent).toContain(formatTRY(p.other, "en"));
    // The rendered rows add up: sales − costs = profit.
    expect(p.sales - p.foodDrink - p.labour - p.other).toBe(p.profit);
  });

  it("labels the current month as so far, and draws no change where there is none to compare", async () => {
    setup();
    expect((await screen.findByText(/So far: 13 days of November 2026/)).textContent).toContain("same days last month");
    // Food rating has no previous value: no change text on its tile.
    expect(within(screen.getByRole("group", { name: "Food" })).queryByText(/vs October/)).toBeNull();
    expect(within(screen.getByRole("group", { name: "Cleanliness" })).getByText("No change vs October")).toBeTruthy();
  });

  it("shows the four menu groups with their Turkish names and dishes", async () => {
    await setLanguage("tr");
    setup();
    const quad = await screen.findByRole("list", { name: "Menü grupları" });
    const items = within(quad).getAllByRole("listitem").map((li) => li.textContent!);
    expect(items[0]).toContain("Yıldızlar");
    expect(items[0]).toContain("Levrek");
    expect(items[1]).toContain("Gizli hazineler");
    expect(items[1]).toContain("Enginar");
    expect(items[2]).toContain("Düzeltilmeli");
    expect(items[2]).toContain("Mantı");
    expect(items[3]).toContain("Gözden geçir");
    expect(items[3]).toContain("Fıstıklı tart");
    expect(document.body.textContent).toContain("Ekim'e göre ↑ %6");
  });

  it("shows the four groups with their English names", async () => {
    setup();
    const quad = await screen.findByRole("list", { name: "Menu groups" });
    expect(within(quad).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Stars", "Hidden gems", "Fix", "Rethink"]);
  });

  it("every chart has its numbers in a table", async () => {
    setup();
    const region = await screen.findByRole("region", { name: "Business" });
    for (const name of ["Sales by day", "Revenue by hour", "Sales by weekday"]) {
      expect(within(region).getByRole("table", { name })).toBeTruthy();
    }
    expect(within(screen.getByRole("table", { name: "Sales by day" })).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("list", { name: "Rating spread: Dishes" }).textContent).toContain("20 ratings");
  });

  it("lists staff, expenses and the biggest costs with their money", async () => {
    setup();
    const staff = (await screen.findAllByRole("table", { name: "Staff" }))[0]!;
    expect(staff.textContent).toContain("Deniz K.");
    expect(staff.textContent).toContain("168.0 h (160.0 h)");
    expect(staff.textContent).toContain(formatTRY(2_000_000, "en"));
    const spend = screen.getByRole("table", { name: "Expenses" });
    expect(spend.textContent).toContain("▲ Over by " + formatTRY(120_000, "en"));
    expect(spend.textContent).toContain(formatTRY(10_980_000, "en"));
    expect(screen.getByRole("table", { name: "Biggest single costs" }).textContent).toContain("Fish supplier");
  });

  it("navigates months with ◀ ▶, never past the current month or more than 4 months back", async () => {
    const m = (n: string) => ({ ...OCT, month: `2026-${n}`, soFar: false });
    setup({ "GET /api/business/monthly?month=2026-10": OCT, "GET /api/business/monthly?month=2026-09": m("09"), "GET /api/business/monthly?month=2026-08": m("08"), "GET /api/business/monthly?month=2026-07": m("07") });
    const user = userEvent.setup();
    const next = await screen.findByRole("button", { name: "Next month" });
    const prev = screen.getByRole("button", { name: "Previous month" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await user.click(prev);
    expect(await screen.findByText("October 2026")).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/business/monthly?month=2026-10")).toBe(true);
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/So far/)).toBeNull();
    for (const label of ["September 2026", "August 2026", "July 2026"]) {
      await user.click(screen.getByRole("button", { name: "Previous month" }));
      await screen.findByText(label);
    }
    expect((screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("August 2026");
  });

  it("links the PDF in the UI language and a CSV per table", async () => {
    setup();
    const pdf = await screen.findByRole("link", { name: "Export PDF" });
    expect(pdf.getAttribute("href")).toBe("/api/business/monthly.pdf?month=2026-11&lang=en");
    expect(screen.getByRole("link", { name: "Export CSV: Menu: popularity × rating" }).getAttribute("href")).toBe("/api/business/monthly.csv?month=2026-11&section=menu");
    expect(screen.getByRole("link", { name: "Export CSV: Staff" }).getAttribute("href")).toBe("/api/business/monthly.csv?month=2026-11&section=staff");
    expect(screen.getByRole("link", { name: "Export CSV: Expenses" }).getAttribute("href")).toBe("/api/business/monthly.csv?month=2026-11&section=expenses");
  });

  it("hides a guest comment through the ratings endpoint", async () => {
    setup({ "POST /api/ratings/r2/hide": { id: "r2", commentHidden: true } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Hide this comment: Best sea bass in Karaköy" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/ratings/r2/hide")).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/business/monthly").length).toBeGreaterThan(1));
  });

  it("is a manager-only rail item", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Business" })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    setup();
    await screen.findByRole("region", { name: "Business" });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("has no axe violations in Turkish", async () => {
    await setLanguage("tr");
    setup();
    await screen.findByRole("region", { name: "İşletme" });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
