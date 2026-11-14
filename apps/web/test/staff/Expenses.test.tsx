import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const CATS = [
  { id: "c-food", name: { en: "Suppliers – food", tr: "Tedarikçi – yiyecek" }, kind: "food_drink", monthlyBudget: 5_000_000, archived: false },
  { id: "c-rent", name: { en: "Rent", tr: "Kira" }, kind: "other", monthlyBudget: 4_000_000, archived: false },
  { id: "c-mkt", name: { en: "Marketing", tr: "Pazarlama" }, kind: "other", monthlyBudget: 0, archived: false },
  { id: "c-old", name: { en: "Old supplier", tr: "Eski tedarikçi" }, kind: "other", monthlyBudget: 0, archived: true },
];
const VIEW = {
  month: "2026-11",
  expenses: [
    { id: "x2", categoryId: "c-food", amount: 640_050, date: "2026-11-12", payee: "Anadolu Gıda", note: "Weekly produce" },
    { id: "x1", categoryId: "c-rent", amount: 3_500_000, date: "2026-11-01", payee: null, note: null },
  ],
  byCategory: [
    { categoryId: "c-food", name: CATS[0]!.name, kind: "food_drink", spent: 5_640_050, budget: 5_000_000 },
    { categoryId: "c-rent", name: CATS[1]!.name, kind: "other", spent: 3_500_000, budget: 4_000_000 },
    { categoryId: "c-mkt", name: CATS[2]!.name, kind: "other", spent: 120_000, budget: 0 },
  ],
  total: 9_260_050,
  budgetTotal: 9_000_000,
};

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(extra: Record<string, unknown> = {}) {
  calls = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/expenses": VIEW,
    "GET /api/expense-categories": { categories: CATS },
    ...extra,
  }).calls;
  return renderApp("/staff/expenses");
}

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Expenses", () => {
  it("shows spend against budget per category with visible numbers, flagging over-budget in text", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Spending against budget" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Suppliers – food");
    expect(rows[0]!.textContent).toContain(formatTRY(5_640_050, "en"));
    expect(rows[0]!.textContent).toContain(formatTRY(5_000_000, "en"));
    expect(rows[0]!.textContent).toContain("Over budget by " + formatTRY(640_050, "en"));
    expect(rows[1]!.textContent).not.toContain("Over budget");
    expect(rows[1]!.textContent).toContain("Under by " + formatTRY(500_000, "en"));
    expect(rows[2]!.textContent).toContain("No budget");
    expect(rows[2]!.textContent).not.toContain("Over budget");
    expect(document.body.textContent).toContain(formatTRY(9_260_050, "en"));
  });

  it("lists the expenses and filters them by category", async () => {
    setup({
      "GET /api/expenses?month=2026-11&categoryId=c-rent": { ...VIEW, expenses: [VIEW.expenses[1]] },
    });
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "Expenses" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(table.textContent).toContain("Anadolu Gıda");
    await user.selectOptions(screen.getByLabelText("Category"), "c-rent");
    await waitFor(() => expect(calls.some((c) => c.path === "/api/expenses?month=2026-11&categoryId=c-rent")).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Expenses" })).getAllByRole("row")).toHaveLength(2));
  });

  it("the month picker asks for the previous month", async () => {
    setup({ "GET /api/expenses?month=2026-10": { ...VIEW, month: "2026-10", expenses: [], byCategory: [], total: 0, budgetTotal: 0 } });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/expenses?month=2026-10")).toBe(true));
    expect(await screen.findByText("No expenses this month.")).toBeTruthy();
  });

  it("adding an expense posts the amount in kuruş", async () => {
    setup({ "POST /api/expenses": () => ({ status: 201, body: { id: "x3" } }) });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add expense" });
    // Archived categories can't be picked.
    expect(within(dialog).queryByRole("option", { name: "Old supplier" })).toBeNull();
    await user.type(within(dialog).getByLabelText("Amount (₺)"), "1.640,50");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "c-rent");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-11-10" } });
    await user.type(within(dialog).getByLabelText("Payee"), "Landlord");
    await user.type(within(dialog).getByLabelText("Note"), "November");
    await user.click(within(dialog).getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      categoryId: "c-rent",
      amount: 164_050,
      date: "2026-11-10",
      payee: "Landlord",
      note: "November",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses a bad amount before posting", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Amount (₺)"), "abc");
    await user.click(within(dialog).getByRole("button", { name: "Save expense" }));
    expect(within(dialog).getByText("Enter an amount above zero.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("edits an expense with PUT and deletes it after a confirmation", async () => {
    setup({ "PUT /api/expenses/x1": { ok: true }, "DELETE /api/expenses/x1": { ok: true } });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: /Edit expense Rent/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit expense" });
    expect((within(dialog).getByLabelText("Amount (₺)") as HTMLInputElement).value).toBe("35000");
    await user.clear(within(dialog).getByLabelText("Amount (₺)"));
    await user.type(within(dialog).getByLabelText("Amount (₺)"), "36000");
    await user.click(within(dialog).getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ categoryId: "c-rent", amount: 3_600_000, date: "2026-11-01" });

    await user.click(await screen.findByRole("button", { name: /Edit expense Rent/ }));
    const again = screen.getByRole("dialog", { name: "Edit expense" });
    await user.click(within(again).getByRole("button", { name: "Delete expense" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(within(again).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("links the CSV export to the shown month and category", async () => {
    setup();
    const user = userEvent.setup();
    const link = await screen.findByRole("link", { name: "Export CSV" });
    expect(link.getAttribute("href")).toBe("/api/expenses.csv?month=2026-11");
    expect(link.hasAttribute("download")).toBe(true);
    await user.selectOptions(screen.getByLabelText("Category"), "c-rent");
    expect(link.getAttribute("href")).toBe("/api/expenses.csv?month=2026-11&categoryId=c-rent");
  });

  it("the Categories dialog adds a category and edits one, budget in kuruş", async () => {
    setup({
      "POST /api/expense-categories": () => ({ status: 201, body: { category: { ...CATS[2], id: "c-new" } } }),
      "PUT /api/expense-categories/c-rent": () => ({ status: 200, body: { category: CATS[1] } }),
    });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: "Categories" }));
    const dialog = await screen.findByRole("dialog", { name: "Categories" });
    expect(within(dialog).getByText("Old supplier")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "New category" }));
    await user.type(within(dialog).getByLabelText("Name (English)"), "Insurance");
    await user.type(within(dialog).getByLabelText("Name (Turkish)"), "Sigorta");
    await user.type(within(dialog).getByLabelText("Monthly budget (₺)"), "1500,50");
    await user.click(within(dialog).getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      name: { en: "Insurance", tr: "Sigorta" },
      kind: "other",
      monthlyBudget: 150_050,
    });

    await user.click(await within(dialog).findByRole("button", { name: "Edit Rent" }));
    await user.clear(within(dialog).getByLabelText("Monthly budget (₺)"));
    await user.type(within(dialog).getByLabelText("Monthly budget (₺)"), "42000");
    await user.click(within(dialog).getByLabelText("Archived"));
    await user.click(within(dialog).getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      name: { en: "Rent", tr: "Kira" },
      kind: "other",
      monthlyBudget: 4_200_000,
      archived: true,
    });
  });

  it("explains a kind change refused with 409", async () => {
    setup({ "PUT /api/expense-categories/c-rent": () => ({ status: 409, body: { error: { code: "conflict", message: "x" } } }) });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    await user.click(screen.getByRole("button", { name: "Categories" }));
    const dialog = await screen.findByRole("dialog", { name: "Categories" });
    await user.click(within(dialog).getByRole("button", { name: "Edit Rent" }));
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "food_drink");
    await user.click(within(dialog).getByRole("button", { name: "Save category" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("already has expenses");
  });

  it("refetches when expense.changed arrives", async () => {
    setup();
    await screen.findByRole("table", { name: "Expenses" });
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    const before = calls.filter((c) => c.path === "/api/expenses").length;
    act(() => sockets[0]!.emit("event", { type: "expense.changed", ids: ["x1"] }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/expenses").length).toBeGreaterThan(before));
  });

  it("reads in Turkish", async () => {
    await setLanguage("tr");
    setup();
    expect(await screen.findByRole("heading", { name: "Giderler" })).toBeTruthy();
    expect((await screen.findByRole("list", { name: "Bütçeye karşı harcama" })).textContent).toContain("Bütçe aşıldı");
    expect(screen.getByRole("button", { name: "Gider ekle" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CSV indir" })).toBeTruthy();
  });

  it("is a manager-only rail item", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Expenses" })).toBeTruthy();
  });

  it("has no axe violations, with the dialogs open", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Expenses" });
    const run = () => axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await screen.findByRole("dialog");
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Categories" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Edit Rent" }));
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
