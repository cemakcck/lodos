import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { lastSeen } from "../../src/staff/people/lib";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const row = (o: Record<string, unknown>) => ({
  active: true, lastSignInAt: null, tables: [], tableRanges: "", demoProtected: false, canDeactivate: true, whyNot: null, ...o,
});
const tb = (id: string, name: string, roomId = "salon") => ({ id, name, roomId });
const PEOPLE = [
  row({ id: "id-deniz", name: "Deniz Kaya", role: "waiter", tables: [tb("b1", "B1"), tb("b2", "B2"), tb("t5", "T5")], tableRanges: "B1–B2, T5", lastSignInAt: "2026-10-12T10:00:00.000Z" }),
  row({ id: "id-mert", name: "Mert Aydın", role: "waiter", tables: [tb("t1", "T1"), tb("t20", "T20", "terrace")], tableRanges: "T1, T20" }),
  row({ id: "id-manager", name: "Selin Kaya", role: "manager", demoProtected: true, canDeactivate: false, whyNot: "self" }),
  row({ id: "id-ayse", name: "Ayşe Demir", role: "cook" }),
  row({ id: "id-ece", name: "Ece Yıldız", role: "waiter", active: false, canDeactivate: false }),
];
const STATIONS = [row({ id: "id-kitchen", name: "Kitchen", role: "kitchen", canDeactivate: false, whyNot: "station" })];
const TABLES = [
  { id: "b1", name: "B1", capacity: 4, roomId: "salon", active: true, token: "x" },
  { id: "b2", name: "B2", capacity: 4, roomId: "salon", active: true, token: "x" },
  { id: "t1", name: "T1", capacity: 2, roomId: "salon", active: true, token: "x" },
  { id: "t5", name: "T5", capacity: 2, roomId: "salon", active: true, token: "x" },
  { id: "t20", name: "T20", capacity: 2, roomId: "terrace", active: true, token: "x" },
];
const FLOOR = {
  now: "2026-11-10T18:42:00.000Z",
  rooms: [{ id: "salon", name: "Salon" }, { id: "terrace", name: "Terrace" }],
  tables: [], chips: [], stats: { seated: 0, totalTables: 5, covers: 0, avgTurnMs: 0, openChecksTotal: 0 },
};

function setup(extra: Record<string, unknown> = {}, path = "/staff/people") {
  const { calls } = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/staff": { people: PEOPLE, stations: STATIONS },
    "GET /api/manager/tables": TABLES,
    "GET /api/floor": FLOOR,
    "GET /api/auth/staff": [],
    ...extra,
  });
  return { calls, ...renderApp(path) };
}
const body = (calls: { method: string; path: string; body?: unknown }[], method: string, path: string) => {
  const c = calls.find((x) => x.method === method && x.path === path);
  return c && (typeof c.body === "string" ? JSON.parse(c.body) : c.body);
};

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Staff list", () => {
  it("renders names, roles, table ranges and status, inactive last", async () => {
    setup();
    const deniz = (await screen.findByRole("button", { name: "Deniz Kaya" })).closest("tr")!;
    expect(within(deniz).getByText("Waiter")).toBeTruthy();
    expect(within(deniz).getByText("B1–B2, T5")).toBeTruthy();
    expect(within(deniz).getByText("12 Oct")).toBeTruthy();
    expect(within(deniz).getByText("Active")).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: /staff/i })).getAllByRole("row");
    const last = rows.at(-1)!;
    expect(within(last).getByText("Ece Yıldız")).toBeTruthy();
    expect(within(last).getByText("Inactive")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Stations" })).getByRole("button", { name: /Reset PIN/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Deactivate/ })).toBeNull();
  });

  it("formats last sign-in relative to the Istanbul day", () => {
    const now = new Date("2026-11-11T15:00:00.000Z");
    const t = (k: string, o?: Record<string, string>) => `${k}:${o?.time ?? ""}`;
    expect(lastSeen("2026-11-11T14:02:00.000Z", now, "en", t as never)).toBe("people.today:17:02");
    expect(lastSeen("2026-11-10T14:02:00.000Z", now, "en", t as never)).toBe("people.yesterday:17:02");
    expect(lastSeen(null, now, "en", t as never)).toBe("people.never:");
  });
});

describe("StaffForm", () => {
  it("choosing Cook hides the PIN fields", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Add staff" }));
    const form = screen.getByRole("form", { name: "New staff member" });
    expect(within(form).getByLabelText("PIN")).toHaveProperty("type", "password");
    expect(within(form).getByLabelText("PIN").getAttribute("inputmode")).toBe("numeric");
    await user.click(within(form).getByRole("radio", { name: "Cook" }));
    expect(within(form).queryByLabelText("PIN")).toBeNull();
    expect(within(form).queryByLabelText("Confirm PIN")).toBeNull();
  });

  it("role control is a radiogroup with all six roles", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Add staff" }));
    const group = screen.getByRole("radiogroup", { name: "Role" });
    expect(within(group).getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
      "Waiter", "Manager", "Cook", "Bartender", "Host", "Dishwasher",
    ]);
  });

  it("Cook to Waiter shows the PIN fields and requires them", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "PATCH /api/staff/id-ayse": { staff: PEOPLE[3], unassignedTables: [] } });
    await user.click(await screen.findByRole("button", { name: "Ayşe Demir" }));
    const form = screen.getByRole("form", { name: "Ayşe Demir" });
    expect(within(form).queryByLabelText("PIN")).toBeNull();
    await user.click(within(form).getByRole("radio", { name: "Waiter" }));
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByText(/PIN must be 4 to 6 digits/)).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    await user.type(within(form).getByLabelText("PIN"), "1234");
    await user.type(within(form).getByLabelText("Confirm PIN"), "9999");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByText(/PINs don't match/)).toBeTruthy();
    await user.clear(within(form).getByLabelText("Confirm PIN"));
    await user.type(within(form).getByLabelText("Confirm PIN"), "1234");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(body(calls, "PATCH", "/api/staff/id-ayse")).toMatchObject({ role: "waiter", pin: "1234" }));
  });

  it("a dashed chip moves to the edited waiter, sending the full list", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "PATCH /api/staff/id-deniz": { staff: PEOPLE[0], unassignedTables: [] } });
    await user.click(await screen.findByRole("button", { name: "Deniz Kaya" }));
    const form = screen.getByRole("form", { name: "Deniz Kaya" });
    const chip = await within(form).findByRole("button", { name: /^T1,.*Mert/ });
    expect(chip.className).toMatch(/is-other/);
    expect(chip.textContent).toContain("MA");
    await user.click(chip);
    expect(within(form).getByRole("button", { name: /^T1/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(body(calls, "PATCH", "/api/staff/id-deniz")).toBeTruthy());
    const b = body(calls, "PATCH", "/api/staff/id-deniz");
    expect([...b.tableIds].sort()).toEqual(["b1", "b2", "t1", "t5"]);
  });

  it("Save is disabled until something changes", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Deniz Kaya" }));
    const form = screen.getByRole("form", { name: "Deniz Kaya" });
    expect((within(form).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Deactivate", () => {
  it("shows why a protected account can't be deactivated, as text beside the disabled button", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Selin Kaya" }));
    const form = screen.getByRole("form", { name: "Selin Kaya" });
    const btn = within(form).getByRole("button", { name: "Deactivate" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(within(form).getByText("You can't deactivate your own account.")).toBeTruthy();
  });

  it("confirms with the tables that will be unassigned, then reports them", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      "POST /api/staff/id-deniz/deactivate": { staff: { ...PEOPLE[0], active: false }, unassignedTables: ["T5", "T6", "T7"] },
    });
    await user.click(await screen.findByRole("button", { name: "Deniz Kaya" }));
    await user.click(within(screen.getByRole("form", { name: "Deniz Kaya" })).getByRole("button", { name: "Deactivate" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("B1–B2, T5")).toBeTruthy();
    await user.click(within(dlg).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/staff/id-deniz/deactivate")).toBe(true));
    expect(await screen.findByText("T5–T7 are now unassigned")).toBeTruthy();
  });
});

describe("Reset PIN", () => {
  it("resets a station PIN", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "POST /api/staff/id-kitchen/pin": { ok: true } });
    await user.click(await within(await screen.findByRole("region", { name: "Stations" })).findByRole("button", { name: /Reset PIN/ }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("New PIN"), "4321");
    await user.type(within(dlg).getByLabelText("Confirm PIN"), "4321");
    await user.click(within(dlg).getByRole("button", { name: "Reset PIN" }));
    await waitFor(() => expect(body(calls, "POST", "/api/staff/id-kitchen/pin")).toEqual({ pin: "4321" }));
  });
});

describe("session.ended", () => {
  it("signs out and shows the message on the login screen", async () => {
    let signedIn = true;
    const { router } = setup({
      "GET /api/auth/me": () => (signedIn ? { status: 200, body: staffOf("manager") } : { status: 401, body: { error: { code: "unauthorized", message: "x" } } }),
    });
    await screen.findByRole("button", { name: "Deniz Kaya" });
    signedIn = false;
    act(() => sockets.at(-1)!.emit("event", { type: "session.ended", ids: ["id-manager"] }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
    expect(router.state.location.search).toBe("?ended=1");
    expect(await screen.findByText("You were signed out by a manager")).toBeTruthy();
  });

  it("shows the Turkish message", async () => {
    await setLanguage("tr");
    setup({ "GET /api/auth/staff": [] }, "/staff/login?ended=1");
    expect(await screen.findByText("Bir yönetici oturumunu kapattı")).toBeTruthy();
  });
});
