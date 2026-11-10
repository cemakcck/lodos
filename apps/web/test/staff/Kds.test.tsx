import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { Kds, KDS_BACKSTOP_MS } from "../../src/staff/kds/Kds";
import { SOUND_KEY } from "../../src/staff/kds/useChime";
import type { KdsSnapshot, KdsTicket } from "../../src/staff/kds/types";
import { mockFetch, reply, sockets, staffOf } from "./harness";

// The server's clock: 21:42:08 Istanbul. The device clock is deliberately a year off.
const SERVER_NOW = Date.parse("2026-11-10T18:42:08.000Z");
const DEVICE_NOW = Date.parse("2025-03-01T09:00:00.000Z");
let device = DEVICE_NOW;
const clock = () => device;
const ago = (min: number, sec = 0) => new Date(SERVER_NOW - min * 60_000 - sec * 1000).toISOString();
const n = (en: string, tr = en) => ({ en, tr });

const tk = (id: string, tableName: string, sentAt: string, items: KdsTicket["items"], over: Partial<KdsTicket> = {}): KdsTicket => ({
  id,
  orderId: `o-${id}`,
  tableId: `t-${tableName}`,
  tableName,
  station: "kitchen",
  status: "new",
  serverName: "Deniz",
  covers: 2,
  sentAt,
  startedAt: null,
  readyAt: null,
  servedAt: null,
  ageState: "ok",
  items,
  ...over,
});
const item = (index: number, en: string, tr = en, qty = 1) => ({
  index, name: n(en, tr), qty, options: [], note: null, allergens: [], allergyFlag: false, checked: false,
});

const T12 = tk("a", "T12", ago(17, 20), [item(0, "Levrek crudo", "Levrek crudo", 2), item(1, "Dry-aged ribeye", "Dinlendirilmiş antrikot")]);
const B2 = tk("b", "B2", ago(9, 5), [item(0, "İzgara köfte", "Izgara köfte")]);
const T9 = tk("c", "T9", ago(0, 24), [item(0, "Burnt cheesecake")], { serverName: null });

const snap = (tickets: KdsTicket[], over: Partial<KdsSnapshot> = {}): KdsSnapshot => ({
  tickets,
  allDay: [{ itemName: n("Levrek crudo"), qty: 2 }, { itemName: n("Dry-aged ribeye", "Dinlendirilmiş antrikot"), qty: 1 }],
  eightySix: [
    { itemId: "lamb", name: n("Lamb shoulder", "Kuzu omuz"), soldOut: false, remaining: 2 },
    { itemId: "oys", name: n("Oysters", "İstiridye"), soldOut: true, remaining: null },
  ],
  stats: { open: tickets.length, items: 4, avgTicketMs: 700_000, late: 1 },
  now: new Date(SERVER_NOW).toISOString(),
  thresholds: { warnMin: 8, lateMin: 15 },
  ...over,
});

let routes: Record<string, unknown>;
function setup(station: "kitchen" | "bar" = "kitchen", active = [T12, B2, T9]) {
  routes = mockFetch({
    "GET /api/auth/me": staffOf(station),
    [`GET /api/kds/${station}?tab=active`]: snap(active),
    [`GET /api/kds/${station}?tab=held`]: snap([]),
    [`GET /api/kds/${station}?tab=done`]: snap([]),
  }).routes as Record<string, unknown>;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: `/staff/${station}`, element: <Kds station={station} clock={clock} /> }], {
    initialEntries: [`/staff/${station}`],
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return qc;
}

/** Holds a fetch to `match` until released, to observe optimistic state. */
function gateFetch(match: string) {
  const inner = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(match)) await gate;
    return inner(input, init);
  });
  return () => release();
}

class FakeAudio {
  static made: FakeAudio[] = [];
  state = "running";
  currentTime = 0;
  destination = {};
  oscillators = 0;
  constructor() {
    FakeAudio.made.push(this);
  }
  createOscillator() {
    this.oscillators += 1;
    return { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
  }
  createGain() {
    const g = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
    return g;
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(async () => {
  sockets.length = 0;
  device = DEVICE_NOW;
  FakeAudio.made = [];
  localStorage.clear();
  vi.stubGlobal("AudioContext", FakeAudio);
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  await setLanguage("en");
});

const card = (name: RegExp) => screen.findByRole("article", { name });

describe("Kds board", () => {
  it("lays out the toolbar, stats, tickets oldest first, All day and 86'd tonight", async () => {
    setup();
    expect(await card(/Ticket T12, late/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Kitchen· Hot line");
    expect(screen.getByRole("button", { name: /Active 3/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Ticket T12", "Ticket B2", "Ticket T9",
    ]);
    expect(screen.getByText("open tickets").textContent).toBe("3open tickets");
    expect(screen.getByText("over 15 min").className).toBe("warn");
    expect(screen.getByText("11:40")).toBeTruthy();
    expect(within(screen.getByRole("complementary")).getByText("Lamb shoulder: 2 left")).toBeTruthy();
    expect(within(screen.getByRole("complementary")).getByText("Oysters: out")).toBeTruthy();
    expect(screen.getByText("QR order")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("backstop: refetches the active tickets every 30 s while the live socket is not connected", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      setup();
      await card(/Ticket T12/);
      const fetches = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).endsWith("tab=active")).length;
      const before = fetches();
      routes["GET /api/kds/kitchen?tab=active"] = snap([B2, T9]);
      await act(async () => { vi.advanceTimersByTime(KDS_BACKSTOP_MS); });
      await waitFor(() => expect(fetches()).toBe(before + 1));
      await waitFor(() => expect(screen.queryByRole("article", { name: /Ticket T12/ })).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("times tickets by server time even when the device clock is wrong, ticking every second", async () => {
    setup();
    const t12 = await card(/Ticket T12/);
    expect(within(t12).getByText("17:20")).toBeTruthy();
    device += 1000;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(within(t12).getByText("17:21")).toBeTruthy();
  });

  it("a refetch with a slightly earlier server time never moves a timer backwards", async () => {
    setup();
    const t12 = await card(/Ticket T12/);
    expect(within(t12).getByText("17:20")).toBeTruthy();
    // Same device time, server now 900 ms earlier (a slow response): the held offset stays.
    routes["GET /api/kds/kitchen?tab=active"] = snap([T12, B2, T9], { now: new Date(SERVER_NOW - 900).toISOString() });
    act(() => sockets[0]!.emit("event", { type: "ticket.updated", ids: ["a"], tableId: "t-T12" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(within(t12).getByText("17:20")).toBeTruthy();
    // A sample that is ahead is accepted at once (proves the refetches above really ran).
    routes["GET /api/kds/kitchen?tab=active"] = snap([T12, B2, T9], { now: new Date(SERVER_NOW + 3000).toISOString() });
    act(() => sockets[0]!.emit("event", { type: "ticket.updated", ids: ["a"], tableId: "t-T12" }));
    await waitFor(() => expect(within(t12).getByText("17:23")).toBeTruthy());
  });

  it("after a reload with sound remembered, shows 'tap to activate' until a gesture starts the audio", async () => {
    localStorage.setItem(SOUND_KEY, "on");
    setup();
    await card(/Ticket T12/);
    expect(screen.queryByRole("button", { name: "Enable sound for new tickets" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sound on, tap to activate" })).toBeTruthy();
    expect(FakeAudio.made).toHaveLength(0);
    fireEvent.pointerDown(document.body);
    expect(FakeAudio.made).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sound on, tap to activate" })).toBeNull());
  });

  it("chimes once and announces when a ticket.created brings a new ticket", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket T12/);
    await user.click(screen.getByRole("button", { name: "Enable sound for new tickets" }));
    expect(localStorage.getItem(SOUND_KEY)).toBe("on");
    expect(screen.queryByRole("button", { name: "Enable sound for new tickets" })).toBeNull();
    const audio = FakeAudio.made[0]!;

    const T4 = tk("d", "T4", new Date(SERVER_NOW + 5000).toISOString(), [item(0, "Octopus")]);
    routes["GET /api/kds/kitchen?tab=active"] = snap([T12, B2, T9, T4], { now: new Date(SERVER_NOW + 6000).toISOString() });
    act(() => sockets[0]!.emit("event", { type: "ticket.created", ids: ["d"], tableId: "t-T4" }));
    await card(/Ticket T4/);
    await waitFor(() => expect(audio.oscillators).toBe(2));
    expect(screen.getByText("New ticket T4")).toBeTruthy();

    // An update that changes nothing new does not chime again.
    act(() => sockets[0]!.emit("event", { type: "ticket.updated", ids: ["a"], tableId: "t-T12" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(audio.oscillators).toBe(2);
  });

  it("does not chime for a recalled ticket coming back", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket T12/);
    await user.click(screen.getByRole("button", { name: "Enable sound for new tickets" }));
    const old = tk("z", "T3", ago(30), [item(0, "Octopus")], { status: "started" });
    routes["POST /api/kds/kitchen/recall"] = { ticket: old };
    routes["GET /api/kds/kitchen?tab=active"] = snap([old, T12, B2, T9]);
    await user.click(screen.getByRole("button", { name: "Recall the last bumped ticket" }));
    await card(/Ticket T3/);
    expect(screen.getByText("T3 is back on the board")).toBeTruthy();
    expect(FakeAudio.made[0]!.oscillators).toBe(0);
  });

  it("ticks an item off at once and rolls it back on error", async () => {
    const user = userEvent.setup();
    setup();
    const t12 = await card(/Ticket T12/);
    routes["POST /api/tickets/a/items/1/toggle"] = () => reply(500, "internal");
    const release = gateFetch("/toggle");
    await user.click(within(t12).getByText("Dry-aged ribeye"));
    const box = within(t12).getAllByRole("checkbox")[1]!;
    expect(box.getAttribute("aria-checked")).toBe("true");
    // The follow-up refetch fails too, so only the rollback can restore the box.
    routes["GET /api/kds/kitchen?tab=active"] = () => reply(503, "unavailable");
    release();
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("false"));
    expect(within(t12).getByText("That didn't go through. Try again.")).toBeTruthy();
  });

  it("bump removes the ticket at once; a 409 brings it back with a message", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket B2/);
    routes["POST /api/tickets/b/bump"] = () => reply(409, "conflict");
    const release = gateFetch("/bump");
    await user.click(screen.getByRole("button", { name: "Bump B2" }));
    expect(screen.queryByRole("article", { name: /Ticket B2/ })).toBeNull();
    expect(screen.getByText("open tickets").textContent).toBe("2open tickets");
    release();
    const b2 = await card(/Ticket B2/);
    expect(within(b2).getByText("This ticket just changed. Refreshing…")).toBeTruthy();
  });

  it("a refetch during a pending bump does not bring the ticket back", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket B2/);
    routes["POST /api/tickets/b/bump"] = { ticket: { ...B2, status: "ready" } };
    const release = gateFetch("/bump");
    await user.click(screen.getByRole("button", { name: "Bump B2" }));
    // A live event refetches the board before the bump has committed: the server still lists B2.
    act(() => sockets[0]!.emit("event", { type: "ticket.updated", ids: ["a"], tableId: "t-T12" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("article", { name: /Ticket B2/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Active 2/ })).toBeTruthy();
    routes["GET /api/kds/kitchen?tab=active"] = snap([T12, T9]);
    release();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(screen.queryByRole("article", { name: /Ticket B2/ })).toBeNull();
  });

  it("search filters by table or dish, ignoring case and Turkish diacritics; / focuses it", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket T12/);
    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Find table or dish" });
    expect(document.activeElement).toBe(search);
    await user.keyboard("kofte");
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")?.split(",")[0])).toEqual(["Ticket B2"]);
    await user.clear(search);
    await user.type(search, "t12");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No tickets match “zzz”.")).toBeTruthy();
  });

  it("disables Recall while it is pending and says when there is nothing to recall", async () => {
    const user = userEvent.setup();
    setup();
    await card(/Ticket T12/);
    routes["POST /api/kds/kitchen/recall"] = () => reply(404, "not_found");
    const release = gateFetch("/recall");
    const btn = screen.getByRole("button", { name: "Recall the last bumped ticket" });
    await user.click(btn);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    release();
    expect(await screen.findByText("Nothing to recall")).toBeTruthy();
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });

  it("the bar board fetches the bar station and switches tabs", async () => {
    const user = userEvent.setup();
    setup("bar", [tk("x", "B2", ago(2), [item(0, "Lodos Negroni")], { station: "bar" })]);
    expect(await card(/Ticket B2/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bar");
    await user.click(screen.getByRole("button", { name: /Held/ }));
    expect(await screen.findByText("No tickets on hold.")).toBeTruthy();
  });

  it("speaks Turkish", async () => {
    await setLanguage("tr");
    setup();
    expect(await card(/Fiş T12, gecikti/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mutfak· Sıcak hat");
    expect(screen.getByText("Kuzu omuz: 2 kaldı")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Masa veya yemek ara" })).toBeTruthy();
  });
});
