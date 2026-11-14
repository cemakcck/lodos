import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Name } from "../expenses/queries";
import type { Group, PerfRow } from "../performance/queries";
import type { Pnl } from "./queries";

/** The response of `GET /api/business/overview` (apps/api/src/business/overview.ts). Money in kuruş. */
export type Attendance = "on_shift" | "late" | "missing" | "later" | "finished" | "unscheduled" | "forgot_out";

export interface WorkingRow {
  staffId: string;
  name: string;
  role: string;
  status: Attendance;
  lateMin?: number;
  /** First clock-in today (ISO). */
  in?: string;
  shift?: { start: string; end: string };
}
export interface DishRow {
  itemId: string | null;
  name: Name;
  avg: number;
  count: number;
}
export interface LatestExpense {
  id: string;
  amount: number;
  date: string;
  payee: string | null;
  note: string | null;
  category: Name;
}

export interface OverviewView {
  today: { sales: number; salesPrev: number; covers: number; coversPrev: number };
  rating7d: { restaurant: number | null; prev: number | null };
  /** The current month, "YYYY-MM"; `month` is it so far. */
  monthKey: string;
  month: Pnl & { budgetTotal: number; expensesTotal: number };
  /** The previous month to the same point (the monthly page's `pnl.prev`). */
  monthPrev: Pnl;
  working: WorkingRow[];
  topStaff: Record<Group, PerfRow[]>;
  expenses: { total: number; budget: number; latest: LatestExpense[] };
  dishes: { best: DishRow[]; needsWork: DishRow[] };
}

/** The live hook (`useLive`) invalidates this key on clock, rating, expense and check events. */
export const overviewKey = ["overview"] as const;

export const useOverview = () => useQuery({ queryKey: overviewKey, queryFn: () => api<OverviewView>("/api/business/overview") });
