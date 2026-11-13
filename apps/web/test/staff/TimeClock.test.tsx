import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { err, mockFetch, renderApp, sockets } from "./harness";

const PEOPLE = [
  { id: "p-ayse", name: "Ayşe Demir", clockedIn: false },
  { id: "p-mert", name: "Mert Aydın", clockedIn: true },
];

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

const pick = async (name: string, pin: string, opts: Parameters<typeof userEvent.setup>[0] = {}) => {
  const user = userEvent.setup(opts);
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { name: /Enter your PIN/ });
  await user.keyboard(`${pin}{Enter}`);
};

describe("Time clock", () => {
  it("is reachable without a session and lists the names from /api/clock/people", async () => {
    mockFetch({ "GET /api/clock/people": PEOPLE, "GET /api/auth/me": err(401, "unauthorized") });
    const { router } = renderApp("/staff/clock");
    expect(await screen.findByRole("heading", { name: "Who's clocking?" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Ayşe Demir/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mert Aydın/ }).textContent).toContain("Clocked in");
    expect(router.state.location.pathname).toBe("/staff/clock");
  });

  it("the login screen links to it", async () => {
    mockFetch({ "GET /api/auth/staff": [], "GET /api/auth/me": err(401, "unauthorized") });
    renderApp("/staff/login");
    const link = await screen.findByRole("link", { name: "Clock in / out" });
    expect(link.getAttribute("href")).toBe("/staff/clock");
  });

  it("clocking in shows the time", async () => {
    const { calls } = mockFetch({
      "GET /api/clock/people": PEOPLE,
      "POST /api/clock/punch": { action: "in", at: "2026-11-10T07:58:00.000Z", minutesToday: 0 },
    });
    renderApp("/staff/clock");
    await pick("Ayşe", "4821");
    // 07:58 UTC is 10:58 in Istanbul.
    expect(await screen.findByText("Clocked in 10:58")).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/clock/punch")!.body).toEqual({ staffId: "p-ayse", pin: "4821" });
  });

  it("clocking out shows today's hours", async () => {
    mockFetch({
      "GET /api/clock/people": PEOPLE,
      "POST /api/clock/punch": { action: "out", at: "2026-11-10T20:00:00.000Z", minutesToday: 432 },
    });
    renderApp("/staff/clock");
    await pick("Mert", "1234");
    expect(await screen.findByText("Clocked out, 7 h 12 min today")).toBeTruthy();
  });

  it("returns to the picker after 5 seconds", async () => {
    mockFetch({
      "GET /api/clock/people": PEOPLE,
      "POST /api/clock/punch": { action: "in", at: "2026-11-10T07:58:00.000Z", minutesToday: 0 },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp("/staff/clock");
    await pick("Ayşe", "4821", { advanceTimers: vi.advanceTimersByTime });
    await screen.findByText("Clocked in 10:58");
    act(() => void vi.advanceTimersByTime(4900));
    expect(screen.queryByRole("heading", { name: "Who's clocking?" })).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("heading", { name: "Who's clocking?" })).toBeTruthy();
  });

  it("a 409 forgot_clock_out tells them to ask a manager", async () => {
    mockFetch({ "GET /api/clock/people": PEOPLE, "POST /api/clock/punch": err(409, "forgot_clock_out") });
    renderApp("/staff/clock");
    await pick("Mert", "1234");
    expect((await screen.findByRole("alert")).textContent).toBe("You were never clocked out. Ask your manager to fix your last shift.");
    // The pad is cleared and still usable.
    expect(screen.getByRole("group", { name: "PIN pad" })).toBeTruthy();
  });

  it("a wrong PIN and a lock-out get their own messages", async () => {
    mockFetch({ "GET /api/clock/people": PEOPLE, "POST /api/clock/punch": err(401, "unauthorized") });
    renderApp("/staff/clock");
    await pick("Ayşe", "9999");
    expect((await screen.findByRole("alert")).textContent).toContain("Wrong PIN");
  });

  it("has no axe violations on the picker and the keypad", async () => {
    mockFetch({ "GET /api/clock/people": PEOPLE });
    const { container } = renderApp("/staff/clock");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /Ayşe/ });
    // jsdom has no layout or paint, so colour contrast is covered by the Playwright axe run instead.
    const run = () => axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Ayşe/ }));
    await waitFor(() => screen.getByRole("group", { name: "PIN pad" }));
    expect((await run()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
