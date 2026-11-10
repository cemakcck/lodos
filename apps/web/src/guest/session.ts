/**
 * Guest page sessions. A "page session" is what GuestApp remembers while it stays mounted: the visit it adopted and
 * whether that visit ended. `restartGuestPages()` starts a fresh session on every mounted guest page (the demo's
 * "Guest at T7" role switch calls it), so a page that showed "visit ended" adopts the table's new visit.
 */
import { useSyncExternalStore } from "react";

let generation = 0;
const listeners = new Set<() => void>();

export function restartGuestPages(): void {
  generation++;
  listeners.forEach((l) => l());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const read = () => generation;

/** Changes whenever `restartGuestPages()` runs. */
export function useGuestGeneration(): number {
  return useSyncExternalStore(subscribe, read, read);
}
