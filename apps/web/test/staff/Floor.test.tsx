import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeAccessibleName } from "dom-accessibility-api";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useParams } from "react-router";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { Floor } from "../../src/staff/floor/Floor";
import type { FloorSnapshot, FloorTable, TableCheck } from "../../src/staff/floor/types";
import { mockFetch, sockets } from "./harness";

// Server clock 21:42:00 Istanbul; the device clock is a year off.
const SERVER_NOW = Date.parse("2026-11-10T18:42:00.000Z");
let device = Date.parse("2025-03-01T09:00:00.000Z");
const clock = () => device;
const ago = (min: number) => new Date(SERVER_NOW - min * 60_000).toISOString();

const ME = "id-deniz";
const OTHER = "id-mert";
const tbl = (name: string, roomId: string, over: Partial<FloorTable> = {}): FloorTable => ({
  id: name.toLowerCase(),
  name,
  roomId,
  shape: name.startsWith("B") ? "rect" : "round",
  x: 40, y: 160, w: 76, h: 76,
  capacity: 2,
  sectionStaffId: ME,
  serverStaffId: ME,
  serverInitials: "D",
  state: "free",
  covers: null,
  seatedAt: null,
  checkId: null,
  ...over,
});
const seated = (min: number, covers = 2) => ({ state: "seated" as const, covers, seatedAt: ago(min), checkId: "c" });

const snapshot = (): FloorSnapshot => ({
  now: new Date(SERVER_NOW).toISOString(),
  rooms: [{ id: "salon", name: "Salon" }, { id: "bar", name: "Bar" }, { id: "terrace", name: "Terrace" }],
  tables: [
    tbl("T10", "salon", { ...seated(52), sectionStaffId: OTHER }),
    tbl("T2", "salon", { ...seated(72, 4), state: "ready" }),
    tbl("B1", "salon", { ...seated(6), state: "bill" }),
    tbl("T7", "salon"),
    tbl("T9", "bar", { ...seated(12), state: "calling", sectionStaffId: OTHER }),
  ],
  chips: [
    { kind: "calling", tableId: "t9", tableName: "T9", since: ago(1) },
    { kind: "ready", tableId: "t2", tableName: "T2", since: ago(3) },
    { kind: "bill", tableId: "b1", tableName: "B1", since: ago(2) },
  ],
  stats: { seated: 4, totalTables: 5, covers: 10, avgTurnMs: 64 * 60_000, openChecksTotal: 4892000 },
});

const checkOf = (id: string, name: string): TableCheck => ({
  table: { id, name, capacity: 2, sectionStaffId: ME },
  calls: [],
  check: null,
});

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(path = "/staff/floor") {
  calls = mockFetch({
    "GET /api/auth/me": { staff: { id: ME, name: "Deniz", role: "waiter" } },
    "GET /api/floor": snapshot(),
    "GET /api/tables/t2/check": checkOf("t2", "T2"),
    "GET /api/tables/t9/check": checkOf("t9", "T9"),
    "GET /api/tables/t7/check": checkOf("t7", "T7"),
    "GET /api/tables/t10/check": checkOf("t10", "T10"),
    "GET /api/tables/b1/check": checkOf("b1", "B1"),
  }).calls;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Order() {
    return <p>order entry {useParams().tableId}</p>;
  }
  const router = createMemoryRouter(
    [
      { path: "/staff/floor", element: <Floor clock={clock} /> },
      { path: "/staff/order/:tableId", element: <Order /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc };
}

const tableBtn = (name: RegExp) => screen.findByRole("button", { name });
const canvas = () => screen.getByRole("group", { name: /Floor plan/ });

beforeEach(async () => {
  sockets.length = 0;
  device = Date.parse("2025-03-01T09:00:00.000Z");
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Floor", () => {
  it("shows the room's tables in name order with server-time elapsed, the stats strip and my section", async () => {
    setup();
    await tableBtn(/^T2, food ready/);
    const names = within(canvas()).getAllByRole("button").map((b) => computeAccessibleName(b).split(",")[0]);
    expect(names).toEqual(["B1", "T2", "T7", "T10"]);
    // Elapsed from the snapshot's now, not the device clock (a year off).
    expect(screen.getByRole("button", { name: /^T2, food ready, 4 covers, 1 hour 12 minutes/ }).textContent).toContain("4 · 1h 12m");
    expect(screen.getByText("of 5 tables seated").textContent).toBe("4of 5 tables seated");
    expect(screen.getByText("covers").textContent).toBe("10covers");
    expect(screen.getByText("avg turn").textContent).toBe("1h 04mavg turn");
    expect(screen.getByText("open checks").textContent).toBe(`${formatTRY(4892000, "en")}open checks`);
    expect(screen.getByTestId("my-section").textContent).toBe("My section: Deniz · 3 tables");
    // Legend shows every state word.
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Free", "Seated", "Food ready", "Calling", "Bill"]);
  });

  it("ticks elapsed times from the server clock", async () => {
    setup();
    await tableBtn(/^B1, wants the bill, 2 covers, 6 minutes/);
    await act(async () => {
      device += 60_000;
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(screen.getByRole("button", { name: /^B1, wants the bill, 2 covers, 7 minutes/ })).toBeTruthy();
  });

  it("selecting a table sets aria-pressed, the URL and opens the labelled detail region", async () => {
    const { router } = setup();
    await userEvent.click(await tableBtn(/^T7, free/));
    expect(screen.getByRole("button", { name: /^T7, free/ }).getAttribute("aria-pressed")).toBe("true");
    expect(router.state.location.search).toContain("table=t7");
    expect(await screen.findByRole("region", { name: /T7/ })).toBeTruthy();
  });

  it("a chip selects its table and switches to its room tab", async () => {
    const { router } = setup();
    await tableBtn(/^T2,/);
    const chip = screen.getByRole("button", { name: /T9 calling/ });
    expect(chip.textContent).toContain("T9 calling · 1m");
    expect(screen.getByRole("button", { name: /B1 wants the bill/ })).toBeTruthy();
    await userEvent.click(chip);
    expect(screen.getByRole("button", { name: "Bar" }).getAttribute("aria-pressed")).toBe("true");
    expect((await tableBtn(/^T9, calling/)).getAttribute("aria-pressed")).toBe("true");
    expect(router.state.location.search).toContain("room=bar");
  });

  it("opens the room and table from the URL", async () => {
    setup("/staff/floor?table=t9");
    expect((await tableBtn(/^T9, calling/)).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Bar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("My tables dims other sections without filtering the stats", async () => {
    setup();
    await tableBtn(/^T2,/);
    const toggle = screen.getByRole("button", { name: "My tables" });
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^T10,/ }).className).toContain("is-dim");
    expect(screen.getByRole("button", { name: /^T2,/ }).className).not.toContain("is-dim");
    expect(screen.getByRole("button", { name: /^T2,/ }).className).toContain("is-mine");
    expect(screen.getByText("of 5 tables seated").textContent).toBe("4of 5 tables seated");
  });

  it("New order goes to the selected table; with none, it asks for a table and the next tap opens order entry", async () => {
    setup();
    await tableBtn(/^T2,/);
    await userEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(screen.getByText("Pick a table for the new order")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^T2,/ }));
    expect(await screen.findByText("order entry t2")).toBeTruthy();
  });

  it("zoom is visual only, 75 to 125%", async () => {
    setup();
    const t2 = await tableBtn(/^T2,/);
    const w = parseFloat(t2.style.width);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: /Reset zoom/ }).textContent).toBe("125%");
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(true);
    expect(parseFloat(screen.getByRole("button", { name: /^T2,/ }).style.width)).toBeCloseTo(w * 1.25, 1);
    for (let i = 0; i < 6; i++) {
      const out = screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
      if (!out.disabled) await userEvent.click(out);
    }
    expect(screen.getByRole("button", { name: /Reset zoom/ }).textContent).toBe("75%");
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("speaks Turkish", async () => {
    await setLanguage("tr");
    setup();
    await tableBtn(/^T2, yemek hazır/);
    expect(screen.getByRole("button", { name: "Teras" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Masalarım" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /T9 çağırıyor/ })).toBeTruthy();
  });
});
