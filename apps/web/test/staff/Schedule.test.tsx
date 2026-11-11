import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, reply, sockets, staffOf } from "./harness";

const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const shift = (o: Record<string, unknown>) => ({ note: null, startAt: "", endAt: "", minutes: 0, ...o });
const WEEK = {
  week: "2026-11-09",
  days: DAYS,
  people: [
    { id: "id-deniz", name: "Deniz Kaya", role: "waiter", group: "floor", active: true },
    { id: "id-ece", name: "Ece Demir", role: "waiter", group: "floor", active: true },
    { id: "id-ayse", name: "Ayşe Yılmaz", role: "cook", group: "kitchen", active: true },
    { id: "id-manager", name: "Selin Kaya", role: "manager", group: "managers", active: true },
  ],
  shifts: [
    shift({ id: "s1", staffId: "id-deniz", serviceDay: "2026-11-09", start: "17:00", end: "01:00", area: "salon", minutes: 480 }),
    shift({ id: "s2", staffId: "id-ece", serviceDay: "2026-11-10", start: "12:00", end: "01:00", area: "terrace", minutes: 780, note: "Inventory" }),
  ],
  totals: {
    byPerson: { "id-deniz": 480, "id-ece": 2820, "id-ayse": 0, "id-manager": 0 },
    byDay: { "2026-11-09": 480, "2026-11-10": 780, "2026-11-11": 0, "2026-11-12": 0, "2026-11-13": 0, "2026-11-14": 0, "2026-11-15": 0 },
  },
  warnings: [{ kind: "week_hours", staffId: "id-ece", shiftIds: ["s2"], minutes: 2820 }],
};
const TEMPLATES = {
  templates: [
    { id: "tp1", name: "Dinner", start: "17:00", end: "01:00", area: "salon", sort: 0, minutes: 480 },
    { id: "tp2", name: "Prep", start: "12:00", end: "17:00", area: "kitchen", sort: 1, minutes: 300 },
  ],
};

function setup(extra: Record<string, unknown> = {}) {
  const { calls } = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/shifts": WEEK,
    "GET /api/shift-templates": TEMPLATES,
    ...extra,
  });
  return { calls, ...renderApp("/staff/schedule") };
}
const bodyOf = (calls: { method: string; path: string; body?: unknown }[], method: string, path: string) =>
  calls.find((c) => c.method === method && c.path === path)?.body;

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Schedule grid", () => {
  it("renders the fixture's person and day totals", async () => {
    setup();
    const deniz = (await screen.findByRole("rowheader", { name: /Deniz Kaya/ })).closest("tr")!;
    expect(within(deniz).getByText("8 h")).toBeTruthy();
    const ece = screen.getByRole("rowheader", { name: /Ece Demir/ }).closest("tr")!;
    expect(within(ece).getByText("47 h")).toBeTruthy();
    const foot = screen.getByRole("rowheader", { name: "Day total" }).closest("tr")!;
    const cells = within(foot).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 3)).toEqual(["8 h", "13 h", "—"]);
    expect(cells.at(-1)).toBe("21 h");
    expect(screen.getByRole("columnheader", { name: /Mon\s*9 Nov/ })).toBeTruthy();
  });

  it("shows the warning summary and puts the warning in the block's name", async () => {
    setup();
    expect(await screen.findByText("Ece Demir: 47 h this week (limit 45)")).toBeTruthy();
    const block = screen.getByRole("button", { name: /12:00–01:00.*Terrace.*47 h this week/ });
    expect(block.className).toMatch(/is-warn/);
  });

  it("links the PDFs in the UI language", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("rowheader", { name: /Deniz Kaya/ });
    expect(screen.getByRole("link", { name: "Download PDF for Deniz Kaya" }).getAttribute("href")).toBe(
      "/api/shifts/pdf/person/id-deniz?week=2026-11-09&lang=en",
    );
    await user.click(screen.getByRole("button", { name: "PDF" }));
    expect(screen.getByRole("link", { name: "Week roster" }).getAttribute("href")).toBe("/api/shifts/pdf/week?week=2026-11-09&lang=en");
    expect(screen.getByRole("link", { name: "All personal PDFs" }).getAttribute("href")).toBe("/api/shifts/pdf/people?week=2026-11-09&lang=en");
  });

  it("tapping an empty cell opens the sheet prefilled; a template's times are POSTed", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "POST /api/shifts": { shift: shift({ id: "s9" }) } });
    await user.click(await screen.findByRole("button", { name: /Add shift for Ayşe Yılmaz, Wednesday 11 November/ }));
    const dlg = await screen.findByRole("dialog", { name: "New shift" });
    expect(within(dlg).getByText(/Ayşe Yılmaz · Wednesday 11 November/)).toBeTruthy();
    expect((within(dlg).getByRole("radio", { name: "Kitchen" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(dlg).getByRole("button", { name: /Prep.*12:00–17:00/ }));
    expect((within(dlg).getByLabelText("Start") as HTMLInputElement).value).toBe("12:00");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(bodyOf(calls, "POST", "/api/shifts")).toEqual({
        staffId: "id-ayse", serviceDay: "2026-11-11", start: "12:00", end: "17:00", area: "kitchen", note: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a 409 shift_overlap names the person", async () => {
    const user = userEvent.setup();
    setup({ "POST /api/shifts": () => reply(409, "shift_overlap") });
    await user.click(await screen.findByRole("button", { name: /Add shift for Deniz Kaya, Thursday 12 November/ }));
    const dlg = await screen.findByRole("dialog", { name: "New shift" });
    await user.click(within(dlg).getByRole("button", { name: /Dinner/ }));
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect((await within(dlg).findByRole("alert")).textContent).toContain("Overlaps another shift for Deniz Kaya");
  });

  it("a keyboard move (M, ArrowRight, Enter) PATCHes the next day", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "PATCH /api/shifts/s1": { shift: shift({ id: "s1" }) } });
    const block = await screen.findByRole("button", { name: /17:00–01:00.*Salon/ });
    block.focus();
    await user.keyboard("m");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status", { name: "Move" }).textContent).toContain("Deniz Kaya, Tuesday 10 November");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bodyOf(calls, "PATCH", "/api/shifts/s1")).toEqual({ staffId: "id-deniz", serviceDay: "2026-11-10" }));
  });

  it("Escape cancels a keyboard move without a request", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const block = await screen.findByRole("button", { name: /17:00–01:00.*Salon/ });
    block.focus();
    await user.keyboard("m{ArrowDown}{Escape}{Enter}");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("the sheet's Move button starts a move; a 409 on the move names the person", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "PATCH /api/shifts/s1": () => reply(409, "shift_overlap") });
    await user.click(await screen.findByRole("button", { name: /17:00–01:00.*Salon/ }));
    const dlg = await screen.findByRole("dialog", { name: "Edit shift" });
    await user.click(within(dlg).getByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: /Move here: Ece Demir, Monday 9 November/ }));
    await waitFor(() => expect(bodyOf(calls, "PATCH", "/api/shifts/s1")).toEqual({ staffId: "id-ece", serviceDay: "2026-11-09" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Overlaps another shift for Ece Demir");
  });

  it("Copy last week reports copied and skipped", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "POST /api/shifts/copy-last-week": { copied: 12, skipped: 1 } });
    await user.click(await screen.findByRole("button", { name: "Copy last week" }));
    expect(await screen.findByText("Copied 12 · skipped 1")).toBeTruthy();
    expect(bodyOf(calls, "POST", "/api/shifts/copy-last-week")).toEqual({ week: "2026-11-09" });
  });

  it("the week picker asks for the next week", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ "GET /api/shifts?week=2026-11-16": { ...WEEK, week: "2026-11-16", shifts: [], warnings: [] } });
    await user.click(await screen.findByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/shifts?week=2026-11-16")).toBe(true));
  });

  it("shows Turkish copy", async () => {
    await setLanguage("tr");
    setup();
    expect(await screen.findByText("Ece Demir: bu hafta 47 sa (sınır 45)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /12:00–01:00.*Teras/ })).toBeTruthy();
  });
});
