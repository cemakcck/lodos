import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { divide, formatTRY } from "@lodos/shared";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import type { SplitView, SplitUnit, ShareView } from "../../src/staff/close/types";
import { mockFetch, renderApp, sockets, staffOf } from "./harness";

const AT = "2026-11-10T21:40:00.000Z";
const n = (en: string, tr = en) => ({ en, tr });
const unit = (ref: string, name: string, amount: number, over: Partial<SplitUnit> = {}): SplitUnit => ({
  ref,
  lineRef: ref.split(":").slice(0, 2).join(":"),
  name: n(name),
  options: [],
  unitAmount: amount,
  station: "kitchen",
  vatRate: 10,
  comp: null,
  labels: [],
  frozen: false,
  ...over,
});
const UNITS: SplitUnit[] = [
  unit("o1:0:0", "Burrata, heirloom tomato", 54000),
  unit("o1:1:0", "Lodos Negroni", 52000, { station: "bar", vatRate: 20 }),
  unit("o1:1:1", "Lodos Negroni", 52000, { station: "bar", vatRate: 20 }),
  unit("o1:2:0", "Dry-aged ribeye, 300 g", 245000),
];
const TOTAL = 403000;
const LABELS = "ABCDEFGHIJKLMNOPQRST".split("");
type Paid = Record<string, { method: "card" | "cash"; amount: number }>;
const paymentOf = (p?: { method: "card" | "cash"; amount: number }) => (p ? { ...p, at: AT, last4: p.method === "card" ? "4242" : null } : null);

const base = { checkId: "c1", tableName: "T4", status: "open" as const, total: TOTAL };

const fullView = (): SplitView => ({
  ...base,
  mode: "full",
  count: 1,
  locked: false,
  units: UNITS,
  shares: [{ label: "A", amount: TOTAL, units: UNITS.map((u) => ({ ref: u.ref, part: u.unitAmount, parts: 1 })), payment: null }],
  unassigned: { count: 0, amount: 0 },
  paidCount: 0,
  left: TOTAL,
});

const evenView = (count: number, paid: Paid = {}): SplitView => {
  const paidSum = Object.values(paid).reduce((s, p) => s + p.amount, 0);
  const labels = LABELS.slice(0, count);
  const amounts = divide(TOTAL - paidSum, labels.filter((l) => !paid[l]).length);
  let i = 0;
  const locked = Object.keys(paid).length > 0;
  return {
    ...base,
    mode: "even",
    count,
    locked,
    units: UNITS.map((u) => ({ ...u, frozen: locked })),
    shares: labels.map((label) => ({ label, amount: paid[label]?.amount ?? amounts[i++]!, units: [], payment: paymentOf(paid[label]) })),
    unassigned: { count: 0, amount: 0 },
    paidCount: Object.keys(paid).length,
    left: TOTAL - paidSum,
  };
};

const itemsView = (count: number, assign: Record<string, string[]>, paid: Paid = {}): SplitView => {
  const labels = LABELS.slice(0, count);
  const units = UNITS.map((u) => {
    const ls = assign[u.ref] ?? [];
    return { ...u, labels: ls, frozen: ls.some((l) => paid[l]) };
  });
  const parts = new Map<string, ShareView["units"]>();
  let unassigned = { count: 0, amount: 0 };
  for (const u of units) {
    if (u.labels.length === 0) {
      unassigned = { count: unassigned.count + 1, amount: unassigned.amount + u.unitAmount };
      continue;
    }
    const pieces = divide(u.unitAmount, u.labels.length);
    u.labels.forEach((l, i) => parts.set(l, [...(parts.get(l) ?? []), { ref: u.ref, part: pieces[i]!, parts: u.labels.length }]));
  }
  const paidSum = Object.values(paid).reduce((s, p) => s + p.amount, 0);
  return {
    ...base,
    mode: "items",
    count,
    locked: Object.keys(paid).length > 0,
    units,
    shares: labels.map((label) => {
      const own = parts.get(label) ?? [];
      return { label, amount: paid[label]?.amount ?? own.reduce((s, p) => s + p.part, 0), units: own, payment: paymentOf(paid[label]) };
    }),
    unassigned,
    paidCount: Object.keys(paid).length,
    left: TOTAL - paidSum,
  };
};

const floor = (covers: number | null) => ({
  now: AT,
  rooms: [{ id: "salon", name: "Salon" }],
  tables: [
    {
      id: "t4", name: "T4", roomId: "salon", shape: "round", x: 0, y: 0, w: 76, h: 76, capacity: 4, sectionStaffId: "id-waiter",
      serverStaffId: "id-waiter", serverInitials: "D", state: "seated", covers, seatedAt: AT, checkId: "c1", paying: null,
    },
  ],
  chips: [],
  stats: { seated: 1, totalTables: 1, covers: covers ?? 0, avgTurnMs: 0, openChecksTotal: TOTAL },
});

const tableCheck = (billMethod: "card" | "cash" | null) => ({
  table: { id: "t4", name: "T4", capacity: 4, sectionStaffId: "id-waiter" },
  calls: [],
  check: { id: "c1", covers: 3, openedAt: AT, serverStaffId: "id-waiter", serverName: "Deniz Kaya", billRequestedAt: billMethod ? AT : null, billMethod },
  food: [],
  drinks: [],
  totals: { food: 0, drinks: 0, total: TOTAL },
});

let calls: ReturnType<typeof mockFetch>["calls"];
/** A stateful split API: GET answers what the last PUT stored; the PUT applies the body like the server would. */
function setup(initial: SplitView, extra: Record<string, unknown> = {}, covers: number | null = 3) {
  let current = initial;
  const routes: Record<string, unknown> = {
    "GET /api/auth/me": staffOf("waiter", "Deniz Kaya"),
    "GET /api/floor": floor(covers),
    "GET /api/checks/c1/split": () => ({ status: 200, body: current }),
    "PUT /api/checks/c1/split": (body: unknown) => {
      const b = body as { mode: string; count?: number; assignments?: { unit: string; labels: string[] }[] };
      current =
        b.mode === "full"
          ? fullView()
          : b.mode === "even"
            ? evenView(b.count!)
            : itemsView(b.count!, Object.fromEntries((b.assignments ?? []).map((a) => [a.unit, a.labels])));
      return { status: 200, body: current };
    },
    ...extra,
  };
  const m = mockFetch(routes);
  calls = m.calls;
  const app = renderApp("/staff/check/c1/close");
  return { ...app, routes: m.routes, set: (v: SplitView) => (current = v) };
}

const puts = () => calls.filter((c) => c.method === "PUT" && c.path === "/api/checks/c1/split").map((c) => c.body);
const cards = () => screen.getAllByRole("article");
const card = (label: string) => screen.getByRole("article", { name: `Guest ${label}` });
const amountOf = (el: HTMLElement) => within(el).getByTestId("share-amount").textContent;
const money = (k: number) => formatTRY(k, "en");

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("CloseView", () => {
  it("shows the header with the table and the check total, and the three modes", async () => {
    setup(fullView());
    expect(await screen.findByRole("heading", { level: 1, name: /Close check · T4/ })).toBeTruthy();
    expect(screen.getByTestId("check-total").textContent).toBe(money(TOTAL));
    const modes = screen.getByRole("radiogroup", { name: "How to pay" });
    expect(within(modes).getAllByRole("radio").map((r) => r.textContent)).toEqual(["In full", "Evenly", "By item"]);
    expect(within(modes).getByRole("radio", { name: "In full" }).getAttribute("aria-checked")).toBe("true");
  });

  it("In full: Take payment shows the total, closes by the chosen method and goes back to the floor", async () => {
    const { router } = setup(fullView(), { "POST /api/checks/c1/close": { check: { id: "c1", tableId: "t4", status: "paid" } } });
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, ${money(TOTAL)}` }));
    const dialog = screen.getByRole("dialog", { name: "Close check · T4" });
    expect(within(dialog).getByTestId("close-total").textContent).toBe(money(TOTAL));
    expect(within(dialog).getByTestId("close-total").className).toContain("font-mono");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Cash" }));
    await userEvent.click(within(dialog).getByRole("button", { name: `Close check, ${money(TOTAL)} by cash` }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/floor"));
    expect(calls.find((c) => c.path === "/api/checks/c1/close")?.body).toEqual({ method: "cash", amount: TOTAL });
  });

  it("In full: a 409 amount_changed shows the new total and the next try confirms it", async () => {
    let attempt = 0;
    const { router } = setup(fullView(), {
      "POST /api/checks/c1/close": () => {
        attempt += 1;
        if (attempt === 1) return { status: 409, body: { error: { code: "amount_changed", message: "changed", details: { amount: 350000 } } } };
        return { status: 200, body: { check: { id: "c1", tableId: "t4", status: "paid" } } };
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, ${money(TOTAL)}` }));
    const dialog = screen.getByRole("dialog", { name: "Close check · T4" });
    await userEvent.click(within(dialog).getByRole("button", { name: `Close check, ${money(TOTAL)} by card` }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(`The amount changed to ${money(350000)}`));
    expect(within(dialog).getByTestId("close-total").textContent).toBe(money(350000));
    await userEvent.click(within(dialog).getByRole("button", { name: `Close check, ${money(350000)} by card` }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/floor"));
    expect(calls.filter((c) => c.path === "/api/checks/c1/close").map((c) => c.body)).toEqual([
      { method: "card", amount: TOTAL },
      { method: "card", amount: 350000 },
    ]);
  });

  it("the pay dialog traps focus, closes on Escape and gives focus back", async () => {
    setup(fullView());
    const opener = await screen.findByRole("button", { name: /^Take payment/ });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Evenly starts at the covers and shows the server's share amounts; changing the count sends PUT even", async () => {
    setup(fullView());
    await userEvent.click(await screen.findByRole("radio", { name: "Evenly" }));
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(puts()[0]).toEqual({ mode: "even", count: 3 });
    const expected = evenView(3).shares.map((s) => money(s.amount));
    expect(cards().map(amountOf)).toEqual(expected);
    expect(screen.getByRole("radio", { name: "Evenly" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("guest-count").textContent).toBe("3");

    await userEvent.click(screen.getByRole("button", { name: "More guests" }));
    expect(screen.getByTestId("guest-count").textContent).toBe("4");
    await waitFor(() => expect(puts()).toContainEqual({ mode: "even", count: 4 }));
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(cards().map(amountOf)).toEqual(evenView(4).shares.map((s) => money(s.amount)));
    expect(screen.getByTestId("progress").textContent).toBe(`0 of 4 paid · ${money(TOTAL)} left`);
  });

  it("Evenly debounces quick steps into one PUT and starts at 2 without covers", async () => {
    setup(fullView(), {}, null);
    await userEvent.click(await screen.findByRole("radio", { name: "Evenly" }));
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(puts()).toEqual([{ mode: "even", count: 2 }]);
    const more = screen.getByRole("button", { name: "More guests" });
    await userEvent.click(more);
    await userEvent.click(more);
    await userEvent.click(more);
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(puts()).toEqual([{ mode: "even", count: 2 }, { mode: "even", count: 5 }]);
    expect((screen.getByRole("button", { name: "Fewer guests" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("By item: select a unit, tap letters, and each change PUTs the full assignments", async () => {
    setup(itemsView(2, { "o1:2:0": ["A"] }));
    const banner = await screen.findByTestId("unassigned");
    expect(banner.textContent).toBe(`3 items not assigned · ${money(54000 + 104000)}`);
    // Lines with qty > 1 are expanded into units.
    expect(screen.getAllByRole("button", { name: /^Lodos Negroni/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /^Burrata/ }));
    expect(screen.getByRole("button", { name: /^Burrata/ }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Guest A" }));
    await userEvent.click(screen.getByRole("button", { name: "Guest B" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[0]).toEqual({ mode: "items", count: 2, assignments: [{ unit: "o1:0:0", labels: ["A"] }, { unit: "o1:2:0", labels: ["A"] }] });
    expect(puts()[1]).toEqual({ mode: "items", count: 2, assignments: [{ unit: "o1:0:0", labels: ["A", "B"] }, { unit: "o1:2:0", labels: ["A"] }] });
    await waitFor(() => expect(screen.getByTestId("unassigned").textContent).toBe(`2 items not assigned · ${money(104000)}`));
    // The share card lists the part with its fraction.
    expect(within(card("B")).getByText("½ Burrata, heirloom tomato")).toBeTruthy();
    expect(amountOf(card("A"))).toBe(money(27000 + 245000));
    expect(screen.getByRole("button", { name: "Guest A" }).getAttribute("aria-pressed")).toBe("true");

    // Tapping a letter again takes it off.
    await userEvent.click(screen.getByRole("button", { name: "Guest A" }));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2]).toEqual({ mode: "items", count: 2, assignments: [{ unit: "o1:0:0", labels: ["B"] }, { unit: "o1:2:0", labels: ["A"] }] });
  });

  it("every pay dialog preselects the method the guest asked for, with the note", async () => {
    setup(fullView(), { "GET /api/tables/t4/check": tableCheck("cash") });
    await waitFor(() => expect(calls.some((c) => c.path === "/api/tables/t4/check")).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, ${money(TOTAL)}` }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Cash" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByText("The guest asked to pay by cash.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    // A share's dialog too.
    await userEvent.click(screen.getByRole("radio", { name: "By item" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Burrata/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guest A" }));
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, Guest A, ${money(54000)}` }));
    dialog = screen.getByRole("dialog", { name: "Take payment · Guest A" });
    expect(within(dialog).getByRole("radio", { name: "Cash" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByText("The guest asked to pay by cash.")).toBeTruthy();
  });

  it("without a requested method, the dialog starts on Card and shows no note", async () => {
    setup(fullView(), { "GET /api/tables/t4/check": tableCheck(null) });
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, ${money(TOTAL)}` }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Card" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).queryByText(/asked to pay/)).toBeNull();
  });

  it("By item: Remove guest drops the last letter only while it is unpaid and empty, never below 2", async () => {
    const { set, qc } = setup(itemsView(3, { "o1:0:0": ["C"] }));
    const remove = await screen.findByRole("button", { name: "Remove Guest C" });
    expect((remove as HTMLButtonElement).disabled).toBe(true); // C has Burrata
    set(itemsView(3, { "o1:0:0": ["A"] }));
    await act(() => qc.invalidateQueries({ queryKey: ["split"] }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Remove Guest C" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Remove Guest C" }));
    await waitFor(() => expect(puts()).toEqual([{ mode: "items", count: 2, assignments: [{ unit: "o1:0:0", labels: ["A"] }] }]));
    await waitFor(() => expect(cards()).toHaveLength(2));
    // Two letters is the floor.
    expect((screen.getByRole("button", { name: "Remove Guest B" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("By item: a paid last letter can't be removed", async () => {
    setup(itemsView(3, { "o1:0:0": ["A"] }, { C: { method: "card", amount: 0 } }));
    expect(((await screen.findByRole("button", { name: "Remove Guest C" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("By item: + Guest adds a letter", async () => {
    setup(itemsView(2, {}));
    await userEvent.click(await screen.findByRole("button", { name: "Add a guest" }));
    await waitFor(() => expect(puts()[0]).toEqual({ mode: "items", count: 3, assignments: [] }));
    await waitFor(() => expect(cards()).toHaveLength(3));
  });

  it("Pay: Take payment on a share posts its amount; a 409 amount_changed shows and confirms the new amount", async () => {
    const view = itemsView(2, { "o1:0:0": ["A", "B"], "o1:1:0": ["A"], "o1:1:1": ["B"], "o1:2:0": ["B"] });
    const a = view.shares[0]!.amount;
    let attempt = 0;
    setup(view, {
      "POST /api/checks/c1/shares/A/pay": (body: unknown) => {
        attempt += 1;
        if (attempt === 1) return { status: 409, body: { error: { code: "amount_changed", message: "changed", details: { amount: 99000 } } } };
        return { status: 200, body: { changed: true, closed: false, share: { ...view.shares[0], amount: (body as { amount: number }).amount, payment: paymentOf({ method: "cash", amount: 99000 }) } } };
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, Guest A, ${money(a)}` }));
    const dialog = screen.getByRole("dialog", { name: "Take payment · Guest A" });
    expect(within(dialog).getByTestId("close-total").textContent).toBe(money(a));
    await userEvent.click(within(dialog).getByRole("radio", { name: "Cash" }));
    await userEvent.click(within(dialog).getByRole("button", { name: `Take payment, ${money(a)} by cash` }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(`The amount changed to ${money(99000)}`));
    expect(calls.filter((c) => c.path === "/api/checks/c1/shares/A/pay")[0]!.body).toEqual({ method: "cash", amount: a });
    expect(within(dialog).getByTestId("close-total").textContent).toBe(money(99000));
    await userEvent.click(within(dialog).getByRole("button", { name: `Take payment, ${money(99000)} by cash` }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.filter((c) => c.path === "/api/checks/c1/shares/A/pay")[1]!.body).toEqual({ method: "cash", amount: 99000 });
  });

  it("Locked: other modes are aria-disabled with the reason; a paid card shows Paid · card and its receipt link", async () => {
    const view = itemsView(2, { "o1:0:0": ["A"], "o1:2:0": ["B"] }, { A: { method: "card", amount: 54000 } });
    setup(view);
    const full = await screen.findByRole("radio", { name: "In full" });
    const even = screen.getByRole("radio", { name: "Evenly" });
    expect(full.getAttribute("aria-disabled")).toBe("true");
    expect(even.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("radio", { name: "By item" }).getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getByText("A share is paid, so the way this check is split can't change.")).toBeTruthy();
    await userEvent.click(even);
    expect(puts()).toEqual([]);

    expect(within(card("A")).getByText("Paid · card")).toBeTruthy();
    expect(within(card("A")).getByRole("link", { name: /Receipt/ }).getAttribute("href")).toBe("/staff/check/c1/receipt?share=A");
    expect(within(card("A")).queryByRole("button", { name: /Take payment/ })).toBeNull();
    expect(within(card("B")).getByText("Open")).toBeTruthy();
    expect(screen.getByTestId("progress").textContent).toBe(`1 of 2 paid · ${money(TOTAL - 54000)} left`);
    // A unit in a paid share can't be reassigned.
    await userEvent.click(screen.getByRole("button", { name: /^Burrata/ }));
    expect((screen.getByRole("button", { name: "Guest B" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refetches the split on live events", async () => {
    const { set } = setup(itemsView(2, {}));
    await screen.findByTestId("unassigned");
    const gets = () => calls.filter((c) => c.method === "GET" && c.path === "/api/checks/c1/split").length;
    const before = gets();
    set(itemsView(2, { "o1:0:0": ["A"] }));
    act(() => sockets[0]!.emit("event", { type: "split.updated", ids: ["c1"], tableId: "t4" }));
    await waitFor(() => expect(gets()).toBe(before + 1));
    await waitFor(() => expect(screen.getByTestId("unassigned").textContent).toBe(`3 items not assigned · ${money(104000 + 245000)}`));
    act(() => sockets[0]!.emit("event", { type: "adjustment.changed", ids: ["x"], tableId: "t4" }));
    await waitFor(() => expect(gets()).toBe(before + 2));
  });

  it("when the last share is paid, it confirms the check is closed and goes back to the floor", async () => {
    const view = itemsView(2, { "o1:0:0": ["A"], "o1:1:0": ["A"], "o1:1:1": ["A"], "o1:2:0": ["B"] }, { A: { method: "card", amount: 158000 } });
    const { router, set } = setup(view, {
      "POST /api/checks/c1/shares/B/pay": () => {
        set({ ...itemsView(2, { "o1:0:0": ["A"], "o1:1:0": ["A"], "o1:1:1": ["A"], "o1:2:0": ["B"] }, { A: { method: "card", amount: 158000 }, B: { method: "card", amount: 245000 } }), status: "paid" });
        return { status: 200, body: { changed: true, closed: true, share: { ...view.shares[1], payment: paymentOf({ method: "card", amount: 245000 }) } } };
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: `Take payment, Guest B, ${money(245000)}` }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: `Take payment, ${money(245000)} by card` }));
    const done = await screen.findByRole("dialog", { name: "Check closed" });
    expect(done.textContent).toContain("T4");
    await userEvent.click(within(done).getByRole("button", { name: "Back to floor" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/floor"));
  });
});
