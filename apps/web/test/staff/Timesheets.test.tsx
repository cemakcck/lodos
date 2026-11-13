import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const shift = { id: "sh1", staffId: "p-ayse", serviceDay: "2026-11-10", start: "18:00", end: "02:00", startAt: "", endAt: "", area: "kitchen", note: null, minutes: 480 };
const VIEW = {
  week: "2026-11-09",
  days: DAYS,
  people: [
    {
      staffId: "p-ayse",
      name: "Ayşe Demir",
      role: "cook",
      shifts: [shift],
      entries: [
        { id: "e1", serviceDay: "2026-11-10", in: "2026-11-10T15:05:00.000Z", out: "2026-11-10T23:10:00.000Z", minutes: 485, overtimeMinutes: 30, cost: 12_500, rate: 15_000, edited: true, forgot: false },
      ],
      minutes: 485,
      overtimeMinutes: 30,
      cost: 12_500,
    },
  ],
};
const CLOCK_PEOPLE = [
  { id: "p-ayse", name: "Ayşe Demir", clockedIn: false },
  { id: "p-mert", name: "Mert Aydın", clockedIn: false },
];

function setup(extra: Record<string, unknown> = {}) {
  const { calls } = mockFetch({
    "GET /api/auth/me": staffOf("manager"),
    "GET /api/timesheets": VIEW,
    "GET /api/clock/people": CLOCK_PEOPLE,
    ...extra,
  });
  return { calls, ...renderApp("/staff/timesheets") };
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

describe("Timesheets", () => {
  it("shows the planned shift beside the clocked entry, with edited badge, overtime and cost", async () => {
    setup();
    const table = await screen.findByRole("table", { name: /Ayşe Demir/ });
    const row = within(table).getByRole("button", { name: /Edit Ayşe Demir/ }).closest("tr")!;
    expect(row.textContent).toContain("18:00–02:00");
    // 15:05 and 23:10 UTC are 18:05 and 02:10 Istanbul.
    expect(row.textContent).toContain("18:05–02:10");
    expect(row.textContent).toContain("8 h 5 min");
    expect(row.textContent).toContain("30 min");
    expect(within(row).getByText("edited")).toBeTruthy();
    expect(row.textContent).toMatch(/125/);
  });

  it("the week picker asks for another week", async () => {
    const { calls } = setup({ "GET /api/timesheets?week=2026-11-16": { ...VIEW, week: "2026-11-16", people: [] } });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: /Ayşe/ });
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/timesheets?week=2026-11-16")).toBe(true));
  });

  it("the edit dialog requires a reason, then PUTs the entry", async () => {
    const { calls } = setup({ "PUT /api/timesheets/entries/e1": { ok: true } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Edit Ayşe Demir/ }));
    const dialog = screen.getByRole("dialog", { name: /Edit entry for Ayşe Demir/ });
    expect((within(dialog).getByLabelText("Clock in") as HTMLInputElement).value).toBe("2026-11-10T18:05");
    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));
    expect(within(dialog).getByText("Enter a reason.")).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    await user.type(within(dialog).getByLabelText(/Reason/), "Forgot to clock out");
    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      in: "2026-11-10T15:05:00.000Z",
      out: "2026-11-10T23:10:00.000Z",
      reason: "Forgot to clock out",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Entry for Ayşe Demir saved.")).toBeTruthy();
  });

  it("Add entry posts the person, the Istanbul times and the reason", async () => {
    const { calls } = setup({ "POST /api/timesheets/entries": { status: 201, body: { id: "e9" } } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    const dialog = screen.getByRole("dialog", { name: "Add a clock entry" });
    await within(dialog).findByRole("option", { name: "Mert Aydın" });
    await user.selectOptions(within(dialog).getByLabelText("Person"), "p-mert");
    await user.type(within(dialog).getByLabelText("Clock in"), "2026-11-11T18:00");
    await user.type(within(dialog).getByLabelText("Clock out"), "2026-11-12T01:30");
    await user.type(within(dialog).getByLabelText(/Reason/), "Missed punch");
    await user.click(within(dialog).getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/timesheets/entries")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      staffId: "p-mert",
      in: "2026-11-11T15:00:00.000Z",
      out: "2026-11-11T22:30:00.000Z",
      reason: "Missed punch",
    });
  });

  it("has no axe violations, with the dialog open", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("table", { name: /Ayşe/ });
    // Colour contrast needs real layout (covered by the Playwright axe run). The Shell's avatar button, whose
    // name is the person's name rather than their initials, is the Shell's own and not under test here.
    const run = () => axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Edit Ayşe Demir/ }));
    await screen.findByRole("dialog");
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
