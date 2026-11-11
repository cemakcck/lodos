import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { checkKey, floorKey } from "../floor/cache";
import type { FloorData, FloorSnapshot, PayMethod, TableCheck } from "../floor/types";
import type { PayShareResult, SplitBody, SplitView } from "./types";

/** Live events (`split.updated`, `adjustment.changed`, `check.updated`, `ticket.*`) invalidate the `["split"]` root. */
export const splitKey = (checkId: string) => ["split", checkId] as const;

export const useSplit = (checkId: string) =>
  useQuery({ queryKey: splitKey(checkId), queryFn: () => api<SplitView>(`/api/checks/${checkId}/split`) });

export const putSplit = (checkId: string, body: SplitBody) =>
  api<SplitView>(`/api/checks/${checkId}/split`, { method: "PUT", body: JSON.stringify(body) });

export const payShare = (checkId: string, label: string, method: PayMethod, amount: number) =>
  api<PayShareResult>(`/api/checks/${checkId}/shares/${label}/pay`, { method: "POST", body: JSON.stringify({ method, amount }) });

export const closeInFull = (checkId: string, method: PayMethod) =>
  api(`/api/checks/${checkId}/close`, { method: "POST", body: JSON.stringify({ method }) });

/**
 * The table's side of the check: covers (the first Evenly count) and the guest's requested bill method (preselected
 * in the pay dialog). The table is found through the floor snapshot already in the cache (the waiter comes from the
 * floor), or, after a reload, one `GET /api/floor` under its own key. Then the same `GET /api/tables/:id/check` query
 * as the table panel, which live events keep fresh.
 */
export function useCheckTable(checkId: string): { covers: number | null; billMethod: PayMethod | null } {
  const qc = useQueryClient();
  const cached = qc.getQueryData<FloorData>(floorKey)?.tables.find((t) => t.checkId === checkId);
  const found = useQuery({
    queryKey: ["closeTable", checkId],
    queryFn: async () => {
      const t = (await api<FloorSnapshot>("/api/floor")).tables.find((x) => x.checkId === checkId);
      return t ? { id: t.id, covers: t.covers } : null;
    },
    enabled: !cached,
    staleTime: Infinity,
  });
  const table = cached ?? found.data ?? null;
  const tableId = table?.id ?? null;
  const check = useQuery({
    queryKey: checkKey(tableId ?? ""),
    queryFn: () => api<TableCheck>(`/api/tables/${tableId}/check`),
    enabled: tableId !== null,
  });
  const info = check.data?.check?.id === checkId ? check.data.check : null;
  return { covers: info ? info.covers : (table?.covers ?? null), billMethod: info?.billMethod ?? null };
}
