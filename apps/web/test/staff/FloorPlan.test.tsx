import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const tb = (o: Record<string, unknown>) => ({ shape: "round", w: 64, h: 64, capacity: 2, sectionStaffId: null, openCheck: false, ...o });
const LAYOUT = {
  room: { id: "salon", name: "Salon", width: 800, height: 480, version: 3 },
  tables: [
    tb({ id: "t1", name: "T1", x: 32, y: 32, sectionStaffId: "id-deniz" }),
    tb({ id: "t4", name: "T4", x: 160, y: 32, w: 76, h: 76, capacity: 4, openCheck: true }),
    tb({ id: "b1", name: "B1", shape: "rect", x: 32, y: 160, w: 96, h: 64, capacity: 4 }),
  ],
  nextNames: { T: "T17", B: "B6" },
};
const FLOOR = {
  now: "2026-11-10T18:42:00.000Z",
  rooms: [{ id: "salon", name: "Salon" }, { id: "bar", name: "Bar" }],
  tables: [], chips: [], stats: { seated: 0, totalTables: 3, covers: 0, avgTurnMs: 0, openChecksTotal: 0 },
};
const person = (id: string, name: string, role = "waiter", active = true) => ({
  id, name, role, active, lastSignInAt: null, tables: [], tableRanges: "", demoProtected: false, canDeactivate: true, whyNot: null,
});
const PEOPLE = { people: [person("id-deniz", "Deniz"), person("id-mert", "Mert"), person("id-manager", "Selin Kaya", "manager")], stations: [] };

function setup(extra: Record<string, unknown> = {}, path = "/staff/floor-plan") {
  const { calls, routes } = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/floor": FLOOR,
    "GET /api/staff": PEOPLE,
    "GET /api/rooms/salon/layout": LAYOUT,
    ...extra,
  });
  return { calls, routes, ...renderApp(path) };
}
const tableBtn = (name: string) => screen.findByRole("button", { name: new RegExp(`^${name},`) });
const puts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.method === "PUT" && c.path === "/api/rooms/salon/layout");

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Floor plan editor", () => {
  it("ArrowRight on a focused table moves it 16 px and counts one unsaved change", async () => {
    const user = userEvent.setup();
    setup();
    const t1 = await tableBtn("T1");
    expect(t1.getAttribute("aria-label")).toContain("x 32, y 32");
    t1.focus();
    await user.keyboard("{ArrowRight}");
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 48, y 32");
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
    expect(document.activeElement).toBe(await tableBtn("T1"));
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 48, y 96");
    expect(screen.getByText("T1 moved to x 48, y 96")).toBeTruthy();
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("Save sends the whole room with the version it was loaded at", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "PUT /api/rooms/salon/layout": { ...LAYOUT, room: { ...LAYOUT.room, version: 4 } } });
    (await tableBtn("T1")).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const body = puts(calls)[0]!.body as { version: number; tables: Record<string, unknown>[] };
    expect(body.version).toBe(3);
    expect(body.tables).toHaveLength(3);
    expect(body.tables.find((x) => x.key === "t1")).toEqual({
      id: "t1", key: "t1", name: "T1", shape: "round", x: 48, y: 32, w: 64, h: 64, capacity: 2, sectionStaffId: "id-deniz",
    });
    expect(await screen.findByText("Layout saved")).toBeTruthy();
  });

  it("a 409 says someone else saved and reloads their version", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      "PUT /api/rooms/salon/layout": () => ({ status: 409, body: { error: { code: "version_conflict", message: "x" } } }),
    });
    (await tableBtn("T1")).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Save layout" }));
    expect(await screen.findByText("Someone else saved this room. Reloading their version.")).toBeTruthy();
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === "/api/rooms/salon/layout")).toHaveLength(2));
    await waitFor(async () => expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 32, y 32"));
    expect(screen.queryByText("1 unsaved change")).toBeNull();
  });

  it("layout_invalid marks the named table aria-invalid and lists the problem", async () => {
    const user = userEvent.setup();
    setup({
      "PUT /api/rooms/salon/layout": () => ({
        status: 400,
        body: { error: { code: "layout_invalid", message: "x", details: { problems: [{ key: "t1", code: "overlap" }] } } },
      }),
    });
    (await tableBtn("T1")).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(async () => expect((await tableBtn("T1")).getAttribute("aria-invalid")).toBe("true"));
    expect((await tableBtn("T4")).getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("T1: overlaps another table")).toBeTruthy();
  });

  it("Add Booth creates B6 from nextNames.B, then B7", async () => {
    const user = userEvent.setup();
    setup();
    await tableBtn("T1");
    const add = screen.getByRole("group", { name: "Add a table" });
    await user.click(within(add).getByRole("button", { name: "Booth" }));
    expect(await tableBtn("B6")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("B6");
    await user.click(within(add).getByRole("button", { name: "Booth" }));
    expect(await tableBtn("B7")).toBeTruthy();
    expect(screen.getByText("2 unsaved changes")).toBeTruthy();
    await user.click(within(add).getByRole("button", { name: "Round" }));
    expect(await tableBtn("T17")).toBeTruthy();
  });

  it("Shape → Booth on an open-check table is disabled with the reason", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T4"));
    const shape = screen.getByRole("group", { name: "Shape" });
    const boothBtn = within(shape).getByRole("button", { name: "Booth" }) as HTMLButtonElement;
    expect(boothBtn.disabled).toBe(true);
    const reason = "Has an open check: it can move, but not be renamed or removed";
    const describedBy = boothBtn.getAttribute("aria-describedby")!;
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ")).toContain(reason);
    expect((within(shape).getByRole("button", { name: "Square" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly || (screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching a table to Booth renames it to the next booth number", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T1"));
    await user.click(within(screen.getByRole("group", { name: "Shape" })).getByRole("button", { name: "Booth" }));
    expect(await tableBtn("B6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^T1,/ })).toBeNull();
  });

  it("Delete removes the focused table; Discard brings it back", async () => {
    const user = userEvent.setup();
    setup();
    (await tableBtn("B1")).focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: /^B1,/ })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^T1,/);
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(await tableBtn("B1")).toBeTruthy();
  });

  it("the inspector's Duplicate focuses the copy; Delete focuses the next table", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T1"));
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    const copy = await tableBtn("T17");
    await waitFor(() => expect(document.activeElement).toBe(copy));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: /^T17,/ })).toBeNull();
    // Name order B1, T1, T4, T17: the one after T17 is none, so the one before it.
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^T4,/));
    await user.click(await tableBtn("B1"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^T1,/));
  });

  it("an arrow press snaps only the axis it moves along: an off-grid table pressed right keeps its y", async () => {
    const user = userEvent.setup();
    setup({ "GET /api/rooms/salon/layout": { ...LAYOUT, tables: [tb({ id: "t7", name: "T7", x: 200, y: 298 })] } });
    (await tableBtn("T7")).focus();
    await user.keyboard("{ArrowRight}");
    expect((await tableBtn("T7")).getAttribute("aria-label")).toContain("x 224, y 298");
    await user.click(await tableBtn("T7"));
    await user.click(screen.getByRole("button", { name: "Move right" }));
    expect((await tableBtn("T7")).getAttribute("aria-label")).toContain("x 240, y 298");
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect((await tableBtn("T7")).getAttribute("aria-label")).toContain("x 240, y 320"); // 298 + 16 = 314, snapped to 320
  });

  it("an arrow press clamped at the edge doesn't move or announce", async () => {
    const user = userEvent.setup();
    setup({ "GET /api/rooms/salon/layout": { ...LAYOUT, tables: [tb({ id: "t1", name: "T1", x: 32, y: 0 })] } });
    const t1 = await tableBtn("T1");
    t1.focus();
    await user.keyboard("{ArrowUp}");
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 32, y 0");
    expect(document.querySelector("p.sr-only[role=status]")!.textContent).toBe("");
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("T1 moved to x 32, y 16")).toBeTruthy();
  });

  it("dragging snaps to the grid, shows the readout while moving and commits on release", async () => {
    setup();
    const t1 = await tableBtn("T1");
    fireEvent.pointerDown(t1, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(t1, { pointerId: 1, pointerType: "mouse", clientX: 125, clientY: 141 });
    // 32 + 25 → 57 → 64; 32 + 41 → 73 → 80.
    expect(screen.getByText("x 64 · y 80")).toBeTruthy();
    expect(screen.queryByText("1 unsaved change")).toBeNull();
    fireEvent.pointerUp(t1, { pointerId: 1, pointerType: "mouse", clientX: 125, clientY: 141 });
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 64, y 80");
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
    expect(document.querySelector(".fp-coord")).toBeNull();
  });

  it("a tap without movement only selects", async () => {
    setup();
    const t1 = await tableBtn("T1");
    fireEvent.pointerDown(t1, { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(t1, { pointerId: 2, pointerType: "touch", clientX: 11, clientY: 11 });
    fireEvent.pointerUp(t1, { pointerId: 2, pointerType: "touch", clientX: 11, clientY: 11 });
    expect(t1.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/unsaved change/)).toBeNull();
  });

  it("the inspector's arrows move the table one grid step (tap alternative to dragging)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T1"));
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 32, y 48");
    expect(screen.getByText("T1 moved to x 32, y 48")).toBeTruthy();
  });

  it("typing a name with the other prefix is refused: Shape switches between table and booth", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T1"));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "B9");
    expect(screen.getByText("Use Shape to switch between table and booth")).toBeTruthy();
    expect(await tableBtn("T1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^B9,/ })).toBeNull();
    const shape = screen.getByRole("group", { name: "Shape" });
    expect(within(shape).getByRole("button", { name: "Round" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(shape).getByRole("button", { name: "Booth" }).getAttribute("aria-pressed")).toBe("false");
    // Same prefix, typed in lower case: accepted as T12, and the field is not rewritten under the caret.
    await user.clear(name);
    await user.type(name, "t12");
    expect(name.value).toBe("t12");
    expect(await tableBtn("T12")).toBeTruthy();
    expect(screen.queryByText("Use Shape to switch between table and booth")).toBeNull();
    // Blur shows the stored name.
    await user.tab();
    expect(name.value).toBe("T12");
  });

  it("a booth's name can't be typed into a table name either (TR copy)", async () => {
    const user = userEvent.setup();
    await setLanguage("tr");
    setup();
    await user.click(await tableBtn("B1"));
    const name = screen.getByLabelText("Ad") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "T30");
    expect(screen.getByText("Masa ile loca arasında geçiş için Şekil'i kullanın")).toBeTruthy();
    expect(await tableBtn("B1")).toBeTruthy();
  });

  it("a drag whose events land in one tick commits the final snapped position", async () => {
    setup();
    const t1 = await tableBtn("T1");
    act(() => {
      fireEvent.pointerDown(t1, { pointerId: 3, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(t1, { pointerId: 3, pointerType: "mouse", clientX: 140, clientY: 100 });
      fireEvent.pointerMove(t1, { pointerId: 3, pointerType: "mouse", clientX: 300, clientY: 165 });
      fireEvent.pointerUp(t1, { pointerId: 3, pointerType: "mouse", clientX: 300, clientY: 165 });
    });
    // 32 + 200 → 232 → 240 (snap); 32 + 65 → 97 → 96.
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 240, y 96");
  });

  it("losing pointer capture mid-drag puts the table back", async () => {
    setup();
    const t1 = await tableBtn("T1");
    fireEvent.pointerDown(t1, { pointerId: 4, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(t1, { pointerId: 4, pointerType: "touch", clientX: 160, clientY: 100 });
    fireEvent(t1, new Event("lostpointercapture", { bubbles: true }));
    expect(document.querySelector(".fp-coord")).toBeNull();
    fireEvent.pointerUp(t1, { pointerId: 4, pointerType: "touch", clientX: 160, clientY: 100 });
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 32, y 32");
    expect(screen.queryByText(/unsaved change/)).toBeNull();
  });

  it("a live reload never drops an edit made before the refetch lands", async () => {
    const { calls } = setup();
    const t1 = await tableBtn("T1");
    act(() => {
      for (const s of sockets) s.emit("event", { type: "layout.saved", ids: ["salon"], at: "2026-11-10T18:43:00.000Z" });
      t1.focus();
      fireEvent.keyDown(t1, { key: "ArrowRight" });
    });
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === "/api/rooms/salon/layout").length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 20));
    expect((await tableBtn("T1")).getAttribute("aria-label")).toContain("x 48, y 32");
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("a live reload of a clean room takes the other version", async () => {
    const { routes } = setup();
    await tableBtn("T1");
    routes["GET /api/rooms/salon/layout"] = { ...LAYOUT, room: { ...LAYOUT.room, version: 4 }, tables: [...LAYOUT.tables, tb({ id: "t9", name: "T9", x: 400, y: 32 })] };
    act(() => {
      for (const s of sockets) s.emit("event", { type: "layout.saved", ids: ["salon"], at: "2026-11-10T18:43:00.000Z" });
    });
    expect(await tableBtn("T9")).toBeTruthy();
  });

  it("the inspector links to this table's QR code", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await tableBtn("T1"));
    expect(screen.getByRole("link", { name: "QR code for this table" }).getAttribute("href")).toBe("/staff/tables/qr?table=t1");
  });

  it("leaving with unsaved changes asks first", async () => {
    const user = userEvent.setup();
    const { router } = setup({ "GET /api/manager/tables": [], "GET /api/auth/staff": [] });
    (await tableBtn("T1")).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("link", { name: "Tables" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(dialog).getByRole("button", { name: "Stay" }));
    expect(router.state.location.pathname).toBe("/staff/floor-plan");
    await user.click(screen.getByRole("link", { name: "Tables" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/tables"));
  });
});

describe("QR sheet ?table=", () => {
  it("prints only that table", async () => {
    mockFetch({
      "GET /api/auth/me": staffOf("manager"),
      "GET /api/floor": FLOOR,
      "GET /api/manager/tables": [
        { id: "t1", name: "T1", capacity: 2, roomId: "salon", active: true, token: "a" },
        { id: "t4", name: "T4", capacity: 4, roomId: "salon", active: true, token: "b" },
      ],
    });
    renderApp("/staff/tables/qr?table=t4");
    expect(await screen.findByRole("heading", { name: "T4" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "T1" })).toBeNull();
  });
});
