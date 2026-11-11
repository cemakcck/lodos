import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useParams } from "react-router";
import { formatTRY } from "@lodos/shared";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { TableDetail } from "../../src/staff/floor/TableDetail";
import type { CheckLine, TableCheck } from "../../src/staff/floor/types";
import { err, mockFetch } from "./harness";

const NOW = new Date("2026-11-10T18:42:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const n = (en: string, tr = en) => ({ en, tr });
const line = (over: Partial<CheckLine>): CheckLine => ({
  orderId: "o1", ticketId: "tk-food", qty: 1, name: n("Dish"), options: [], note: null, seat: null, status: "preparing", lineTotal: 0, ...over,
});

const ribeye = line({ name: n("Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g"), options: [n("Medium rare", "Orta az pişmiş")], status: "ready", lineTotal: 245000 });
const aubergine = line({ qty: 2, name: n("Köz patlıcan, miso"), status: "ready", lineTotal: 96000, seat: 2 });
const negroni = line({ ticketId: "tk-bar", name: n("Lodos Negroni"), status: "served", lineTotal: 68000 });

const TABLE = { id: "t12", name: "T12", capacity: 4, sectionStaffId: "id-waiter" };
const open = (over: Partial<Extract<TableCheck, { check: object }>> = {}): TableCheck => ({
  table: TABLE,
  calls: [],
  check: { id: "c1", covers: 4, openedAt: ago(72), serverStaffId: "id-waiter", serverName: "Deniz Kaya", billRequestedAt: null, billMethod: null },
  food: [ribeye, aubergine],
  drinks: [negroni],
  totals: { food: 341000, drinks: 68000, total: 409000 },
  ...over,
});
const free: TableCheck = { table: TABLE, calls: [], check: null };

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(routes: Record<string, unknown>) {
  calls = mockFetch(routes).calls;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Order() {
    return <p>order entry {useParams().tableId}</p>;
  }
  function Close() {
    return <p>close view {useParams().id}</p>;
  }
  const router = createMemoryRouter(
    [
      { path: "/staff/floor", element: <TableDetail tableId="t12" now={NOW} /> },
      { path: "/staff/order/:tableId", element: <Order /> },
      { path: "/staff/check/:id/print", element: <p>print page</p> },
      { path: "/staff/check/:id/close", element: <Close /> },
    ],
    { initialEntries: ["/staff/floor"] },
  );
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { qc, router };
}

/** Holds fetches whose path includes `match` until released. */
function gateFetch(match: string) {
  const inner = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(match)) await gate;
    return inner(input, init);
  });
  return () => release();
}

const panel = () => screen.findByRole("region", { name: /T12/ });
const lineRow = (name: RegExp) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("TableDetail", () => {
  it("shows Food and Drinks with lines, statuses, subtotals and the open check total in TRY", async () => {
    setup({ "GET /api/tables/t12/check": open() });
    const region = await panel();
    expect(within(region).getByRole("heading", { level: 2 }).textContent).toBe("T12");
    expect(within(region).getByText("Food ready", { selector: ".fl-pill" })).toBeTruthy();
    expect(within(region).getByLabelText("Server Deniz Kaya").textContent).toBe("DK");

    const food = within(region).getByRole("group", { name: "Food" });
    const drinks = within(region).getByRole("group", { name: "Drinks" });
    expect(within(food).getAllByRole("listitem")).toHaveLength(2);
    expect(within(drinks).getAllByRole("listitem")).toHaveLength(1);
    expect(within(food).getByTestId("subtotal").textContent).toContain(formatTRY(341000, "en"));
    expect(within(drinks).getByTestId("subtotal").textContent).toContain(formatTRY(68000, "en"));
    expect(within(region).getByTestId("total").textContent).toContain(formatTRY(409000, "en"));
    // Key values: covers, seated time, check.
    expect(within(region).getByTestId("kv-covers").textContent).toContain("4");
    expect(within(region).getByTestId("kv-seated").textContent).toContain("1h 12m");
    expect(within(region).getByTestId("kv-check").textContent).toContain(formatTRY(409000, "en"));
    // Line detail: qty, name with the unit kept together, option, seat, status and price.
    const rib = lineRow(/Dry-aged ribeye/);
    expect(rib.textContent).toContain("300 g");
    expect(rib.textContent).toContain("Medium rare");
    expect(rib.textContent).toContain("Ready");
    expect(rib.textContent).toContain(formatTRY(245000, "en"));
    expect(lineRow(/Köz patlıcan/).textContent).toContain("Seat 2");
    expect(lineRow(/Negroni/).textContent).toContain("Served");
    // No courses anywhere.
    expect(region.textContent).not.toMatch(/course|fire/i);
  });

  it("Close check opens the close view for the check", async () => {
    const { router } = setup({ "GET /api/tables/t12/check": open() });
    const region = await panel();
    await userEvent.click(within(region).getByRole("button", { name: "Close check" }));
    expect(await screen.findByText("close view c1")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/staff/check/c1/close");
  });

  it("Mark picked up is optimistic, one per ready ticket, and rolls back on error", async () => {
    setup({
      "GET /api/tables/t12/check": open(),
      "POST /api/tickets/tk-food/served": err(409, "conflict"),
    });
    const region = await panel();
    const buttons = within(region).getAllByRole("button", { name: /^Mark picked up/ });
    expect(buttons).toHaveLength(1); // two ready lines, one ticket
    const release = gateFetch("/served");
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(lineRow(/Dry-aged ribeye/).textContent).toContain("Served"));
    expect(within(region).queryByRole("button", { name: /^Mark picked up/ })).toBeNull();
    // Hold the refetch, so only the rollback can bring "Ready" back.
    gateFetch("/api/tables/t12/check");
    release();
    await waitFor(() => expect(within(region).getByRole("status").textContent).toMatch(/didn't go through|changed/));
    expect(lineRow(/Dry-aged ribeye/).textContent).toContain("Ready");
  });

  it("Answer call is optimistic and posts every open call", async () => {
    const calling = open({ calls: [{ id: "call1", reason: "wine", openedAt: ago(1) }] });
    setup({
      "GET /api/tables/t12/check": calling,
      "POST /api/calls/call1/answer": { call: { id: "call1" } },
    });
    const region = await panel();
    expect(within(region).getByText("Calling", { selector: ".fl-pill" })).toBeTruthy();
    const release = gateFetch("/answer");
    await userEvent.click(within(region).getByRole("button", { name: /Answer call/ }));
    await waitFor(() => expect(within(region).queryByRole("button", { name: /Answer call/ })).toBeNull());
    expect(within(region).getByText("Food ready", { selector: ".fl-pill" })).toBeTruthy();
    release();
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/calls/call1/answer")).toBe(true));
  });

  it("Answer call rolls back on error", async () => {
    setup({
      "GET /api/tables/t12/check": open({ calls: [{ id: "call1", reason: "wine", openedAt: ago(1) }] }),
      "POST /api/calls/call1/answer": err(500, "internal"),
    });
    const region = await panel();
    const release = gateFetch("/answer");
    await userEvent.click(within(region).getByRole("button", { name: /Answer call/ }));
    await waitFor(() => expect(within(region).queryByRole("button", { name: /Answer call/ })).toBeNull());
    gateFetch("/api/tables/t12/check");
    release();
    await waitFor(() => expect(within(region).getByRole("button", { name: /Answer call/ })).toBeTruthy());
    expect(within(region).getByText("Calling", { selector: ".fl-pill" })).toBeTruthy();
    expect(within(region).getByRole("status").textContent).not.toBe("");
  });

  it("a free table seats through the covers dialog (1 to 20)", async () => {
    setup({
      "GET /api/tables/t12/check": free,
      "POST /api/tables/t12/seat": { checkId: "c9", tableId: "t12", covers: 3, opened: true },
    });
    const region = await panel();
    expect(within(region).getByText("Free", { selector: ".fl-pill" })).toBeTruthy();
    expect(within(region).queryByRole("button", { name: "Close check" })).toBeNull();
    await userEvent.click(within(region).getByRole("button", { name: "Seat table" }));
    const dialog = screen.getByRole("dialog", { name: "Seat T12" });
    const fewer = within(dialog).getByRole("button", { name: "Fewer covers" });
    const more = within(dialog).getByRole("button", { name: "More covers" });
    // Starts at the table's capacity (4).
    expect(within(dialog).getByTestId("covers").textContent).toBe("4");
    await userEvent.click(fewer);
    expect(within(dialog).getByTestId("covers").textContent).toBe("3");
    for (let i = 0; i < 5; i++) await userEvent.click(fewer);
    expect(within(dialog).getByTestId("covers").textContent).toBe("1");
    expect((fewer as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 25; i++) if (!(more as HTMLButtonElement).disabled) await userEvent.click(more);
    expect(within(dialog).getByTestId("covers").textContent).toBe("20");
    for (let i = 0; i < 17; i++) await userEvent.click(fewer);
    await userEvent.click(within(dialog).getByRole("button", { name: "Seat 3 covers" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.path === "/api/tables/t12/seat")?.body).toEqual({ covers: 3 });
  });

  it("a QR-opened check without covers reads Set covers", async () => {
    setup({
      "GET /api/tables/t12/check": open({ check: { ...(open() as { check: object }).check, covers: null } as never }),
      "POST /api/tables/t12/seat": { checkId: "c1", tableId: "t12", covers: 2, opened: false },
    });
    const region = await panel();
    expect(within(region).getByTestId("kv-covers").textContent).toContain("–");
    await userEvent.click(within(region).getByRole("button", { name: "Set covers" }));
    expect(screen.getByRole("dialog", { name: "Set covers · T12" })).toBeTruthy();
  });

  it("Add items goes to order entry for the table, Print check opens the print page", async () => {
    const { router } = setup({ "GET /api/tables/t12/check": open() });
    const region = await panel();
    await userEvent.click(within(region).getByRole("link", { name: "Print check" }));
    expect(router.state.location.pathname).toBe("/staff/check/c1/print");
    await router.navigate("/staff/floor");
    const region2 = await panel();
    await userEvent.click(within(region2).getByRole("button", { name: "Add items" }));
    expect(await screen.findByText("order entry t12")).toBeTruthy();
  });

  it("speaks Turkish", async () => {
    await setLanguage("tr");
    setup({ "GET /api/tables/t12/check": open() });
    const region = await panel();
    expect(within(region).getByRole("group", { name: "Yemek" })).toBeTruthy();
    expect(within(region).getByRole("group", { name: "İçecek" })).toBeTruthy();
    expect(within(region).getByText("Yemek hazır", { selector: ".fl-pill" })).toBeTruthy();
    expect(within(region).getByTestId("total").textContent).toContain(formatTRY(409000, "tr"));
    expect(within(region).getByRole("button", { name: "Hesabı kapat" })).toBeTruthy();
  });
});
