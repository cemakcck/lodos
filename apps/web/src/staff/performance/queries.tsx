import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api } from "../../lib/api";
import type { Lang } from "../../lib/format";
import type { StaffRole } from "../auth";
import type { DataRange } from "../business/queries";

export type PerfPeriod = "week" | "month";
export type PartKey = "rating" | "workload" | "reliability" | "throughput" | "onTime";
/** `value` is absent from `/api/me/performance` for workload and throughput. */
export type BreakdownRow = { key: PartKey; points: number; max: number; value?: number };
export type Group = "floor" | "kitchen" | "bar";

export interface PerfRow {
  staffId: string;
  name: string;
  role: string;
  score: number | null;
  breakdown: BreakdownRow[];
  ratingAvg: number | null;
  ratingCount: number;
  minutes: number;
  plannedMinutes: number;
  lateShifts: number;
}
export interface PerfComment {
  id: string;
  comment: string;
  stars: number | null;
  at: string;
  hidden: boolean;
}
export interface PersonView extends PerfRow {
  range: DataRange;
  history: { week: string; score: number | null }[];
  trend: { week: string; avg: number | null; count: number }[];
  comments: PerfComment[];
}
export interface MyView {
  score: number | null;
  breakdown: BreakdownRow[];
  ratingAvg: number | null;
  ratingCount: number;
  minutes: number;
  plannedMinutes: number;
  lateShifts: number;
  rank: { position: number; of: number } | null;
  comments: { comment: string; stars: number | null; at: string }[];
  range: DataRange;
}

export const performanceKey = ["performance"] as const;

/** "?period=week", plus "&key=2026-11-09" for a chosen week or "&key=2026-10" for a month; no key is the current one. */
export const periodQuery = (period: PerfPeriod, key: string | null) => {
  const p = new URLSearchParams({ period });
  if (key) p.set("key", key);
  return `?${p.toString()}`;
};

/** The shown period lives in the URL, so a link from the ranking to a person keeps it. */
export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const period: PerfPeriod = params.get("period") === "month" ? "month" : "week";
  const key = params.get("key");
  const set = (p: PerfPeriod, k: string | null) => setParams(k ? { period: p, key: k } : { period: p }, { replace: true });
  return { period, key, set, search: periodQuery(period, key) };
}

export const useRanking = (period: PerfPeriod, key: string | null) =>
  useQuery({
    queryKey: [...performanceKey, "ranking", period, key ?? "current"],
    queryFn: () => api<{ groups: Record<Group, PerfRow[]>; range: DataRange }>(`/api/performance/ranking${periodQuery(period, key)}`),
    placeholderData: (prev) => prev,
  });

export const usePerson = (staffId: string, period: PerfPeriod, key: string | null) =>
  useQuery({
    queryKey: [...performanceKey, "person", staffId, period, key ?? "current"],
    queryFn: () => api<PersonView>(`/api/performance/${staffId}${periodQuery(period, key)}`),
    placeholderData: (prev) => prev,
  });

export const useMyPerformance = (period: PerfPeriod, key: string | null) =>
  useQuery({
    queryKey: [...performanceKey, "me", period, key ?? "current"],
    queryFn: () => api<MyView>(`/api/me/performance${periodQuery(period, key)}`),
    placeholderData: (prev) => prev,
  });

/** Hide or unhide a guest comment; the page greys it at once and refetches. */
export function useSetCommentHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      api<{ id: string; commentHidden: boolean }>(`/api/ratings/${id}/${hidden ? "hide" : "unhide"}`, { method: "POST" }),
    onSuccess: (res) => {
      qc.setQueriesData<PersonView>({ queryKey: [...performanceKey, "person"] }, (v) =>
        v ? { ...v, comments: v.comments.map((c) => (c.id === res.id ? { ...c, hidden: res.commentHidden } : c)) } : v,
      );
      void qc.invalidateQueries({ queryKey: performanceKey });
    },
  });
}

/** The group a signed-in role is ranked in, for "2nd of 6 waiters". */
export const rankNoun = (role: StaffRole | undefined): "waiter" | "cook" | "bartender" =>
  role === "kitchen" || role === "cook" ? "cook" : role === "bar" || role === "bartender" ? "bartender" : "waiter";

/** English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. Turkish text puts the number before a full stop. */
export const ordinal = (n: number, lang: Lang): string => {
  if (lang === "tr") return String(n);
  const r100 = n % 100;
  const suffix = r100 >= 11 && r100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** "2026-11" → "2026-10" etc.; shared with the month picker. */
export { monthLabel, shiftMonth } from "../expenses/queries";
