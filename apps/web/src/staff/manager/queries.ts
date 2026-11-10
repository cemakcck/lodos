import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { FloorSnapshot } from "../floor/types";
import type { StaffMember } from "../auth";
import {
  managerFloorKey,
  managerMenuKey,
  managerStaffKey,
  managerTablesKey,
  tonightKey,
  type Availability,
  type ItemView,
  type ManagerMenu,
  type ManagerTable,
  type Tonight,
} from "./types";

export const useManagerMenu = () => useQuery({ queryKey: managerMenuKey, queryFn: () => api<ManagerMenu>("/api/manager/menu") });
export const useManagerTables = () => useQuery({ queryKey: managerTablesKey, queryFn: () => api<ManagerTable[]>("/api/manager/tables") });
/** Room names and each table's section waiter come from the floor snapshot (the manager may read it). */
export const useManagerFloor = () =>
  useQuery({ queryKey: managerFloorKey, queryFn: () => api<FloorSnapshot>("/api/floor"), staleTime: 60_000 });
export const useStaffList = () =>
  useQuery({ queryKey: managerStaffKey, queryFn: () => api<StaffMember[]>("/api/auth/staff"), staleTime: 5 * 60_000 });
export const useTonight = () =>
  useQuery({ queryKey: tonightKey, queryFn: () => api<Tonight>("/api/manager/tonight"), refetchInterval: 60_000 });

/** Replaces one item in the cached manager menu (no-op when the menu isn't cached). */
export function patchItem(qc: QueryClient, itemId: string, fn: (i: ItemView) => ItemView) {
  qc.setQueryData<ManagerMenu>(managerMenuKey, (m) => (m ? { ...m, items: m.items.map((i) => (i.id === itemId ? fn(i) : i)) } : m));
}

export const setAvailability = (qc: QueryClient, itemId: string, a: Availability) =>
  patchItem(qc, itemId, (i) => ({ ...i, availability: { soldOut: a.soldOut, remaining: a.remaining } }));

/** Puts a saved item into the cached menu (adds it when new). */
export function upsertItem(qc: QueryClient, item: ItemView) {
  qc.setQueryData<ManagerMenu>(managerMenuKey, (m) => {
    if (!m) return m;
    const has = m.items.some((i) => i.id === item.id);
    return { ...m, items: has ? m.items.map((i) => (i.id === item.id ? item : i)) : [...m.items, item] };
  });
}
