import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

export type Name = { en: string; tr: string };
export type Kind = "food_drink" | "other";

export interface ExpenseRow {
  id: string;
  categoryId: string;
  /** Kuruş. */
  amount: number;
  date: string;
  payee: string | null;
  note: string | null;
}

export interface ByCategory {
  categoryId: string;
  name: Name;
  kind: Kind;
  spent: number;
  budget: number;
}

export interface ExpensesView {
  month: string;
  expenses: ExpenseRow[];
  /** Ignores the category filter, like `total` and `budgetTotal`. */
  byCategory: ByCategory[];
  total: number;
  budgetTotal: number;
}

export interface CategoryRow {
  id: string;
  name: Name;
  kind: Kind;
  monthlyBudget: number;
  archived: boolean;
}

export interface ExpenseInput {
  categoryId: string;
  amount: number;
  date: string;
  payee: string | null;
  note: string | null;
}

export const expensesKey = ["expenses"] as const;

/** "?month=2026-11&categoryId=x"; with no month the server's current month. */
export const expensesQuery = (month: string | null, categoryId: string) => {
  const p = new URLSearchParams();
  if (month) p.set("month", month);
  if (categoryId) p.set("categoryId", categoryId);
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** `null` month: the server's current month. */
export const useExpenses = (month: string | null, categoryId: string) =>
  useQuery({
    queryKey: [...expensesKey, "month", month ?? "current", categoryId],
    queryFn: () => api<ExpensesView>(`/api/expenses${expensesQuery(month, categoryId)}`),
    placeholderData: (prev) => prev,
  });

export const useCategories = () =>
  useQuery({
    queryKey: [...expensesKey, "categories"],
    queryFn: async () => (await api<{ categories: CategoryRow[] }>("/api/expense-categories")).categories,
  });

export const refreshExpenses = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: expensesKey });

/** "2026-11" → "November 2026". */
export const monthLabel = (month: string, lang: "en" | "tr") => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
