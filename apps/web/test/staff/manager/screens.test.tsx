import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeAccessibleName } from "dom-accessibility-api";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatElapsed, formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../../src/i18n";
import { toQrSvg } from "../../../src/lib/qr";
import { mockFetch, renderApp, reply, sockets, staffOf } from "../harness";
import { menu } from "./fixtures";

const TABLES = [
  { id: "t12", name: "T12", capacity: 4, roomId: "salon", active: true, token: "tok-t12-aaaaaaaaaaaaaaaa" },
  { id: "b2", name: "B2", capacity: 6, roomId: "salon", active: true, token: "tok-b2-bbbbbbbbbbbbbbbbb" },
  { id: "t20", name: "T20", capacity: 2, roomId: "terrace", active: true, token: "tok-t20-cccccccccccccccc" },
];
const FLOOR = {
  now: "2026-11-10T18:42:00.000Z",
  rooms: [{ id: "salon", name: "Salon" }, { id: "terrace", name: "Terrace" }],
  tables: [
    { id: "t12", name: "T12", roomId: "salon", sectionStaffId: "id-deniz" },
    { id: "b2", name: "B2", roomId: "salon", sectionStaffId: null },
    { id: "t20", name: "T20", roomId: "terrace", sectionStaffId: "id-mert" },
  ],
  chips: [],
  stats: { seated: 0, totalTables: 3, covers: 0, avgTurnMs: 0, openChecksTotal: 0 },
};
const STAFF = [
  { id: "id-deniz", name: "Deniz Kaya", role: "waiter" },
  { id: "id-mert", name: "Mert Aydın", role: "waiter" },
];
const TONIGHT = {
  covers: 42,
  revenue: 4890050,
  openChecks: 3,
  openTotal: 1264000,
  avgTicketMs: 754_000,
  topItems: [
    { name: { en: "Lodos Negroni", tr: "Lodos Negroni" }, qty: 18 },
    { name: { en: "Burrata, heirloom tomato", tr: "Burrata, yerli domates" }, qty: 11 },
    { name: { en: "Dry-aged ribeye, 300 g", tr: "Dinlendirilmiş antrikot, 300 g" }, qty: 7 },
  ],
};

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(path: string, routes: Record<string, unknown> = {}) {
  let tables = TABLES;
  calls = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/manager/menu": menu(),
    "GET /api/manager/tables": () => ({ status: 200, body: tables }),
    "GET /api/floor": FLOOR,
    "GET /api/auth/staff": STAFF,
    "GET /api/manager/tonight": TONIGHT,
    "POST /api/manager/tables/t12/token": () => {
      tables = tables.map((t) => (t.id === "t12" ? { ...t, token: "tok-t12-NEWNEWNEWNEWNEW" } : t));
      return { status: 200, body: { id: "t12", token: "tok-t12-NEWNEWNEWNEWNEW" } };
    },
    "PATCH /api/manager/tables/t12": (b: unknown) => ({ status: 200, body: { id: "t12", name: "T12", capacity: 4, ...(b as object) } }),
    ...routes,
  }).calls;
  return renderApp(path);
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

describe("Menu editor", () => {
  it("lists categories and items with price, station, status and the 86 control", async () => {
    setup("/staff/menu");
    const table = await screen.findByRole("table", { name: /Items/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).queryByRole("button", { name: /^Edit / })).filter((b) => b !== null).map((b) => computeAccessibleName(b))).toEqual([
      // The name is the visible text in reading order (label in name), with "Edit" for screen readers.
      "Edit Burrata, heirloom tomato, Burrata, yerli domates",
      "Edit Dry-aged ribeye, 300\u00a0g, Dinlendirilmiş antrikot, 300\u00a0g, 1 option group", // keepUnits binds the number to its unit
      "Edit Lodos Negroni",
    ]);
    const burrataRow = rows.find((r) => r.textContent?.includes("Burrata"))!;
    expect(burrataRow.textContent).toContain(formatTRY(54000, "en"));
    expect(within(burrataRow).getByRole("switch", { name: /Sold out tonight, Burrata/ })).toBeTruthy();
    const cats = screen.getByRole("navigation", { name: "Categories" });
    expect(within(cats).getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("To share"), expect.stringContaining("Cocktails")]),
    );
  });

  it("opens the item form when an item is selected", async () => {
    setup("/staff/menu");
    await userEvent.click(await screen.findByRole("button", { name: /^Edit Lodos Negroni/ }));
    const dialog = await screen.findByRole("dialog", { name: /Lodos Negroni/ });
    expect(within(dialog).getByRole("textbox", { name: "Name (English)" })).toHaveProperty("value", "Lodos Negroni");
  });

  it("moves a category down by swapping sort values", async () => {
    setup("/staff/menu", {
      "PATCH /api/manager/categories/share": (b: unknown) => ({ status: 200, body: b }),
      "PATCH /api/manager/categories/fire": (b: unknown) => ({ status: 200, body: b }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Move To share down" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    const patches = Object.fromEntries(calls.filter((c) => c.method === "PATCH").map((c) => [c.path.split("/").pop(), c.body]));
    expect(patches).toEqual({ share: { sort: 20 }, fire: { sort: 10 } });
  });

  it("explains a refused category delete", async () => {
    setup("/staff/menu", { "DELETE /api/manager/categories/share": () => reply(409, "conflict") });
    await userEvent.click(await screen.findByRole("button", { name: "Rename To share" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete category" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/still has items/);
  });
});

describe("Tables", () => {
  it("lists name, room, capacity and section", async () => {
    setup("/staff/tables");
    const row = (await screen.findByRole("cell", { name: "T12" })).closest("tr")!;
    expect(row.textContent).toContain("Salon");
    expect(row.textContent).toContain("4");
    expect(row.textContent).toContain("Deniz Kaya");
    expect(screen.getByRole("link", { name: /Print QR sheet/ }).getAttribute("href")).toBe("/staff/tables/qr");
  });

  it("regenerates a QR code after a confirm that warns the old code stops working, then refetches", async () => {
    setup("/staff/tables");
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate QR for T12" }));
    const dialog = await screen.findByRole("dialog", { name: /T12/ });
    expect(dialog.textContent).toMatch(/old printed code stops working/);
    const before = calls.filter((c) => c.path === "/api/manager/tables").length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Regenerate QR" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/manager/tables/t12/token")).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/manager/tables").length).toBeGreaterThan(before));
    expect((await screen.findByText(/T12 has a new QR code/)).closest("[role=status]")).toBeTruthy();
  });

  it("renames a table and changes its capacity", async () => {
    setup("/staff/tables");
    await userEvent.click(await screen.findByRole("button", { name: "Edit T12" }));
    const dialog = await screen.findByRole("dialog");
    const cap = within(dialog).getByRole("spinbutton", { name: "Capacity" });
    await userEvent.clear(cap);
    await userEvent.type(cap, "6");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "T12", capacity: 6 });
  });

  it("refuses a table name without the T or B prefix at the field", async () => {
    setup("/staff/tables");
    await userEvent.click(await screen.findByRole("button", { name: "Edit T12" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "12");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("QR sheet", () => {
  it("prints one card per table with the wordmark, name, bilingual line and a QR of origin + /t/ + token", async () => {
    setup("/staff/tables/qr");
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);
    const t12 = cards.find((c) => within(c).queryByRole("heading", { name: "T12" }))!;
    expect(t12.textContent).toContain("Lodos");
    expect(t12.textContent).toContain("Scan to see the menu and order · Menüyü görmek ve sipariş vermek için okutun");
    const svg = await waitFor(() => {
      const s = t12.querySelector("svg[data-qr] path");
      expect(s).toBeTruthy();
      return s!;
    });
    const expected = await toQrSvg(`${window.location.origin}/t/tok-t12-aaaaaaaaaaaaaaaa`);
    expect(expected).toContain(`d="${svg.getAttribute("d")}"`);
    // 2 × 3 per A4 page.
    expect(document.querySelectorAll(".qr-page")).toHaveLength(1);
    // jsdom runs on localhost: the on-screen hint is shown and kept off paper.
    const hint = screen.getByText(/only work on the deployed address/);
    expect(hint.closest(".no-print")).toBeTruthy();
  });
});

describe("Tonight", () => {
  it("shows covers, revenue, open checks with their total, average ticket time and the top items", async () => {
    setup("/staff/tonight");
    const covers = await screen.findByRole("group", { name: "Covers" });
    expect(covers.textContent).toContain("42");
    expect(screen.getByRole("group", { name: "Revenue" }).textContent).toContain(formatTRY(4890050, "en"));
    const open = screen.getByRole("group", { name: "Open checks" });
    expect(open.textContent).toContain("3");
    expect(open.textContent).toContain(formatTRY(1264000, "en"));
    expect(screen.getByRole("group", { name: "Average ticket time" }).textContent).toContain(formatElapsed(754_000));
    const top = screen.getByRole("list", { name: /Top items/ });
    expect(within(top).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Lodos Negroni"),
      expect.stringContaining("Burrata"),
      expect.stringContaining("ribeye"),
    ]);
    expect(within(top).getAllByRole("listitem")[0]!.textContent).toContain("18");
  });

  it("reads in Turkish", async () => {
    await setLanguage("tr");
    setup("/staff/tonight");
    expect(await screen.findByRole("group", { name: "Kişi" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Ciro" }).textContent).toContain(formatTRY(4890050, "tr"));
  });
});
