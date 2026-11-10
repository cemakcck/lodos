import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("./fakeSocket")).socketModule);

import {
  addLine, setQty, removeLine, clear, emptyCart, withIdempotencyKey, orderSucceeded, loadCart, saveCart,
  toOrderRequest, markProblem, resetCartStores, type Cart,
} from "../../src/guest/cart";
import { setLanguage } from "../../src/i18n";
import { mockFetch, renderGuest, baseRoutes, burrata, negroni } from "./harness";
import { sockets } from "./fakeSocket";

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

const doneness = (id: string) => ({ groupId: "doneness", optionIds: [id] });

describe("cart (pure)", () => {
  it("keeps the same item with different options as separate lines", () => {
    let c = addLine(emptyCart(), { itemId: "ribeye", qty: 1, options: [doneness("rare")], note: "" });
    c = addLine(c, { itemId: "ribeye", qty: 1, options: [doneness("medium")], note: "" });
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0]!.key).not.toBe(c.lines[1]!.key);
  });

  it("merges qty for the same item with the same options, regardless of option order", () => {
    const extras = (ids: string[]) => ({ groupId: "extras", optionIds: ids });
    let c = addLine(emptyCart(), { itemId: "ribeye", qty: 1, options: [doneness("rare"), extras(["a", "b"])], note: "" });
    c = addLine(c, { itemId: "ribeye", qty: 2, options: [extras(["b", "a"]), doneness("rare")], note: "" });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]!.qty).toBe(3);
  });

  it("setQty, removeLine and clear", () => {
    let c = addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" });
    c = addLine(c, { itemId: "negroni", qty: 1, options: [], note: "" });
    const [a, b] = c.lines;
    c = setQty(c, a!.key, 4);
    expect(c.lines[0]!.qty).toBe(4);
    c = setQty(c, a!.key, 0);
    expect(c.lines.map((l) => l.itemId)).toEqual(["negroni"]);
    c = removeLine(c, b!.key);
    expect(c.lines).toEqual([]);
    c = { ...addLine(c, { itemId: "burrata", qty: 1, options: [], note: "" }), checkId: "c1" };
    expect(clear(c)).toEqual({ checkId: null, lines: [], idempotencyKey: null });
  });

  it("keeps the idempotency key stable across retries and issues a new one after success", () => {
    let c: Cart = addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" });
    c = withIdempotencyKey(c);
    const first = c.idempotencyKey;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    c = withIdempotencyKey(c); // retry
    expect(c.idempotencyKey).toBe(first);
    c = orderSucceeded(c);
    expect(c.lines).toEqual([]);
    c = withIdempotencyKey(addLine(c, { itemId: "burrata", qty: 1, options: [], note: "" }));
    expect(c.idempotencyKey).not.toBe(first);
  });

  it("changing the cart starts a new attempt", () => {
    let c = withIdempotencyKey(addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" }));
    c = setQty(c, c.lines[0]!.key, 2);
    expect(c.idempotencyKey).toBeNull();
  });

  it("builds the order request with expectedCheckId when the cart holds a checkId", () => {
    const c = withIdempotencyKey({ ...addLine(emptyCart(), { itemId: "burrata", qty: 2, options: [], note: " no basil " }), checkId: "c1" });
    expect(toOrderRequest(c)).toEqual({
      idempotencyKey: c.idempotencyKey,
      expectedCheckId: "c1",
      items: [{ itemId: "burrata", qty: 2, options: [], note: "no basil" }],
    });
    const fresh = withIdempotencyKey(addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" }));
    expect(toOrderRequest(fresh)).not.toHaveProperty("expectedCheckId");
    expect(toOrderRequest(fresh).items[0]).not.toHaveProperty("note");
  });

  it("marks problem lines by item id", () => {
    let c = addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" });
    c = addLine(c, { itemId: "negroni", qty: 1, options: [], note: "" });
    c = markProblem(c, "burrata", "sold_out");
    expect(c.lines.map((l) => l.problem ?? null)).toEqual(["sold_out", null]);
  });

  it("persists under lodos.cart.<token>", () => {
    const c = { ...addLine(emptyCart(), { itemId: "burrata", qty: 1, options: [], note: "" }), checkId: "c9" };
    saveCart("tok", c);
    expect(JSON.parse(localStorage.getItem("lodos.cart.tok")!)).toMatchObject({ checkId: "c9", lines: [{ itemId: "burrata" }] });
    expect(loadCart("tok")).toEqual(c);
    expect(loadCart("other")).toEqual(emptyCart());
  });
});

function seedCart(checkId: string | null) {
  let c = addLine(emptyCart(), { itemId: burrata.id, qty: 1, options: [], note: "" });
  c = addLine(c, { itemId: negroni.id, qty: 2, options: [], note: "" });
  saveCart("tok", { ...c, checkId });
}

describe("placing an order", () => {
  it("marks a sold-out line and keeps the rest of the cart", async () => {
    seedCart("c1");
    const { calls } = mockFetch({
      ...baseRoutes("c1"),
      "POST /api/guest/orders": () => ({ status: 409, body: { error: { code: "sold_out", message: "x", details: { itemId: "burrata" } } } }),
    });
    renderGuest("/t/tok");
    await userEvent.click(await screen.findByRole("button", { name: /view order · 3/i }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /place order/i }));
    expect(await within(sheet).findByText("Sold out tonight")).toBeTruthy();
    expect(within(sheet).getByText("Lodos Negroni")).toBeTruthy();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ expectedCheckId: "c1", items: [{ itemId: "burrata" }, { itemId: "negroni", qty: 2 }] });
    expect(post.headers.get("X-Table-Token")).toBe("tok");
    expect(loadCart("tok").lines).toHaveLength(2);
  });

  it("retries with the same idempotency key after a failure", async () => {
    seedCart("c1");
    let n = 0;
    const { calls } = mockFetch({
      ...baseRoutes("c1"),
      "POST /api/guest/orders": () => (++n === 1 ? { status: 500, body: { error: { code: "internal", message: "x" } } } : { status: 201, body: { orderId: "o9" } }),
    });
    renderGuest("/t/tok");
    await userEvent.click(await screen.findByRole("button", { name: /view order · 3/i }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /place order/i }));
    await within(sheet).findByRole("alert");
    await userEvent.click(within(sheet).getByRole("button", { name: /place order/i }));
    await waitFor(() => expect(loadCart("tok").lines).toEqual([]));
    const posts = calls.filter((c) => c.method === "POST").map((c) => (c.body as { idempotencyKey: string }).idempotencyKey);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toBe(posts[1]);
  });

  it("shows VisitEnded and clears the cart on check_closed", async () => {
    seedCart("c1");
    mockFetch({
      ...baseRoutes("c1"),
      "POST /api/guest/orders": () => ({ status: 409, body: { error: { code: "check_closed", message: "x" } } }),
    });
    renderGuest("/t/tok");
    await userEvent.click(await screen.findByRole("button", { name: /view order · 3/i }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /place order/i }));
    expect(await screen.findByText("This table's visit has ended. Thank you!")).toBeTruthy();
    expect(loadCart("tok")).toEqual(emptyCart());
  });
});
