import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act } from "@testing-library/react";

vi.mock("socket.io-client", async () => (await import("./fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { addLine, emptyCart, loadCart, saveCart, resetCartStores } from "../../src/guest/cart";
import { mockFetch, renderGuest, baseRoutes, tableWith } from "./harness";
import { sockets } from "./fakeSocket";

beforeEach(async () => {
  localStorage.clear();
  resetCartStores();
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("TableStatus", () => {
  it("groups lines as Food and Drinks with localized status labels", async () => {
    mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok/table");
    expect(await screen.findByRole("heading", { name: "Food" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Drinks" })).toBeTruthy();
    expect(screen.getByText("Preparing")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("₺2,020")).toBeTruthy();

    await act(() => setLanguage("tr"));
    expect(screen.getByRole("heading", { name: "Yemekler" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "İçecekler" })).toBeTruthy();
    expect(screen.getByText("Hazırlanıyor")).toBeTruthy();
    expect(screen.getByText("Hazır")).toBeTruthy();
    expect(screen.getByText("Sakızlı cin")).toBeTruthy();
  });

  it("renders VisitEnded and clears the cart when the checkId changes", async () => {
    saveCart("tok", { ...addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" }), checkId: "c1" });
    const { routes } = mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok/table");
    await screen.findByRole("heading", { name: "Food" });

    routes["GET /api/guest/table"] = tableWith("c2");
    act(() => sockets[0]!.emit("event", { type: "check.updated", ids: ["c1"], tableId: "t7" }));
    expect(await screen.findByText("This table's visit has ended. Thank you!")).toBeTruthy();
    expect(loadCart("tok")).toEqual(emptyCart());
    expect(screen.queryByRole("heading", { name: "Food" })).toBeNull();
  });

  it("renders VisitEnded when the visit closes (no open check)", async () => {
    saveCart("tok", { ...emptyCart(), checkId: "c1" });
    const { routes } = mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok");
    await screen.findByText("Burrata, heirloom tomato");
    routes["GET /api/guest/table"] = tableWith(null);
    act(() => sockets[0]!.emit("event", { type: "check.updated", ids: ["c1"], tableId: "t7" }));
    expect(await screen.findByText("This table's visit has ended. Thank you!")).toBeTruthy();
  });

  it("adopts the open visit's checkId into the cart", async () => {
    mockFetch(baseRoutes("c1"));
    renderGuest("/t/tok/table");
    await screen.findByRole("heading", { name: "Food" });
    expect(loadCart("tok").checkId).toBe("c1");
  });
});
