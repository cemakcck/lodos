import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { floorKey } from "../floor/cache";
import type { FloorData, FloorSnapshot, PayMethod } from "../floor/types";
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
 * The check's covers, for the first Evenly count. Read from the floor snapshot already in the cache (the waiter
 * comes from the floor); after a reload, one `GET /api/floor` under its own key, so live events don't refetch it.
 */
export function useCovers(checkId: string): number | null {
  const qc = useQueryClient();
  const cached = qc.getQueryData<FloorData>(floorKey)?.tables.find((t) => t.checkId === checkId);
  const q = useQuery({
    queryKey: ["closeCovers", checkId],
    queryFn: async () => (await api<FloorSnapshot>("/api/floor")).tables.find((t) => t.checkId === checkId)?.covers ?? null,
    enabled: !cached,
    staleTime: Infinity,
  });
  return cached ? cached.covers : (q.data ?? null);
}
