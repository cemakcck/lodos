import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor, act } from "@testing-library/react";
import axe from "axe-core";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const name = (en: string, tr = en) => ({ en, tr });
const row = (staffId: string, n: string, role: string, ratingAvg: number | null, score: number) => ({
  staffId, name: n, role, score, breakdown: [], ratingAvg, ratingCount: 9, minutes: 0, plannedMinutes: 0, lateShifts: 0,
});

const VIEW = {
  today: { sales: 4_862_000, salesPrev: 4_460_000, covers: 112, coversPrev: 108 },
  rating7d: { restaurant: 4.6, prev: 4.5 },
  month: {
    sales: 19_200_000, foodDrink: 6_120_000, labour: 5_380_000, other: 4_860_000, otherByCategory: [],
    profit: 2_840_000, margin: 0.148, budgetTotal: 32_000_000, expensesTotal: 10_980_000,
  },
  monthKey: "2026-11",
  // October 1 … 14: sales 17.6M, food 30% of sales, labour 28%, margin 17%.
  monthPrev: {
    sales: 17_600_000, foodDrink: 5_280_000, labour: 4_928_000, other: 4_400_000, otherByCategory: [],
    profit: 2_992_000, margin: 0.17,
  },
  working: [
    { staffId: "w1", name: "Deniz K.", role: "waiter", status: "on_shift", in: "2026-11-14T07:58:00.000Z", shift: { start: "2026-11-14T08:00:00.000Z", end: "2026-11-14T16:00:00.000Z" } },
    { staffId: "w2", name: "Selin A.", role: "waiter", status: "late", lateMin: 18, in: "2026-11-14T08:18:00.000Z", shift: { start: "2026-11-14T08:00:00.000Z", end: "2026-11-14T16:00:00.000Z" } },
    { staffId: "w3", name: "Ece T.", role: "bartender", status: "later", shift: { start: "2026-11-14T14:00:00.000Z", end: "2026-11-14T22:00:00.000Z" } },
  ],
  topStaff: { floor: [row("w1", "Deniz K.", "waiter", 4.9, 86.4), row("w2", "Selin A.", "waiter", 4.5, 71)], kitchen: [], bar: [] },
  expenses: {
    total: 30_100_000, budget: 32_000_000,
    latest: [{ id: "e1", amount: 1_840_000, date: "2026-11-13", payee: "Fish supplier", note: null, category: name("Suppliers – food", "Tedarikçi – yiyecek") }],
  },
  dishes: {
    best: [{ itemId: "m1", name: name("Sea bass", "Levrek"), avg: 4.9, count: 30 }],
    needsWork: [{ itemId: "m3", name: name("Manti", "Mantı"), avg: 3.4, count: 12 }],
  },
};

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(path = "/staff/overview") {
  calls = mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/business/overview": VIEW }).calls;
  return renderApp(path);
}
const run = () => axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
const fetches = () => calls.filter((c) => c.path === "/api/business/overview").length;

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Manager overview", () => {
  it("shows the late pill with the minutes, in English and in Turkish", async () => {
    setup();
    expect(await screen.findByText("18 min late")).toBeTruthy();
    cleanup();
    await setLanguage("tr");
    setup();
    expect(await screen.findByText("18 dk geç")).toBeTruthy();
  });

  it("shows today's numbers, who is working, the ranking, expenses and dishes", async () => {
    setup();
    const sales = await screen.findByRole("group", { name: "Sales today" });
    expect(sales.textContent).toContain(formatTRY(VIEW.today.sales, "en"));
    expect(sales.textContent).toContain("↑ 9% vs same time last week");
    expect(screen.getByRole("group", { name: "Profit this month" }).textContent).toContain("Margin 14.8%");
    const working = screen.getByRole("table", { name: "Who's working now" });
    expect(within(working).getByText("on shift")).toBeTruthy();
    expect(within(working).getByText("later today")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Floor ranking" }).textContent).toContain("86.4 pts");
    expect(screen.getByText(/of .* budget/).textContent).toContain(formatTRY(32_000_000, "en"));
    expect(screen.getByRole("list", { name: "Latest expenses" }).textContent).toContain("Fish supplier");
    expect(screen.getByText("Manti (needs work)")).toBeTruthy();
  });

  it("titles the ranking card with the rolling 7 days, in English and in Turkish", async () => {
    setup();
    expect(await screen.findByText("Top staff · last 7 days")).toBeTruthy();
    cleanup();
    await setLanguage("tr");
    setup();
    expect(await screen.findByText("En iyiler · son 7 gün")).toBeTruthy();
  });

  it("links the month strip to the business page", async () => {
    setup();
    const link = await screen.findByRole("link", { name: /This month at a glance/ });
    expect(link.getAttribute("href")).toBe("/staff/business");
    expect(link.textContent).toContain(formatTRY(VIEW.month.profit, "en"));
  });

  it("the month strip: so far, sales, profit and margin, food and labour as % of sales, expenses vs budget, each against last month", async () => {
    setup();
    const link = await screen.findByRole("link", { name: /This month at a glance/ });
    const item = (label: string) => within(link).getByText(label).closest("div")!.textContent;
    expect(link.textContent).toContain("So far, compared with the same days last month");
    expect(item("Sales")).toContain(formatTRY(19_200_000, "en"));
    expect(item("Sales")).toContain("↑ 9.1% vs October");
    expect(item("Profit")).toContain(formatTRY(2_840_000, "en"));
    expect(item("Profit")).toContain("Margin 14.8%");
    expect(item("Profit")).toContain("↓ 2.2 pts vs October");
    expect(item("Food & drink cost")).toContain("31.9% of sales");
    expect(item("Food & drink cost")).toContain("↑ 1.9 pts vs October");
    expect(item("Labour")).toContain("28% of sales");
    expect(item("Labour")).toContain("No change vs October");
    expect(item("Expenses vs budget")).toContain(`${formatTRY(10_980_000, "en")} of ${formatTRY(32_000_000, "en")}`);
    expect(item("Expenses vs budget")).toContain("↑ 13.4% vs October");
  });

  it("Review Focus 5: on the 1st at 08:00 with no sales the strip shows — for ratios and no change where last month had none", async () => {
    const zero = { sales: 0, foodDrink: 0, labour: 0, other: 0, otherByCategory: [], profit: 0, margin: null };
    calls = mockFetch({
      "GET /api/auth/me": staffOf("manager"),
      "GET /api/business/overview": {
        ...VIEW, today: { sales: 0, salesPrev: 0, covers: 0, coversPrev: 0 }, rating7d: { restaurant: null, prev: null },
        monthKey: "2026-12", month: { ...zero, budgetTotal: 0, expensesTotal: 0 }, monthPrev: { ...zero, other: 500_000, profit: -500_000 },
        working: [], topStaff: { floor: [], kitchen: [], bar: [] }, expenses: { total: 0, budget: 0, latest: [] }, dishes: { best: [], needsWork: [] },
      },
    }).calls;
    renderApp("/staff/overview");
    const link = await screen.findByRole("link", { name: /This month at a glance/ });
    const item = (label: string) => within(link).getByText(label).closest("div")!.textContent!;
    expect(item("Profit")).toContain("Margin —");
    expect(item("Food & drink cost")).toContain("—");
    expect(item("Labour")).toContain("—");
    // Nothing to compare sales or ratios with; last month's rent on the 1st still reads as a change in expenses.
    for (const label of ["Sales", "Profit", "Food & drink cost", "Labour"]) expect(item(label), label).not.toMatch(/[↑↓]|change/);
    expect(item("Expenses vs budget")).toContain("↓ 100% vs November");
  });

  it("refetches on clock.changed, rating.created, expense.changed and check.updated", async () => {
    setup();
    await screen.findByText("18 min late");
    let n = fetches();
    for (const type of ["clock.changed", "rating.created", "expense.changed", "check.updated"]) {
      act(() => sockets.at(-1)!.emit("event", { type, ids: ["x"], tableId: type === "check.updated" ? "t1" : undefined }));
      await waitFor(() => expect(fetches()).toBeGreaterThan(n));
      n = fetches();
    }
  });

  it("is the manager's landing page and first rail item", async () => {
    const { router } = setup("/staff");
    await screen.findByRole("region", { name: "Overview" });
    expect(router.state.location.pathname).toBe("/staff/overview");
    const links = within(screen.getByRole("navigation", { name: "Staff" })).getAllByRole("link");
    expect(links[0]!.getAttribute("aria-label")).toBe("Overview");
  });

  it("has no axe violations", async () => {
    setup();
    await screen.findByRole("region", { name: "Overview" });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it("has no axe violations in Turkish", async () => {
    await setLanguage("tr");
    setup();
    await screen.findByRole("region", { name: "Genel bakış" });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
