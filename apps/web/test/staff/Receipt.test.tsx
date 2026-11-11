import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { formatTRY } from "@lodos/shared";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { Receipt } from "../../src/staff/Receipt";
import type { ReceiptView } from "../../src/staff/floor/types";
import { err, mockFetch } from "./harness";

const n = (en: string, tr = en) => ({ en, tr });
const base: ReceiptView = {
  table: { id: "t4", name: "T4" },
  checkNo: "0427",
  serverName: "Mert",
  covers: 4,
  printedAt: "2026-11-10T20:20:00.000Z",
  openedAt: "2026-11-10T17:30:00.000Z",
  closedAt: "2026-11-10T20:14:00.000Z",
  share: null,
  lines: [
    { label: "", name: n("Dry-aged ribeye, 300 g"), options: [n("Medium rare", "Orta az pişmiş")], amount: 245000, comp: null },
    { label: "2 ×", name: n("Köz patlıcan, miso"), options: [], amount: 96000, comp: null },
    { label: "", name: n("Lodos Negroni"), options: [], amount: 0, comp: "celebration" },
  ],
  total: 341000,
  vat: [
    { rate: 10, amount: 24727 },
    { rate: 20, amount: 9167 },
  ],
  payment: { method: "card", amount: 341000, at: "2026-11-10T20:14:00.000Z", last4: "4821" },
  payments: [],
  comps: { count: 1, amount: 26000 },
  paid: true,
};

function setup(opts: { data?: Partial<ReceiptView>; url?: string; demo?: boolean; print?: () => void } = {}) {
  const print = opts.print ?? vi.fn();
  const url = opts.url ?? "/staff/check/c1/print";
  const api = url.includes("receipt") ? `GET /api/checks/c1/receipt${url.slice(url.indexOf("?")).replace("&noprint", "").replace("?noprint", "")}` : "GET /api/checks/c1/print";
  mockFetch({
    [api.replace(/\?$/, "")]: { ...base, ...opts.data },
    "GET /api/demo/info": opts.demo ? { guestUrl: "/t/x", simulatorOn: true } : err(404, "not_found"),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/staff/check/:id/print", element: <Receipt print={print} /> },
      { path: "/staff/check/:id/receipt", element: <Receipt print={print} /> },
    ],
    { initialEntries: [url] },
  );
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

describe("Receipt", () => {
  it("renders every field top to bottom, then calls print once", async () => {
    const print = setup({ data: { share: { label: "A", index: 0, of: 4 } }, url: "/staff/check/c1/receipt?share=A" });
    const doc = await screen.findByRole("article", { name: /Check T4/ });
    const text = (doc.textContent ?? "").replace(/\u00a0/g, " ");
    expect(within(doc).getByText("Lodos")).toBeTruthy();
    expect(text).toContain("Kemankeş Mah. · Karaköy, İstanbul");
    expect(text).toContain("T4 · Guest A of 4");
    expect(text).toContain("Check #0427");
    expect(text).toContain("10.11.2026");
    expect(text).toContain("23:14");
    expect(text).toContain("Mert");
    expect(text).toContain("Dry-aged ribeye, 300 g");
    expect(within(doc).getByText("Medium rare")).toBeTruthy();
    expect(text).toContain("2 ×");
    expect(within(doc).getByText("Comp · Birthday / celebration")).toBeTruthy();
    expect(within(doc).getByTestId("receipt-total").textContent).toContain(formatTRY(341000, "en"));
    expect(text).toContain("incl. KDV 10%");
    expect(text).toContain("incl. KDV 20%");
    expect(text).toContain(formatTRY(24727, "en"));
    expect(text).toContain("Card ····4821");
    expect(text).toContain("Comps on this check: 1 · " + formatTRY(26000, "en"));
    expect(print).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("prints the footer strings verbatim", async () => {
    setup();
    const doc = await screen.findByRole("article");
    expect(within(doc).getByText("Teşekkürler · Thank you")).toBeTruthy();
    expect(within(doc).getByText("Bilgi fişi — mali değeri yoktur / Not a fiscal receipt")).toBeTruthy();
  });

  it("reads the VAT label in Turkish with the UI in TR", async () => {
    await setLanguage("tr");
    setup();
    const doc = await screen.findByRole("article");
    expect(doc.textContent).toContain("KDV %10 dahil");
    expect(doc.textContent).toContain("KDV %20 dahil");
  });

  it("has no payment line before payment, and cash has no last four", async () => {
    setup({ data: { payment: null, paid: false } });
    const doc = await screen.findByRole("article");
    expect(doc.textContent).not.toMatch(/Card|Cash/);
    cleanup();
    setup({ data: { payment: { method: "cash", amount: 341000, at: base.printedAt, last4: null } } });
    const cash = await screen.findByRole("article");
    expect(cash.textContent).toContain("Cash");
    expect(cash.textContent).not.toContain("····");
  });

  it("an even share prints one line for the share (no check total), in the chosen language", async () => {
    const data: Partial<ReceiptView> = {
      share: { label: "B", index: 1, of: 4 },
      lines: [{ label: "", name: n("Guest B of 4 · check #0427", "Misafir B / 4 · hesap #0427"), options: [], amount: 120000, comp: null }],
      total: 120000,
      payment: { method: "cash", amount: 120000, at: base.printedAt, last4: null },
    };
    setup({ data, url: "/staff/check/c1/receipt?share=B" });
    const doc = await screen.findByRole("article");
    const items = within(doc).getAllByRole("listitem").filter((li) => li.closest("ul")?.className === "pc-lines");
    expect(items.map((li) => (li.textContent ?? "").replace(/\u00a0/g, " "))).toEqual([`Guest B of 4 · check #0427${formatTRY(120000, "en").replace(/\u00a0/g, " ")}`]);
    expect(doc.textContent).not.toContain(formatTRY(341000, "en"));
    cleanup();
    await setLanguage("tr");
    setup({ data, url: "/staff/check/c1/receipt?share=B" });
    expect((await screen.findByRole("article")).textContent).toContain("Misafir B / 4 · hesap #0427");
  });

  it("prints one payment line per share of a split-paid check", async () => {
    setup({
      data: {
        payment: null,
        payments: [
          { label: "A", method: "card", amount: 200000, last4: "4821" },
          { label: "B", method: "cash", amount: 141000, last4: null },
        ],
      },
    });
    const doc = await screen.findByRole("article");
    expect(doc.textContent).toContain("A · Card ····4821");
    expect(doc.textContent).toContain("B · Cash");
  });

  it("shows the demo notice only in demo mode", async () => {
    setup({ demo: true });
    const doc = await screen.findByRole("article");
    await vi.waitFor(() => expect(doc.textContent).toContain("Demo restaurant, not real"));
    cleanup();
    setup();
    const live = await screen.findByRole("article");
    await new Promise((r) => setTimeout(r, 50));
    expect(live.textContent).not.toContain("Demo restaurant");
  });

  it("never prints with ?noprint", async () => {
    const print = setup({ url: "/staff/check/c1/print?noprint" });
    await screen.findByRole("article");
    await new Promise((r) => setTimeout(r, 50));
    expect(print).not.toHaveBeenCalled();
  });

  it("links back to the table on the floor", async () => {
    setup();
    await screen.findByRole("article");
    expect(screen.getByRole("link", { name: /Back to floor/ }).getAttribute("href")).toBe("/staff/floor?table=t4");
  });
});
