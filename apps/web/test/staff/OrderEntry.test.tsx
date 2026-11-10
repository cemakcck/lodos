import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { OrderEntry } from "../../src/staff/order/OrderEntry";
import type { MenuItem, MenuResponse } from "../../src/guest/types";
import type { TableCheck } from "../../src/staff/floor/types";
import { burrata, negroni, ribeye } from "../guest/harness";
import { mockFetch, reply, sockets } from "./harness";

const n = (en: string, tr = en) => ({ en, tr });
const gelato: MenuItem = { ...burrata, id: "gelato", categoryId: "desserts", name: n("Olive oil gelato, sea salt", "Zeytinyağlı dondurma, deniz tuzu"), price: 26000, dietary: [], availability: { soldOut: true, remaining: null } };
const MENU: MenuResponse = {
  categories: [
    { id: "share", name: n("To share", "Paylaşmalık") },
    { id: "fire", name: n("From the fire", "Ateşten") },
    { id: "desserts", name: n("Desserts", "Tatlılar") },
    { id: "cocktails", name: n("Cocktails", "Kokteyller") },
  ],
  items: [burrata, ribeye, gelato, negroni],
};

const TABLE = { id: "t7", name: "T7", capacity: 4, sectionStaffId: "id-waiter" };
const SEATED: TableCheck = {
  table: TABLE,
  calls: [],
  check: { id: "c1", covers: 3, openedAt: "2026-11-10T18:00:00.000Z", serverStaffId: "id-waiter", serverName: "Deniz Kaya", billRequestedAt: null, billMethod: null },
  food: [],
  drinks: [],
  totals: { food: 0, drinks: 0, total: 0 },
};
const FREE: TableCheck = { table: TABLE, calls: [], check: null };

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(routes: Record<string, unknown> = {}, check: TableCheck = SEATED) {
  calls = mockFetch({
    "GET /api/auth/me": { staff: { id: "id-waiter", name: "Deniz Kaya", role: "waiter" } },
    "GET /api/menu": MENU,
    "GET /api/tables/t7/check": check,
    ...routes,
  }).calls;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function FloorPage() {
    const { search } = useLocation();
    return <p>floor page {search}</p>;
  }
  const router = createMemoryRouter(
    [
      { path: "/staff/order/:tableId", element: <OrderEntry /> },
      { path: "/staff/floor", element: <FloorPage /> },
    ],
    { initialEntries: ["/staff/order/t7"] },
  );
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc };
}

const tile = (name: RegExp) => screen.findByRole("button", { name });
const order = () => screen.getByRole("region", { name: "Order for T7" });
const lines = () => within(order()).queryAllByRole("listitem");
const sendBtn = () => screen.getByRole("button", { name: /Send to kitchen & bar/ }) as HTMLButtonElement;
const posts = () => calls.filter((c) => c.method === "POST");

async function addRibeye(done: "Rare" | "Medium rare") {
  await userEvent.click(await tile(/^Dry-aged ribeye/));
  const dialog = await screen.findByRole("dialog", { name: /Dry-aged ribeye/ });
  await userEvent.click(within(dialog).getByRole("radio", { name: done }));
  await userEvent.click(within(dialog).getByRole("button", { name: /^Add/ }));
}

beforeEach(async () => {
  sockets.length = 0;
  sessionStorage.clear();
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("OrderEntry", () => {
  it("shows the table, covers and server, a back link, and Food/Drink tiles with price, marker and state", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: /T7/ })).toBeTruthy();
    expect(await screen.findByText("3 covers")).toBeTruthy();
    expect(screen.getByText("Deniz Kaya")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to floor" }).getAttribute("href")).toBe("/staff/floor?table=t7");

    const b = await tile(/^Burrata/);
    expect(b.getAttribute("aria-label")).toBe(`Burrata, heirloom tomato, ${formatTRY(54000, "en")}, food`);
    expect(b.textContent).toContain(formatTRY(54000, "en"));
    expect(b.textContent).toContain("Food");
    expect((await tile(/^Lodos Negroni/)).textContent).toContain("Drink");
    expect((await tile(/^Dry-aged ribeye/)).getAttribute("aria-label")).toContain("choose options");
    const g = await tile(/^Olive oil gelato/);
    expect(g.getAttribute("aria-label")).toContain("sold out");
    expect((g as HTMLButtonElement).disabled).toBe(true);
    expect(g.textContent).toContain("Sold out");
  });

  it("Send is disabled with no lines; adding the same item twice merges qty and announces it", async () => {
    setup();
    await tile(/^Burrata/);
    expect(sendBtn().disabled).toBe(true);
    await userEvent.click(await tile(/^Burrata/));
    expect(screen.getByTestId("order-announce").textContent).toBe("Added Burrata, heirloom tomato");
    await userEvent.click(await tile(/^Burrata/));
    expect(lines()).toHaveLength(1);
    expect(within(lines()[0]!).getByTestId("line-qty").textContent).toBe("2");
    expect(sendBtn().disabled).toBe(false);
    expect(screen.getByTestId("order-total").textContent).toBe(formatTRY(108000, "en"));
    expect((await tile(/^Burrata/)).getAttribute("aria-label")).toContain("2 in this order");
  });

  it("an item with options opens a focus-trapped sheet; a required group blocks Add; different options make separate lines", async () => {
    setup();
    await userEvent.click(await tile(/^Dry-aged ribeye/));
    const dialog = await screen.findByRole("dialog", { name: /Dry-aged ribeye/ });
    const add = within(dialog).getByRole("button", { name: /^Add/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(within(dialog).getByText("Please choose: Doneness")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Rare" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Add burrata/ }));
    expect(add.textContent).toContain(formatTRY(245000 + 18000, "en"));
    await userEvent.click(add);
    expect(screen.queryByRole("dialog")).toBeNull();
    await addRibeye("Medium rare");
    await addRibeye("Medium rare");
    expect(lines()).toHaveLength(2);
    expect(lines()[0]!.textContent).toContain("Rare");
    expect(lines()[0]!.textContent).toContain("Add burrata");
    expect(within(lines()[1]!).getByTestId("line-qty").textContent).toBe("2");
  });

  it("caps the order at 20 items with a message", async () => {
    setup();
    const b = await tile(/^Burrata/);
    for (let i = 0; i < 20; i++) await userEvent.click(b);
    expect(screen.queryByText(/up to 20 items/)).toBeNull();
    await userEvent.click(b);
    expect(within(lines()[0]!).getByTestId("line-qty").textContent).toBe("20");
    expect(screen.getByText(/up to 20 items/)).toBeTruthy();
    expect((within(lines()[0]!).getByRole("button", { name: /^More/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends seat and note; a 500 keeps the lines and the retry reuses the key; success returns to the floor with the table", async () => {
    let attempt = 0;
    const { router } = setup({
      "POST /api/tables/t7/orders": () => (++attempt === 1 ? reply(500, "internal") : { status: 201, body: { orderId: "o9", checkId: "c1", ticketIds: ["k1"] } }),
    });
    await userEvent.click(await tile(/^Burrata/));
    await userEvent.click(await tile(/^Lodos Negroni/));
    const neg = lines()[1]!;
    await userEvent.selectOptions(within(neg).getByRole("combobox", { name: /Seat/ }), "2");
    await userEvent.click(within(neg).getByRole("button", { name: /Add note/ }));
    const note = within(neg).getByRole("textbox", { name: /Note/ });
    await userEvent.type(note, "no ice");
    expect(within(neg).getByText("6/140")).toBeTruthy();

    await userEvent.click(sendBtn());
    expect(await screen.findByText(/Couldn't send/)).toBeTruthy();
    expect(lines()).toHaveLength(2);
    await userEvent.click(sendBtn());
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/floor"));
    expect(router.state.location.search).toBe("?table=t7");

    const [a, b] = posts();
    expect(a!.body).toEqual(b!.body);
    expect(a!.body).toMatchObject({
      expectedCheckId: "c1",
      items: [
        { itemId: "burrata", qty: 1, options: [] },
        { itemId: "negroni", qty: 1, options: [], note: "no ice", seat: 2 },
      ],
    });
    expect((a!.body as { items: object[] }).items[0]).not.toHaveProperty("seat");
    expect((a!.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a sold_out response marks that line and keeps the others; removing it lets you send with a new key", async () => {
    let attempt = 0;
    setup({
      "POST /api/tables/t7/orders": () =>
        ++attempt === 1
          ? { status: 409, body: { error: { code: "sold_out", message: "Just sold out", details: { itemId: "negroni" } } } }
          : { status: 201, body: { orderId: "o9", checkId: "c1", ticketIds: ["k1"] } },
    });
    await userEvent.click(await tile(/^Burrata/));
    await userEvent.click(await tile(/^Lodos Negroni/));
    await userEvent.click(sendBtn());
    const neg = await waitFor(() => {
      const l = lines().find((x) => x.textContent?.includes("Lodos Negroni"))!;
      expect(l.textContent).toContain("Sold out");
      return l;
    });
    expect(lines()).toHaveLength(2);
    expect(lines()[0]!.textContent).not.toContain("Sold out");
    expect(sendBtn().disabled).toBe(true);
    await userEvent.click(within(neg).getByRole("button", { name: /^Remove Lodos Negroni/ }));
    expect(lines()).toHaveLength(1);
    await userEvent.click(sendBtn());
    await screen.findByText(/floor page/);
    const [a, b] = posts();
    expect((b!.body as { items: object[] }).items).toEqual([{ itemId: "burrata", qty: 1, options: [] }]);
    expect((a!.body as { idempotencyKey: string }).idempotencyKey).not.toBe((b!.body as { idempotencyKey: string }).idempotencyKey);
  });

  it("a 409 conflict (not seated) shows a message with a way back to the floor", async () => {
    setup({ "POST /api/tables/t7/orders": () => reply(409, "conflict") });
    await userEvent.click(await tile(/^Burrata/));
    await userEvent.click(sendBtn());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("T7 isn't seated");
    await userEvent.click(within(alert).getByRole("link", { name: "Back to floor" }));
    expect(await screen.findByText("floor page ?table=t7")).toBeTruthy();
  });

  it("a free table shows a clear message and a button back to the floor", async () => {
    setup({}, FREE);
    expect(await screen.findByText("T7 isn't seated")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to kitchen/ })).toBeNull();
    await userEvent.click(screen.getAllByRole("link", { name: "Back to floor" }).at(-1)!);
    expect(await screen.findByText("floor page ?table=t7")).toBeTruthy();
  });

  it("search: / focuses it, it matches across categories, and category tabs filter", async () => {
    setup();
    await tile(/^Burrata/);
    await userEvent.click(screen.getByRole("button", { name: "Cocktails" }));
    expect(screen.getByRole("button", { name: "Cocktails" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Burrata/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Lodos Negroni/ })).toBeTruthy();

    await userEvent.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Search the menu" });
    expect(document.activeElement).toBe(search);
    await userEvent.type(search, "ribe");
    const grid = screen.getByRole("group", { name: /Menu items/ });
    expect(within(grid).getAllByRole("button").map((b) => b.getAttribute("aria-label")!.split(",")[0])).toEqual(["Dry-aged ribeye"]);
    await userEvent.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("keeps the draft across a remount for the same check, and drops a stored draft from an earlier party", async () => {
    const stored = (checkId: string) =>
      sessionStorage.setItem("lodos.order.t7", JSON.stringify({ checkId, idempotencyKey: null, lines: [{ key: "k1", itemId: "burrata", qty: 3, options: [], note: "", seat: null }] }));
    stored("c1");
    setup();
    await waitFor(() => expect(lines()).toHaveLength(1));
    expect(within(lines()[0]!).getByTestId("line-qty").textContent).toBe("3");
    cleanup();

    stored("c0");
    setup();
    await tile(/^Burrata/);
    await waitFor(() => expect(lines()).toHaveLength(0));
    expect(sessionStorage.getItem("lodos.order.t7")).toBeNull();
  });

  it("Turkish", async () => {
    await setLanguage("tr");
    setup();
    expect((await tile(/^Burrata, yerli domates/)).textContent).toContain("Yemek");
    expect((await tile(/^Lodos Negroni/)).textContent).toContain("İçecek");
    expect(screen.getByRole("button", { name: /Mutfağa ve bara gönder/ })).toBeTruthy();
    expect(screen.getByText("3 kişi")).toBeTruthy();
  });
});
