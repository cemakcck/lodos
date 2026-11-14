import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { ordinal } from "../../src/staff/performance/queries";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const WAITER_BREAKDOWN = [
  { key: "rating", points: 40.5, max: 50, value: 4.24 },
  { key: "workload", points: 30.1, max: 35, value: 6.1 },
  { key: "reliability", points: 12.5, max: 15, value: 0.83 },
];
const row = (o: Record<string, unknown>) => ({
  staffId: "w1", name: "Deniz Kaya", role: "waiter", score: 83.1, breakdown: WAITER_BREAKDOWN,
  ratingAvg: 4.2, ratingCount: 12, minutes: 1800, plannedMinutes: 1920, lateShifts: 1, ...o,
});
const RANKING = {
  groups: {
    floor: [
      row({}),
      row({ staffId: "w2", name: "Mert Aydın", score: 70.2 }),
      row({ staffId: "w3", name: "Ece Yıldız", score: null, breakdown: [], ratingAvg: 4.5, ratingCount: 2 }),
    ],
    kitchen: [row({ staffId: "k1", name: "Ali Usta", role: "cook", score: 60 })],
    bar: [],
  },
};
const weeks = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
const PERSON_BASE = {
  ...row({}),
  history: weeks.map((week, i) => ({ week, score: i === 0 ? null : 60 + i })),
  trend: weeks.map((week, i) => ({ week, avg: i === 0 ? null : 4 + i / 10, count: i })),
};
const comment = (id: string, text: string, hidden = false) => ({ id, comment: text, stars: 5, at: "2026-11-10T19:00:00.000Z", hidden });

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await setLanguage("en");
});

const ME = (position: number | null, of = 6) => ({
  score: 83.1,
  breakdown: [
    { key: "rating", points: 40.5, max: 50, value: 4.24 },
    { key: "workload", points: 30.1, max: 35 },
    { key: "reliability", points: 12.5, max: 15, value: 0.83 },
  ],
  ratingAvg: 4.2, ratingCount: 12, minutes: 1800, plannedMinutes: 1920, lateShifts: 1,
  rank: position ? { position, of } : null,
  comments: [{ comment: "Lovely service", stars: 5, at: "2026-11-10T19:00:00.000Z" }],
});

describe("ordinals", () => {
  it("uses proper English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => ordinal(n, "en"))).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"],
    );
  });
});

describe("Ranking", () => {
  it("shows the Floor tab with ranked and unranked rows, then switches tabs", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/performance/ranking?period=week": RANKING });
    const user = userEvent.setup();
    renderApp("/staff/performance");
    const table = await screen.findByRole("table", { name: "Floor ranking" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]!.textContent).toContain("Deniz Kaya");
    expect(rows[1]!.textContent).toContain("83.1");
    expect(rows[2]!.textContent).toContain("2");
    expect(rows[3]!.textContent).toContain("Not enough data yet");
    expect(within(rows[1]!).getByRole("link", { name: "Deniz Kaya" }).getAttribute("href")).toBe("/staff/performance/w1?period=week");
    await user.click(screen.getByRole("button", { name: "Kitchen" }));
    expect(within(screen.getByRole("table", { name: "Kitchen ranking" })).getByText("Ali Usta")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Bar" }));
    expect(screen.getByText("Nobody in this group yet.")).toBeTruthy();
  });

  it("shows a cook's shared rating count as a whole number", async () => {
    const shared = { ...RANKING, groups: { ...RANKING.groups, kitchen: [row({ staffId: "k1", name: "Ali Usta", role: "cook", score: 60, ratingCount: 37.5 })] } };
    mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/performance/ranking?period=week": shared });
    const user = userEvent.setup();
    renderApp("/staff/performance");
    await screen.findByRole("table", { name: "Floor ranking" });
    await user.click(screen.getByRole("button", { name: "Kitchen" }));
    const table = screen.getByRole("table", { name: "Kitchen ranking" });
    expect(table.textContent).toContain("4.2 (38)");
    expect(table.textContent).not.toContain("37.5");
  });

  it("asks for the month, and for a past week with a key", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
    const { calls } = mockFetch({
      "GET /api/auth/me": staffOf("manager"),
      "GET /api/performance/ranking?period=week": RANKING,
      "GET /api/performance/ranking?period=week&key=2026-11-02": RANKING,
      "GET /api/performance/ranking?period=month": RANKING,
      "GET /api/performance/ranking?period=month&key=2026-10": RANKING,
    });
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderApp("/staff/performance");
    await screen.findByRole("table", { name: "Floor ranking" });
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("period=week&key=2026-11-02"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("ranking?period=month"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("period=month&key=2026-10"))).toBe(true));
  });

  it("bounds the period picker to the server's data range", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-13T12:00:00Z") });
    const ranged = { ...RANKING, range: { first: "2026-11", last: "2026-11" } };
    mockFetch({
      "GET /api/auth/me": staffOf("manager"),
      "GET /api/performance/ranking?period=week": ranged,
      "GET /api/performance/ranking?period=week&key=2026-11-02": ranged,
      "GET /api/performance/ranking?period=week&key=2026-10-26": ranged,
      "GET /api/performance/ranking?period=month": ranged,
    });
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderApp("/staff/performance");
    await screen.findByRole("table", { name: "Floor ranking" });
    const prevWeek = () => screen.getByRole("button", { name: "Previous week" }) as HTMLButtonElement;
    await user.click(prevWeek());
    await user.click(prevWeek());
    // The week of 1 November starts on 26 October: the first week with data.
    await waitFor(() => expect(prevWeek().disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("is manager only", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("waiter", "Deniz Kaya"), "GET /api/me/shifts": { weeks: [] } });
    renderApp("/staff/performance");
    await waitFor(() => expect(screen.queryByRole("table", { name: /ranking/ })).toBeNull());
    expect(screen.queryByRole("link", { name: "Performance" })).toBeNull();
  });
});

describe("Person page", () => {
  const state = { comments: [comment("c1", "Wonderful evening"), comment("c2", "Slow drinks", true)] };
  const setup = () => {
    state.comments = [comment("c1", "Wonderful evening"), comment("c2", "Slow drinks", true)];
    return mockFetch({
      "GET /api/auth/me": staffOf("manager"),
      "GET /api/performance/w1?period=week": () => ({ status: 200, body: { ...PERSON_BASE, comments: state.comments } }),
      "POST /api/ratings/c1/hide": () => {
        state.comments = state.comments.map((c) => (c.id === "c1" ? { ...c, hidden: true } : c));
        return { status: 200, body: { id: "c1", commentHidden: true } };
      },
      "POST /api/ratings/c2/unhide": () => {
        state.comments = state.comments.map((c) => (c.id === "c2" ? { ...c, hidden: false } : c));
        return { status: 200, body: { id: "c2", commentHidden: false } };
      },
    });
  };

  it("shows a cook's shared rating count as a whole number", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/performance/k1?period=week": { ...PERSON_BASE, staffId: "k1", name: "Ali Usta", role: "cook", ratingCount: 37.5, comments: [] } });
    renderApp("/staff/performance/k1?period=week");
    expect(await screen.findByText("4.2 (38)")).toBeTruthy();
  });

  it("the breakdown table sums to the score shown", async () => {
    setup();
    renderApp("/staff/performance/w1?period=week");
    const table = await screen.findByRole("table", { name: "Score breakdown" });
    const body = within(table).getAllByRole("row").slice(1, -1);
    const points = body.map((r) => Number(within(r).getAllByRole("cell")[0]!.textContent));
    const total = Number(within(within(table).getAllByRole("row").at(-1)!).getAllByRole("cell")[0]!.textContent);
    expect(points.reduce((a, b) => a + b, 0)).toBeCloseTo(83.1, 5);
    expect(total).toBe(83.1);
    expect(screen.getByText("83.1", { selector: ".pf-score" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Score 83.1 out of 100" })).toBeTruthy();
  });

  it("shows hours against planned, lateness, trend and history tables", async () => {
    setup();
    renderApp("/staff/performance/w1?period=week");
    expect(await screen.findByText("30 h of 32 h planned")).toBeTruthy();
    expect(screen.getByText("1 late shift")).toBeTruthy();
    const trend = screen.getByRole("region", { name: "Rating trend" });
    expect(within(trend).getAllByRole("row")).toHaveLength(9);
    expect(within(screen.getByRole("region", { name: "Points history" })).getAllByRole("row")).toHaveLength(9);
  });

  it("Hide posts to the API and greys the comment; Unhide restores it", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    renderApp("/staff/performance/w1?period=week");
    const items = await screen.findAllByRole("listitem");
    const first = items.find((li) => li.textContent!.includes("Wonderful evening"))!;
    expect(first.className).not.toContain("is-hidden");
    await user.click(within(first).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/ratings/c1/hide")).toBe(true));
    await waitFor(() => {
      const li = screen.getAllByRole("listitem").find((x) => x.textContent!.includes("Wonderful evening"))!;
      expect(li.className).toContain("is-hidden");
      expect(within(li).getByRole("button", { name: "Unhide" })).toBeTruthy();
    });
    const second = screen.getAllByRole("listitem").find((x) => x.textContent!.includes("Slow drinks"))!;
    expect(second.className).toContain("is-hidden");
    await user.click(within(second).getByRole("button", { name: "Unhide" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/ratings/c2/unhide")).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("listitem").find((x) => x.textContent!.includes("Slow drinks"))!.className).not.toContain("is-hidden"));
  });

  it("has no axe violations", async () => {
    setup();
    renderApp("/staff/performance/w1?period=week");
    await screen.findByRole("table", { name: "Score breakdown" });
    const res = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe("My performance", () => {
  const setup = (role: "waiter" | "kitchen", me: unknown) =>
    mockFetch({
      "GET /api/auth/me": staffOf(role, "Deniz Kaya"),
      "GET /api/me/performance?period=week": me,
      "GET /api/me/shifts": { weeks: [] },
    });

  it("says '2nd of 6 waiters' in English and lists comments", async () => {
    setup("waiter", ME(2));
    renderApp("/staff/my-performance");
    expect(await screen.findByText("2nd of 6 waiters")).toBeTruthy();
    expect(screen.getByText("Lovely service")).toBeTruthy();
    // Workload has no `value`: only points and max are shown.
    const table = screen.getByRole("table", { name: "Score breakdown" });
    expect(within(table).getByText("30.1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "My performance" })).toBeTruthy();
  });

  it("says '6 garsondan 2.' in Turkish", async () => {
    await setLanguage("tr");
    setup("waiter", ME(2));
    renderApp("/staff/my-performance");
    expect(await screen.findByText("6 garsondan 2.")).toBeTruthy();
  });

  it("names the caller's own group, with the ablative suffix", async () => {
    await setLanguage("tr");
    setup("kitchen", { ...ME(1, 3), comments: [] });
    renderApp("/staff/my-performance");
    expect(await screen.findByText("3 aşçıdan 1.")).toBeTruthy();
    // Cooks have no comments section.
    expect(screen.queryByText("Misafir yorumları")).toBeNull();
  });

  it("shows a cook's shared rating count as a whole number", async () => {
    setup("kitchen", { ...ME(1, 3), ratingCount: 37.5, comments: [] });
    renderApp("/staff/my-performance");
    expect(await screen.findByText("4.2 (38)")).toBeTruthy();
  });

  it("shows 'Not enough data yet' and no rank when unranked", async () => {
    setup("waiter", { ...ME(null), score: null, breakdown: [] });
    renderApp("/staff/my-performance");
    expect(await screen.findByText("Not enough data yet")).toBeTruthy();
    expect(screen.queryByText(/of \d+ waiters/)).toBeNull();
  });

  it("has no axe violations", async () => {
    setup("waiter", ME(2));
    renderApp("/staff/my-performance");
    await screen.findByText("2nd of 6 waiters");
    const res = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe("Ranking page accessibility", () => {
  it("has no axe violations", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager"), "GET /api/performance/ranking?period=week": RANKING });
    renderApp("/staff/performance");
    await screen.findByRole("table", { name: "Floor ranking" });
    const res = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, "label-content-name-mismatch": { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
