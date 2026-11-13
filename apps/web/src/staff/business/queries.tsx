import { useQuery } from "@tanstack/react-query";
import type { MenuGroup, ScheduleGroup } from "@lodos/shared";
import { api } from "../../lib/api";
import type { ByCategory, Name } from "../expenses/queries";
import type { Group, PerfRow } from "../performance/queries";

/** The response of `GET /api/business/monthly` (apps/api/src/business/monthly.ts). Money in kuruş. */
export type Pair<T> = { cur: T; prev: T };
export type Period = { month: string; from: string | null; to: string | null; days: number };
export type Dist = number[];

export interface Pnl {
  sales: number;
  foodDrink: number;
  labour: number;
  other: number;
  otherByCategory: ByCategory[];
  profit: number;
  /** A ratio (0.148), null with no sales. */
  margin: number | null;
}

export interface SalesPatterns {
  byDay: Pair<{ day: string; revenue: number; covers: number; checks: number }[]>;
  /** ISO weekday 1 (Monday) … 7. */
  byWeekday: Pair<{ weekday: number; revenue: number; nights: number; avg: number }[]>;
  byHour: Pair<{ hour: number; revenue: number }[]>;
  avgCheck: Pair<number>;
  avgCover: Pair<number>;
  covers: Pair<number>;
  salesPerLabourHour: Pair<number | null>;
  turnsPerNight: Pair<number | null>;
}

export interface MenuRow {
  itemId: string | null;
  name: Name;
  qty: number;
  revenue: number;
  ratingAvg: number | null;
  ratingCount: number;
  group: MenuGroup | null;
  prev: { qty: number; revenue: number; ratingAvg: number | null; ratingCount: number };
}

export interface StaffRow extends PerfRow {
  group: Group;
  labourCost: number;
  prev: { score: number | null; minutes: number; labourCost: number };
}

export interface WeekRatings {
  week: string;
  restaurant: number | null;
  food: number | null;
  cleanliness: number | null;
  atmosphere: number | null;
  count: number;
}
export interface MonthComment {
  id: string;
  comment: string;
  at: string;
  serviceDay: string;
}
export interface BigExpense {
  id: string;
  amount: number;
  date: string;
  payee: string | null;
  note: string | null;
  categoryId: string;
  category: Name;
}

export interface MonthlyView {
  month: string;
  /** True when `month` is the current month. */
  soFar: boolean;
  current: Period;
  previous: Period;
  pnl: Pair<Pnl>;
  sales: SalesPatterns;
  menu: MenuRow[];
  staff: StaffRow[];
  labourByGroup: Pair<Record<ScheduleGroup, number>>;
  overtimeMinutes: Pair<number>;
  ratings: {
    restaurant: Pair<number | null>;
    food: Pair<number | null>;
    cleanliness: Pair<number | null>;
    atmosphere: Pair<number | null>;
    dist: { restaurant: Pair<Dist>; waiter: Pair<Dist>; dish: Pair<Dist> };
    byWeek: Pair<WeekRatings[]>;
    comments: MonthComment[];
  };
  expenses: { byCategory: Pair<ByCategory[]>; total: Pair<number>; budgetTotal: number; biggest: BigExpense[] };
}

export const businessKey = ["business"] as const;

/** `null` month: the server's current month. */
export const useMonthly = (month: string | null) =>
  useQuery({
    queryKey: [...businessKey, "monthly", month ?? "current"],
    queryFn: () => api<MonthlyView>(`/api/business/monthly${month ? `?month=${month}` : ""}`),
    placeholderData: (prev) => prev,
  });

export const csvHref = (month: string, section: "menu" | "staff" | "expenses" | "days") => `/api/business/monthly.csv?month=${month}&section=${section}`;
export const pdfHref = (month: string, lang: "en" | "tr") => `/api/business/monthly.pdf?month=${month}&lang=${lang}`;

/** How many months before the current one the picker may go: the demo history is about 120 days. */
export const MONTHS_BACK = 4;

export { monthLabel, shiftMonth } from "../expenses/queries";
