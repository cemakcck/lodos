/* Pure layout geometry for the floor plan editor (spec §7). Units are room pixels; tables are axis-aligned boxes. */
import { TABLE_NAME_RE } from "@lodos/shared";

export type Rect = { x: number; y: number; w: number; h: number };
export type RoomSize = { width: number; height: number };
export type Guide = { x?: number; y?: number };

/** The editor grid: drops and keyboard moves snap to it; arrows move one step, Shift + arrow four. */
export const GRID = 16;
/** How close two edges or centres must be to draw an alignment guide. */
export const GUIDE_TOLERANCE = 4;

export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

/** The rect moved (not resized) so it lies inside the room; a rect larger than the room sits at 0. */
export function clampInto<T extends Rect>(rect: T, room: RoomSize): T {
  const x = Math.max(0, Math.min(rect.x, room.width - rect.w));
  const y = Math.max(0, Math.min(rect.y, room.height - rect.h));
  return { ...rect, x, y };
}

/** Shared area only: touching edges do not overlap (the API's rule; a round table is its bounding box). */
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Alignment guides for a moving table: for every other table whose left edge, centre or right edge (and top,
 * middle, bottom) is within 4 px of the moving table's own, a guide at the other table's line. No duplicates.
 */
export function guidesFor(moving: Rect, others: readonly Rect[]): Guide[] {
  const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];
  const gx = new Set<number>();
  const gy = new Set<number>();
  for (const o of others) {
    for (const a of xs(moving)) for (const b of xs(o)) if (Math.abs(a - b) <= GUIDE_TOLERANCE) gx.add(b);
    for (const a of ys(moving)) for (const b of ys(o)) if (Math.abs(a - b) <= GUIDE_TOLERANCE) gy.add(b);
  }
  return [...[...gx].map((x) => ({ x })), ...[...gy].map((y) => ({ y }))];
}

/** A new table's size from its shape and seats: the seed's presets (round 64/76/88; rect 72×56, 96×64, 120×72). */
export function sizeFor(shape: "round" | "rect", capacity: number): { w: number; h: number } {
  if (shape === "round") {
    const d = capacity <= 2 ? 64 : capacity <= 4 ? 76 : 88;
    return { w: d, h: d };
  }
  if (capacity <= 2) return { w: 72, h: 56 };
  if (capacity <= 5) return { w: 96, h: 64 };
  return { w: 120, h: 72 };
}

const numberOf = (name: string, prefix: "T" | "B") => (TABLE_NAME_RE.test(name) && name[0] === prefix ? Number(name.slice(1)) : 0);

/**
 * The next free name with a prefix: the server's next name (it counts every table ever made, so deleted names are
 * never reused) or past the highest one already used in this draft, whichever is higher.
 */
export function nextName(prefix: "T" | "B", server: { T: string; B: string }, draftNames: readonly string[]): string {
  const fromServer = numberOf(server[prefix], prefix) || 1;
  const fromDraft = Math.max(0, ...draftNames.map((n) => numberOf(n, prefix))) + 1;
  return `${prefix}${Math.max(fromServer, fromDraft)}`;
}

/**
 * The first grid spot, row by row from `start` (default the top-left grid step), where a table of `size` fits in
 * the room and overlaps none of `taken`. Falls back to `start` when the room is full.
 */
export function findFree(size: { w: number; h: number }, taken: readonly Rect[], room: RoomSize, start = { x: GRID, y: GRID }): { x: number; y: number } {
  const x0 = snap(start.x);
  const y0 = snap(start.y);
  for (let y = y0; y + size.h <= room.height; y += GRID) {
    for (let x = y === y0 ? x0 : 0; x + size.w <= room.width; x += GRID) {
      const r = { x, y, ...size };
      if (!taken.some((t) => overlaps(r, t))) return { x, y };
    }
  }
  if (y0 !== 0 || x0 !== 0) return findFree(size, taken, room, { x: 0, y: 0 });
  return clampInto({ ...start, ...size }, room);
}
