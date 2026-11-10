import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { formatTRY } from "@lodos/shared";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { PrintCheck } from "../../src/staff/PrintCheck";
import type { CheckPrint } from "../../src/staff/floor/types";
import { mockFetch } from "./harness";

const n = (en: string, tr = en) => ({ en, tr });
const data: CheckPrint = {
  table: { id: "t12", name: "T12" },
  check: {
    id: "c1", status: "paid", paid: true, covers: 4, openedAt: "2026-11-10T17:30:00.000Z", closedAt: "2026-11-10T18:42:00.000Z",
    serverName: "Deniz", payment: { method: "card", amount: 409000, at: "2026-11-10T18:42:00.000Z" },
  },
  food: [
    { orderId: "o1", ticketId: "k", qty: 1, name: n("Dry-aged ribeye, 300 g"), options: [n("Medium rare")], note: null, seat: null, status: "served", lineTotal: 245000 },
    { orderId: "o1", ticketId: "k", qty: 2, name: n("Köz patlıcan, miso"), options: [], note: null, seat: null, status: "served", lineTotal: 96000 },
  ],
  drinks: [{ orderId: "o1", ticketId: "b", qty: 1, name: n("Lodos Negroni"), options: [], note: null, seat: null, status: "served", lineTotal: 68000 }],
  totals: { food: 341000, drinks: 68000, total: 409000 },
};

function setup(print = vi.fn()) {
  mockFetch({ "GET /api/checks/c1/print": data });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/staff/check/:id/print", element: <PrintCheck print={print} /> }], {
    initialEntries: ["/staff/check/c1/print"],
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return print;
}

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("PrintCheck", () => {
  it("prints the wordmark, table, date and time, lines, subtotals, total and the VAT line, then calls print once", async () => {
    const print = setup();
    const doc = await screen.findByRole("article", { name: /Check T12/ });
    expect(within(doc).getByText("Lodos")).toBeTruthy();
    expect(within(doc).getByText("T12")).toBeTruthy();
    expect(doc.textContent).toContain("10.11.2026");
    expect(doc.textContent).toContain("21:42");
    expect(within(doc).getAllByRole("listitem")).toHaveLength(3);
    expect(within(doc).getByTestId("sub-food").textContent).toContain(formatTRY(341000, "en"));
    expect(within(doc).getByTestId("sub-drinks").textContent).toContain(formatTRY(68000, "en"));
    expect(within(doc).getByTestId("print-total").textContent).toContain(formatTRY(409000, "en"));
    expect(doc.textContent).toContain("KDV dahil / VAT included");
    expect(doc.textContent).toContain("Paid by card");
    expect(print).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
