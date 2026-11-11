import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const HOURS = [17, 18, 19, 20, 21, 22, 23, 0];
const REV = [120_000, 310_000, 540_000, 880_000, 1_000_000, 700_000, 400_000, 150_000];

const totals = (revenue: number, covers: number) => ({
  revenue,
  covers,
  checks: covers > 0 ? Math.ceil(covers / 2.5) : 0,
  avgPerCover: covers > 0 ? Math.round(revenue / covers) : 0,
  avgPerCheck: covers > 0 ? Math.round(revenue / Math.ceil(covers / 2.5)) : 0,
  comps: { count: 14, amount: 40_000 },
  voids: { count: 9, amount: 21_000 },
  compsPct: 1.5,
});

const view = (range: string, over: Record<string, unknown> = {}) => ({
  range,
  from: "2026-11-04",
  to: "2026-11-10",
  current: totals(4_100_000, 480),
  previous: totals(3_660_714, 480),
  byHour: HOURS.map((hour, i) => ({ hour, revenue: REV[i]! })),
  ticketTimes: {
    kitchen: HOURS.map((hour, i) => ({ hour, avgMin: 8 + i })),
    bar: HOURS.slice(0, 6).map((hour, i) => ({ hour, avgMin: 3 + i * 0.5 })),
  },
  thresholdMin: 15,
  topItems: [
    { name: { en: "Dry-aged ribeye, 300 g", tr: "Dinlendirilmiş antrikot, 300 g" }, qty: 96, revenue: 2_352_000 },
    { name: { en: "Burrata, heirloom tomato", tr: "Burrata, yerli domates" }, qty: 142, revenue: 766_800 },
  ],
  log: [
    {
      at: "2026-11-07T19:41:00.000Z",
      kind: "comp",
      itemName: { en: "Olive oil gelato", tr: "Zeytinyağlı dondurma" },
      tableName: "T4",
      reason: "celebration",
      note: null,
      requestedByName: "Mert",
      approvedByName: "Selin",
      amount: 26_000,
      reversed: false,
    },
    {
      at: "2026-11-07T18:07:00.000Z",
      kind: "void",
      itemName: { en: "Negroni", tr: "Negroni" },
      tableName: "B2",
      reason: "wrong_item",
      note: null,
      requestedByName: "Deniz",
      approvedByName: "Selin",
      amount: 52_000,
      reversed: true,
    },
  ],
  ...over,
});

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(routes: Record<string, unknown> = {}) {
  calls = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/sales?range=7d": view("7d"),
    "GET /api/sales?range=today": view("today"),
    "GET /api/sales?range=30d": view("30d"),
    ...routes,
  }).calls;
  return renderApp("/staff/sales");
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

describe("Sales", () => {
  it("shows the tiles with amounts and the change against the previous period in text", async () => {
    setup();
    const revenue = await screen.findByRole("group", { name: "Revenue" });
    expect(revenue.textContent).toContain(formatTRY(4_100_000, "en"));
    expect(revenue.textContent).toContain("▲ 12%");
    expect(revenue.textContent).toContain("vs previous 7 days");
    expect(screen.getByRole("group", { name: "Covers" }).textContent).toContain("480");
    expect(screen.getByRole("group", { name: "Average per cover" }).textContent).toContain(formatTRY(Math.round(4_100_000 / 480), "en"));
    const comps = screen.getByRole("group", { name: "Comps · voids" });
    expect(comps.textContent).toContain(formatTRY(61_000, "en"));
    expect(comps.textContent).toContain("14 comps · 9 voids");
  });

  it("marks falls with ▼ and has no change text without a previous period", async () => {
    setup({ "GET /api/sales?range=7d": view("7d", { previous: totals(5_000_000, 480) }) });
    expect((await screen.findByRole("group", { name: "Revenue" })).textContent).toContain("▼ 18%");
    cleanup();
    setup({ "GET /api/sales?range=7d": view("7d", { previous: totals(0, 0) }) });
    const rev = await screen.findByRole("group", { name: "Revenue" });
    expect(rev.textContent).not.toMatch(/NaN|Infinity/);
    expect(rev.textContent).not.toContain("▲");
  });

  it("draws one bar per hour, names the peak, and lists every hour in a hidden table", async () => {
    setup();
    const fig = (await screen.findByRole("heading", { name: "Revenue by hour" })).closest("figure")!;
    const bars = within(fig).getAllByRole("img");
    expect(bars).toHaveLength(HOURS.length);
    const peak = within(fig).getByRole("img", { name: /Peak/i });
    expect(peak.getAttribute("aria-label")).toContain("21:00");
    expect(within(fig).getAllByRole("img", { name: /Peak/i })).toHaveLength(1);
    const table = within(fig).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(HOURS.length + 1);
    expect(table.textContent).toContain(formatTRY(1_000_000, "en"));
    expect(table.closest(".sr-only")).toBeTruthy();
  });

  it("draws the ticket-time lines with the 15 min threshold and a hidden table", async () => {
    setup();
    const fig = (await screen.findByRole("heading", { name: "Ticket times by hour" })).closest("figure")!;
    expect(fig.textContent).toContain("15 min");
    expect(fig.querySelectorAll("polyline")).toHaveLength(2);
    expect(within(fig).getAllByRole("row")).toHaveLength(HOURS.length + 1);
  });

  it("lists top dishes and the comps and voids log with reasons and approvers", async () => {
    setup();
    const top = await screen.findByRole("list", { name: "Top dishes" });
    expect(within(top).getAllByRole("listitem")[0]!.textContent).toContain("Dry-aged ribeye");
    expect(within(top).getAllByRole("listitem")[0]!.textContent).toContain("96");
    const log = screen.getByRole("list", { name: "Comps & voids" });
    const rows = within(log).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Comp");
    expect(rows[0]!.textContent).toContain("Olive oil gelato · T4");
    expect(rows[0]!.textContent).toContain("Birthday / celebration");
    expect(rows[0]!.textContent).toContain("Mert → Selin");
    expect(rows[0]!.textContent).toContain(formatTRY(26_000, "en"));
    expect(rows[1]!.textContent).toContain("Void");
    expect(rows[1]!.textContent).toContain("Undone");
  });

  it("links the CSV export to the selected range", async () => {
    setup();
    const link = await screen.findByRole("link", { name: "Export CSV" });
    expect(link.getAttribute("href")).toBe("/api/sales/export.csv?range=7d");
    expect(link.hasAttribute("download")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(link.getAttribute("href")).toBe("/api/sales/export.csv?range=30d");
  });

  it("defaults to 7 days and requests today when switched", async () => {
    setup();
    expect((await screen.findByRole("button", { name: "7 days" })).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("/api/sales?range=today"))).toBe(true));
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    await screen.findByRole("group", { name: "Revenue" });
  });

  it("renders zeros and empty charts for a range with no sales", async () => {
    const empty = view("7d", {
      current: { ...totals(0, 0), comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 }, compsPct: 0 },
      previous: totals(0, 0),
      byHour: [],
      ticketTimes: { kitchen: [], bar: [] },
      topItems: [],
      log: [],
    });
    setup({ "GET /api/sales?range=7d": empty });
    const rev = await screen.findByRole("group", { name: "Revenue" });
    expect(rev.textContent).toContain(formatTRY(0, "en"));
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText("No sales in this range yet.")).toBeTruthy();
    expect(screen.getByText("No comps or voids in this range.")).toBeTruthy();
  });

  it("an all-zero byHour list draws bars but no peak", async () => {
    setup({ "GET /api/sales?range=7d": view("7d", { byHour: HOURS.map((hour) => ({ hour, revenue: 0 })) }) });
    const fig = (await screen.findByRole("heading", { name: "Revenue by hour" })).closest("figure")!;
    expect(within(fig).queryByRole("img", { name: /Peak/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("reads in Turkish", async () => {
    await setLanguage("tr");
    setup();
    expect(await screen.findByRole("group", { name: "Ciro" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CSV indir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bugün" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Saatlik ciro" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mutfak/Bar fiş süreleri" })).toBeTruthy();
  });

  it("redirects the old /staff/tonight address", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/sales?range=7d": view("7d") });
    const { router } = renderApp("/staff/tonight");
    await screen.findByRole("group", { name: "Revenue" });
    expect(router.state.location.pathname).toBe("/staff/sales");
  });
});
