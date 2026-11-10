/**
 * The guest cart: pure operations plus a per-token store persisted in localStorage under `lodos.cart.<token>`.
 *
 * The cart remembers the `checkId` (visit) the guest last saw. Orders send it as `expectedCheckId`, so a stale page
 * can never order onto the next party's check. `idempotencyKey` belongs to one checkout attempt: it is created on the
 * first attempt, reused on every retry, and dropped on success or when the cart's contents change.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { OptionSelection, OrderRequest } from "@lodos/shared";

export type LineProblem = "sold_out" | "unavailable";

export type CartLine = {
  key: string;
  itemId: string;
  qty: number;
  options: OptionSelection[];
  note: string;
  /** Set when the server refused this item on the last attempt. */
  problem?: LineProblem;
};

export type Cart = { checkId: string | null; lines: CartLine[]; idempotencyKey: string | null };
export type NewLine = Omit<CartLine, "key" | "problem">;

export const MAX_LINE_QTY = 20;
/** The API accepts at most 20 items per order. */
export const MAX_ORDER_QTY = 20;
export const NOTE_MAX = 140;

export const emptyCart = (): Cart => ({ checkId: null, lines: [], idempotencyKey: null });

export const canonicalOptions = (options: OptionSelection[]): OptionSelection[] =>
  options
    .filter((o) => o.optionIds.length > 0)
    .map((o) => ({ groupId: o.groupId, optionIds: [...o.optionIds].sort() }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));

/** Same item + same options + same note → same line. Option and group order never matter. */
export function lineKey(itemId: string, options: OptionSelection[], note: string): string {
  const opts = canonicalOptions(options).map((o) => `${o.groupId}=${o.optionIds.join(",")}`).join(";");
  return `${itemId}|${opts}|${note.trim()}`;
}

const edited = (cart: Cart, lines: CartLine[]): Cart => ({ ...cart, lines, idempotencyKey: null });

export function addLine(cart: Cart, line: NewLine): Cart {
  const options = canonicalOptions(line.options);
  const note = line.note.trim();
  const key = lineKey(line.itemId, options, note);
  const existing = cart.lines.find((l) => l.key === key);
  if (existing) {
    return edited(cart, cart.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_LINE_QTY, l.qty + line.qty) } : l)));
  }
  return edited(cart, [...cart.lines, { key, itemId: line.itemId, qty: Math.min(MAX_LINE_QTY, line.qty), options, note }]);
}

/** qty ≤ 0 removes the line. */
export function setQty(cart: Cart, key: string, qty: number): Cart {
  if (qty <= 0) return removeLine(cart, key);
  return edited(cart, cart.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_LINE_QTY, qty) } : l)));
}

export function removeLine(cart: Cart, key: string): Cart {
  return edited(cart, cart.lines.filter((l) => l.key !== key));
}

/** Forget everything, including the visit. Used when the visit has ended. */
export function clear(cart: Cart): Cart {
  void cart;
  return emptyCart();
}

/** Flags every line for `itemId` after the server refused it; the rest of the cart is kept. */
export function markProblem(cart: Cart, itemId: string, problem: LineProblem): Cart {
  return edited(cart, cart.lines.map((l) => (l.itemId === itemId ? { ...l, problem } : l)));
}

export function uuidv4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // randomUUID is missing on plain-http LAN origins (a phone hitting the dev box by IP).
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Starts (or resumes) a checkout attempt: the key is created once and reused on every retry. */
export function withIdempotencyKey(cart: Cart, gen: () => string = uuidv4): Cart {
  return cart.idempotencyKey ? cart : { ...cart, idempotencyKey: gen() };
}

/** After a successful order: empty the lines and end the attempt. The visit is kept. */
export function orderSucceeded(cart: Cart): Cart {
  return { ...cart, lines: [], idempotencyKey: null };
}

export function toOrderRequest(cart: Cart): OrderRequest {
  if (!cart.idempotencyKey) throw new Error("toOrderRequest needs an idempotency key");
  return {
    idempotencyKey: cart.idempotencyKey,
    ...(cart.checkId ? { expectedCheckId: cart.checkId } : {}),
    items: cart.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      options: l.options,
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
    })),
  };
}

export const cartCount = (cart: Cart): number => cart.lines.reduce((n, l) => n + l.qty, 0);

// ---------- persistence ----------

export const storageKey = (token: string) => `lodos.cart.${token}`;

function isCart(v: unknown): v is Cart {
  const c = v as Cart | null;
  return !!c && typeof c === "object" && Array.isArray(c.lines) && (c.checkId === null || typeof c.checkId === "string");
}

export function loadCart(token: string): Cart {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return emptyCart();
    const parsed: unknown = JSON.parse(raw);
    if (!isCart(parsed)) return emptyCart();
    return { checkId: parsed.checkId, lines: parsed.lines, idempotencyKey: parsed.idempotencyKey ?? null };
  } catch {
    return emptyCart();
  }
}

export function saveCart(token: string, cart: Cart): void {
  try {
    localStorage.setItem(storageKey(token), JSON.stringify(cart));
  } catch {
    /* storage full or blocked: the in-memory cart still works */
  }
}

// ---------- store (one per token, shared by every component on the page) ----------

type Store = { get: () => Cart; set: (next: Cart | ((c: Cart) => Cart)) => void; subscribe: (fn: () => void) => () => void };
const stores = new Map<string, Store>();

function storeFor(token: string): Store {
  let s = stores.get(token);
  if (s) return s;
  let current = loadCart(token);
  const listeners = new Set<() => void>();
  s = {
    get: () => current,
    set: (next) => {
      current = typeof next === "function" ? next(current) : next;
      saveCart(token, current);
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  stores.set(token, s);
  return s;
}

/** Test helper: forget the in-memory stores so the next read comes from localStorage. */
export function resetCartStores(): void {
  stores.clear();
}

export type CartApi = {
  cart: Cart;
  /** The stored cart right now (fresher than `cart` inside an event handler that just updated it). */
  get: () => Cart;
  add: (line: NewLine) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  update: (fn: (c: Cart) => Cart) => void;
  clear: () => void;
};

export function useCart(token: string): CartApi {
  const store = storeFor(token);
  const cart = useSyncExternalStore(store.subscribe, store.get, store.get);
  const actions = useMemo(
    () => ({
      get: () => store.get(),
      add: (line: NewLine) => store.set((c) => addLine(c, line)),
      setQty: (key: string, qty: number) => store.set((c) => setQty(c, key, qty)),
      remove: (key: string) => store.set((c) => removeLine(c, key)),
      update: (fn: (c: Cart) => Cart) => store.set(fn),
      clear: () => store.set(clear),
    }),
    [store],
  );
  return { cart, ...actions };
}
