/* F2: a returning guest never lands on "visit ended"; only a visit that ends during this page session (or a
   check_closed order) shows it, and a fresh start (demo role switch) adopts the new visit. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("./fakeSocket")).socketModule);

import { addLine, emptyCart, loadCart, saveCart, resetCartStores } from "../../src/guest/cart";
import { restartGuestPages } from "../../src/guest/session";
import { setLanguage } from "../../src/i18n";
import { mockFetch, renderGuest, baseRoutes, burrata, tableWith, sockets } from "./harness";

const ENDED = "This table's visit has ended. Thank you!";

beforeEach(async () => {
  localStorage.clear();
  resetCartStores();
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const savedCart = (checkId: string | null) =>
  saveCart("tok", { ...addLine(emptyCart(), { itemId: burrata.id, qty: 2, options: [], note: "" }), checkId });

const nudge = () => act(() => sockets[0]!.emit("event", { type: "check.updated", ids: ["x"], tableId: "t7" }));

async function addBurrataAndPlace() {
  await userEvent.click((await screen.findAllByRole("button", { name: /add burrata/i }))[0]!);
  const view = await screen.findByRole("button", { name: /view order/i });
  await userEvent.click(view);
  const sheet = await screen.findByRole("dialog");
  await userEvent.click(within(sheet).getByRole("button", { name: /place order/i }));
}

describe("returning guest (first load)", () => {
  it("a saved cart from an earlier visit is dropped quietly: the menu shows, not VisitEnded", async () => {
    savedCart("old-check");
    mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok");
    expect(await screen.findByText("Burrata, heirloom tomato")).toBeTruthy();
    await waitFor(() => expect(loadCart("tok")).toEqual({ checkId: "c1", lines: [], idempotencyKey: null }));
    expect(screen.queryByText(ENDED)).toBeNull();
  });

  it("the same at a free table (no open visit)", async () => {
    savedCart("old-check");
    mockFetch(baseRoutes(null));
    renderGuest("/t/tok");
    expect(await screen.findByText("Burrata, heirloom tomato")).toBeTruthy();
    await waitFor(() => expect(loadCart("tok")).toEqual(emptyCart()));
    expect(screen.queryByText(ENDED)).toBeNull();
  });
});

describe("during the page session", () => {
  it("the adopted visit closing shows VisitEnded", async () => {
    const { routes } = mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok");
    await screen.findByText("Burrata, heirloom tomato");
    await waitFor(() => expect(loadCart("tok").checkId).toBe("c1"));
    routes["GET /api/guest/table"] = tableWith(null);
    nudge();
    expect(await screen.findByText(ENDED)).toBeTruthy();
  });

  it("the first order adopts the visit it opened from the reply, before the table refetch", async () => {
    const { routes } = mockFetch({
      ...baseRoutes(null),
      "POST /api/guest/orders": () => ({ status: 201, body: { orderId: "o1", checkId: "c9" } }),
    });
    // The table refetch still says "free" (it lags the order): the page must not call that the end of the visit.
    renderGuest("/t/tok");
    await screen.findByText("Burrata, heirloom tomato");
    await addBurrataAndPlace();
    await waitFor(() => expect(loadCart("tok").checkId).toBe("c9"));
    expect(screen.queryByText(ENDED)).toBeNull();
    // Once the table shows c9 and then closes, the visit ends.
    routes["GET /api/guest/table"] = tableWith("c9");
    nudge();
    await waitFor(() => expect(loadCart("tok").checkId).toBe("c9"));
    routes["GET /api/guest/table"] = tableWith(null);
    nudge();
    expect(await screen.findByText(ENDED)).toBeTruthy();
  });

  it("after a fresh start (demo role switch back to the guest) the new visit is adopted and ordering works", async () => {
    const { routes, calls } = mockFetch({
      ...baseRoutes("c1"),
      "POST /api/guest/orders": () => ({ status: 201, body: { orderId: "o2", checkId: "c2" } }),
    });
    renderGuest("/t/tok");
    await screen.findByText("Burrata, heirloom tomato");
    await waitFor(() => expect(loadCart("tok").checkId).toBe("c1"));
    routes["GET /api/guest/table"] = tableWith(null);
    nudge();
    await screen.findByText(ENDED);

    routes["GET /api/guest/table"] = tableWith("c2");
    act(() => restartGuestPages());
    expect(await screen.findByText("Burrata, heirloom tomato")).toBeTruthy();
    expect(screen.queryByText(ENDED)).toBeNull();
    await waitFor(() => expect(loadCart("tok").checkId).toBe("c2"));
    await addBurrataAndPlace();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ expectedCheckId: "c2", items: [{ itemId: "burrata", qty: 1 }] });
    await waitFor(() => expect(loadCart("tok").lines).toEqual([]));
    expect(screen.queryByText(ENDED)).toBeNull();
  });
});
