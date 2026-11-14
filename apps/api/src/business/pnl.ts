import { monthDays, serviceDayOf } from "@lodos/shared";
import type { Models } from "../db/models";
import { expensesForMonth, type ByCategory } from "../expenses/service";
import { opsForDays } from "../ops/daily";
import { ensureSummaries } from "../sales/summary";

/** Profit and loss (spec §8.1, plan "Money reconciles"). All amounts in kuruş; cash basis (spec §13.5). */
export type Pnl = {
  sales: number;
  foodDrink: number;
  labour: number;
  other: number;
  otherByCategory: ByCategory[];
  profit: number;
  /** profit ÷ sales; null when there are no sales. */
  margin: number | null;
};

/**
 * THE P&L of a month: sales from the daily summaries, labour as Σ people.labourCost from the ops reader, expenses
 * by category kind. `days` defaults to the month's service days up to today; the monthly page passes the
 * comparison days for the previous month, and expenses then count up to the last of them. Run inside the tenant.
 */
export async function monthlyPnl(models: Models, month: string, now: Date, days: string[] = monthDays(month, serviceDayOf(now))): Promise<Pnl> {
  if (days.length === 0) return { sales: 0, foodDrink: 0, labour: 0, other: 0, otherByCategory: [], profit: 0, margin: null };
  const [summaries, ops, spend] = await Promise.all([
    ensureSummaries(models, days, serviceDayOf(now)),
    opsForDays(models, days, now),
    expensesForMonth(models, month, days[days.length - 1]),
  ]);
  let sales = 0;
  let labour = 0;
  for (const d of days) {
    sales += summaries.get(d)!.revenue;
    for (const p of ops.get(d)!.people) labour += p.labourCost;
  }
  const profit = sales - spend.foodDrink - labour - spend.other;
  return {
    sales,
    foodDrink: spend.foodDrink,
    labour,
    other: spend.other,
    otherByCategory: spend.byCategory.filter((c) => c.kind === "other"),
    profit,
    margin: sales === 0 ? null : profit / sales,
  };
}
