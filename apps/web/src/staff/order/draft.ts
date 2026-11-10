/**
 * The waiter's order being built, before Send. Pure operations plus sessionStorage persistence per table, so a
 * reload or a trip to the floor and back keeps the lines.
 *
 * A line is one item with its options, note and seat. Adding an item merges its quantity into the line with the same
 * item and options that has no note, seat or problem yet; anything else starts a new line. Editing a note or seat never
 * merges lines (a note being typed must not make its line jump), so `key` is a stable id, not a content hash.
 * `idempotencyKey` belongs to one send attempt (the guest cart's rules): it is created on the first attempt, reused
 * on every retry, and dropped on success or whenever the lines change.
 */
import type { OptionSelection, OrderRequest } from "@lodos/shared";
import { canonicalOptions, lineKey, uuidv4, MAX_ORDER_QTY, NOTE_MAX, type LineProblem } from "../../guest/cart";

export { MAX_ORDER_QTY, NOTE_MAX };
export const MAX_SEAT = 20;

export type DraftLine = {
  key: string;
  itemId: string;
  qty: number;
  options: OptionSelection[];
  note: string;
  seat: number | null;
  /** Set when the server refused this item on the last send. */
  problem?: LineProblem;
};

export type Draft = {
  /** The check the waiter was adding to; sent as `expectedCheckId` so a closed-and-reseated table is refused. */
  checkId: string | null;
  lines: DraftLine[];
  idempotencyKey: string | null;
};

export type NewDraftLine = { itemId: string; qty: number; options: OptionSelection[] };

export const emptyDraft = (checkId: string | null = null): Draft => ({ checkId, lines: [], idempotencyKey: null });

/** Identity for merging adds: same item, same options (in any order). */
const mergeKey = (itemId: string, options: OptionSelection[]) => lineKey(itemId, options, "");
const isPlain = (l: DraftLine) => !l.note.trim() && l.seat === null && !l.problem;

export const draftCount = (d: Draft): number => d.lines.reduce((n, l) => n + l.qty, 0);
/** How many more items fit under the per-order cap. */
export const room = (d: Draft): number => Math.max(0, MAX_ORDER_QTY - draftCount(d));

const edited = (d: Draft, lines: DraftLine[]): Draft => ({ ...d, lines: lines.filter((l) => l.qty > 0), idempotencyKey: null });

/** Adds up to `room` items. `added` is how many went in (less than asked when the cap is hit). */
export function addItem(d: Draft, line: NewDraftLine): { draft: Draft; added: number } {
  const added = Math.min(line.qty, room(d));
  if (added <= 0) return { draft: d, added: 0 };
  const options = canonicalOptions(line.options);
  const k = mergeKey(line.itemId, options);
  const twin = d.lines.find((l) => isPlain(l) && mergeKey(l.itemId, l.options) === k);
  if (twin) return { draft: edited(d, d.lines.map((l) => (l === twin ? { ...l, qty: l.qty + added } : l))), added };
  return { draft: edited(d, [...d.lines, { key: uuidv4(), itemId: line.itemId, qty: added, options, note: "", seat: null }]), added };
}

const patch = (d: Draft, key: string, fn: (l: DraftLine) => DraftLine) => edited(d, d.lines.map((l) => (l.key === key ? fn(l) : l)));

/** qty ≤ 0 removes the line; an increase is limited by the cap. */
export const setLineQty = (d: Draft, key: string, qty: number): Draft =>
  patch(d, key, (l) => ({ ...l, qty: Math.min(qty, l.qty + room(d)) }));
export const setLineSeat = (d: Draft, key: string, seat: number | null): Draft =>
  patch(d, key, (l) => ({ ...l, seat: seat !== null && seat >= 1 && seat <= MAX_SEAT ? Math.trunc(seat) : null }));
/** The note is kept as typed (up to 140 characters) and trimmed when sent. */
export const setLineNote = (d: Draft, key: string, note: string): Draft => patch(d, key, (l) => ({ ...l, note: note.slice(0, NOTE_MAX) }));
export const removeLine = (d: Draft, key: string): Draft => edited(d, d.lines.filter((l) => l.key !== key));

/** Flags every line for `itemId` after the server refused it; the other lines are kept. */
export const markProblem = (d: Draft, itemId: string, problem: LineProblem): Draft => ({
  ...d,
  lines: d.lines.map((l) => (l.itemId === itemId ? { ...l, problem } : l)),
});

/** Starts (or resumes) a send attempt: the key is created once and reused on every retry. */
export const withIdempotencyKey = (d: Draft, gen: () => string = uuidv4): Draft => (d.idempotencyKey ? d : { ...d, idempotencyKey: gen() });

export function toOrderRequest(d: Draft): OrderRequest {
  if (!d.idempotencyKey) throw new Error("toOrderRequest needs an idempotency key");
  return {
    idempotencyKey: d.idempotencyKey,
    ...(d.checkId ? { expectedCheckId: d.checkId } : {}),
    items: d.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      options: l.options,
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
      ...(l.seat !== null ? { seat: l.seat } : {}),
    })),
  };
}

// ---------- persistence ----------

export const draftStorageKey = (tableId: string) => `lodos.order.${tableId}`;

export function loadDraft(tableId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftStorageKey(tableId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && Array.isArray(d.lines) ? { checkId: d.checkId ?? null, lines: d.lines, idempotencyKey: d.idempotencyKey ?? null } : null;
  } catch {
    return null;
  }
}

export function saveDraft(tableId: string, d: Draft): void {
  try {
    if (d.lines.length === 0) sessionStorage.removeItem(draftStorageKey(tableId));
    else sessionStorage.setItem(draftStorageKey(tableId), JSON.stringify(d));
  } catch {
    // Storage blocked (private mode): the draft just isn't kept across reloads.
  }
}
