import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const shift = (o: Record<string, unknown>) => ({ staffId: "id-waiter", note: null, startAt: "", endAt: "", ...o });
const MINE = {
  weeks: [
    {
      week: "2026-11-09",
      minutes: 780,
      shifts: [
        shift({ id: "a", serviceDay: "2026-11-09", start: "17:00", end: "01:00", area: "salon", minutes: 480 }),
        shift({ id: "b", serviceDay: "2026-11-11", start: "12:00", end: "17:00", area: "terrace", minutes: 300, note: "Wine tasting" }),
      ],
    },
    { week: "2026-11-16", minutes: 0, shifts: [] },
  ],
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

describe("My shifts", () => {
  it("lists this week and next with hours and PDF links", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("waiter", "Deniz Kaya"), "GET /api/me/shifts": MINE });
    renderApp("/staff/my-shifts");
    const thisWeek = await screen.findByRole("region", { name: /This week/ });
    expect(within(thisWeek).getByText("13 h")).toBeTruthy();
    expect(within(thisWeek).getAllByRole("listitem")).toHaveLength(2);
    expect(within(thisWeek).getByText("17:00–01:00")).toBeTruthy();
    expect(within(thisWeek).getByText(/Wine tasting/)).toBeTruthy();
    expect(within(thisWeek).getByText(/Mon 9 Nov/)).toBeTruthy();
    expect(within(thisWeek).getByRole("link", { name: /Download PDF/ }).getAttribute("href")).toBe("/api/me/shifts/pdf?week=2026-11-09&lang=en");
    const next = screen.getByRole("region", { name: /Next week/ });
    expect(within(next).getByText("No shifts this week.")).toBeTruthy();
    expect(within(next).getByRole("link", { name: /Download PDF/ }).getAttribute("href")).toBe("/api/me/shifts/pdf?week=2026-11-16&lang=en");
    expect(screen.getByRole("link", { name: "My shifts" }).getAttribute("aria-current")).toBe("page");
  });
});
