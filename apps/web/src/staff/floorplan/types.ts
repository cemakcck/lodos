/* Wire types for `/api/rooms/:id/layout` (apps/api/src/layout/service.ts). */
import type { LayoutProblem } from "@lodos/shared";

export type { LayoutProblem };

export interface LayoutRoom {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Saves are checked against it: a stale version gets `409 version_conflict`. */
  version: number;
}

export interface LayoutTable {
  id: string;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  sectionStaffId: string | null;
  /** A table with an open check can move, but can't be renamed, change prefix or be removed. */
  openCheck: boolean;
}

export interface LayoutView {
  room: LayoutRoom;
  tables: LayoutTable[];
  /** The next unused names, counting deleted tables too. */
  nextNames: { T: string; B: string };
}

/** A table in the editor: `key` is the id for a saved table, `new-<n>` for one added in this draft. */
export type DraftTable = Omit<LayoutTable, "id"> & { key: string; id?: string };

/** The editor's three shapes. Booth is not stored: it is a `rect` named `B<n>`. */
export type ShapeOption = "round" | "square" | "booth";

export const layoutKey = (roomId: string) => ["floorplan", roomId] as const;
