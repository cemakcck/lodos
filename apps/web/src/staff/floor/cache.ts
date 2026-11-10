import type { QueryClient } from "@tanstack/react-query";
import { checkState } from "./lib";
import type { FloorData, FloorTable, TableCheck } from "./types";

export const floorKey = ["floor"] as const;
export const checkKey = (tableId: string) => ["check", tableId] as const;

/** Patch one table on the cached floor snapshot (optimistic updates). */
export function patchFloorTable(qc: QueryClient, tableId: string, fn: (t: FloorTable) => FloorTable): void {
  qc.setQueryData<FloorData>(floorKey, (d) => (d ? { ...d, tables: d.tables.map((t) => (t.id === tableId ? fn(t) : t)) } : d));
}

/**
 * After an optimistic change to a check, make the floor agree: the table's state is re-derived from the patched check,
 * and chips whose reason is gone (no calls, nothing ready, no bill) are dropped.
 */
export function syncFloorFromCheck(qc: QueryClient, tableId: string, data: TableCheck): void {
  const state = checkState(data);
  const ready = data.check !== null && [...data.food, ...data.drinks].some((l) => l.status === "ready");
  const keep = { calling: data.calls.length > 0, ready, bill: data.check !== null && data.check.billRequestedAt !== null };
  qc.setQueryData<FloorData>(floorKey, (d) =>
    d
      ? {
          ...d,
          tables: d.tables.map((t) =>
            t.id !== tableId
              ? t
              : data.check === null
                ? { ...t, state, covers: null, seatedAt: null, checkId: null }
                : { ...t, state },
          ),
          chips: d.chips.filter((c) => c.tableId !== tableId || keep[c.kind]),
        }
      : d,
  );
}

/** Snapshot both caches so an optimistic change can be rolled back as one. */
export function snapshotCaches(qc: QueryClient, tableId: string) {
  const check = qc.getQueryData<TableCheck>(checkKey(tableId));
  const floor = qc.getQueryData<FloorData>(floorKey);
  return () => {
    if (check) qc.setQueryData(checkKey(tableId), check);
    if (floor) qc.setQueryData(floorKey, floor);
  };
}
