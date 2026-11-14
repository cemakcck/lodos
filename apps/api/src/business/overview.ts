import { addDays, attendanceStatus, avgOf, emptyAgg, mergeRatingAgg, restaurantRating, serviceDayOf, type Attendance, type RatingAgg } from "@lodos/shared";
import type { Models } from "../db/models";
import { expensesForMonth } from "../expenses/service";
import { opsForDays } from "../ops/daily";
import { RANKED_GROUPS, rankingForDays, type RankedGroup, type Row } from "../performance/service";
import { salesView } from "../sales/service";
import { monthlyPnl, type Pnl } from "./pnl";

/**
 * The manager's "Today first" overview (spec §9): today against the same weekday last week, the guest rating, the
 * month's P&L (the very `monthlyPnl` the monthly page shows), who is working, the last 7 days' top staff, expenses and
 * dishes. Presentation-free. Run inside the tenant.
 */
type Name = { en: string; tr: string };
export type WorkingRow = {
  staffId: string;
  name: string;
  role: string;
  status: Attendance;
  lateMin?: number;
  /** First clock-in today (ISO), when there is one. */
  in?: string;
  shift?: { start: string; end: string };
};
export type DishRow = { itemId: string | null; name: Name; avg: number; count: number };
export type LatestExpense = { id: string; amount: number; date: string; payee: string | null; note: string | null; category: Name };

export type Overview = {
  today: { sales: number; salesPrev: number; covers: number; coversPrev: number };
  rating7d: { restaurant: number | null; prev: number | null };
  month: Pnl & { budgetTotal: number; expensesTotal: number };
  working: WorkingRow[];
  topStaff: Record<RankedGroup, Row[]>;
  expenses: { total: number; budget: number; latest: LatestExpense[] };
  dishes: { best: DishRow[]; needsWork: DishRow[] };
};

const TOP = 3;
const LATEST = 3;
const DISH_MIN_RATINGS = 5;
const NEEDS_WORK_BELOW = 4.0;
const WINDOW_DAYS = 7;

const emptyRatings = (): RatingAgg => ({ waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() });
const daysEnding = (last: string, n: number) => Array.from({ length: n }, (_, i) => addDays(last, i - n + 1));

async function workingNow(models: Models, today: string, now: Date): Promise<WorkingRow[]> {
  const [shifts, entries] = await Promise.all([
    models.Shift.find({ serviceDay: today }).sort({ start: 1 }).lean(),
    // Today's entries, plus any open one (a clock-in from an earlier day still running).
    models.ClockEntry.find({ $or: [{ serviceDay: today }, { out: null }] }).sort({ in: 1 }).lean(),
  ]);
  const ids = new Set([...shifts.map((s) => String(s.staffId)), ...entries.map((e) => String(e.staffId))]);
  const staff = await models.Staff.find({ _id: { $in: [...ids] } }, { name: 1, role: 1 }).lean();
  const who = new Map(staff.map((s) => [String(s._id), s]));
  const rows: { row: WorkingRow; start: number }[] = [];
  for (const id of ids) {
    const person = who.get(id);
    if (!person) continue;
    const shift = shifts.find((s) => String(s.staffId) === id) ?? null; // earliest, the list is sorted
    const mine = entries.filter((e) => String(e.staffId) === id);
    const { status, lateMin } = attendanceStatus(shift, mine.map((e) => ({ in: e.in, out: e.out ?? null })), now);
    const first = mine[0];
    const row: WorkingRow = {
      staffId: id,
      name: person.name,
      role: person.role,
      status,
      ...(lateMin !== undefined ? { lateMin } : {}),
      ...(first ? { in: first.in.toISOString() } : {}),
      ...(shift ? { shift: { start: shift.start.toISOString(), end: shift.end.toISOString() } } : {}),
    };
    rows.push({ row, start: shift ? shift.start.getTime() : Infinity });
  }
  return rows.sort((a, b) => a.start - b.start || a.row.name.localeCompare(b.row.name)).map((r) => r.row);
}

function dishesOf(r: RatingAgg): Overview["dishes"] {
  const rows = r.dishes
    .filter((d) => d.count >= DISH_MIN_RATINGS)
    .map((d): DishRow => ({ itemId: d.itemId, name: { en: d.name.en, tr: d.name.tr }, avg: avgOf(d)!, count: d.count }));
  const byName = (a: DishRow, b: DishRow) => a.name.en.localeCompare(b.name.en);
  return {
    best: [...rows].sort((a, b) => b.avg - a.avg || b.count - a.count || byName(a, b)).slice(0, TOP),
    needsWork: rows.filter((d) => d.avg < NEEDS_WORK_BELOW).sort((a, b) => a.avg - b.avg || byName(a, b)),
  };
}

async function latestExpenses(models: Models): Promise<LatestExpense[]> {
  const [rows, cats] = await Promise.all([
    models.Expense.find({}).sort({ date: -1, _id: -1 }).limit(LATEST).lean(),
    models.ExpenseCategory.find({}, { name: 1 }).lean(),
  ]);
  const nameOf = new Map(cats.map((c) => [String(c._id), { en: c.name.en, tr: c.name.tr }]));
  return rows.map((e) => ({
    id: String(e._id), amount: e.amount, date: e.date, payee: e.payee ?? null, note: e.note ?? null,
    category: nameOf.get(String(e.categoryId)) ?? { en: "", tr: "" },
  }));
}

export async function overviewView(models: Models, now: Date): Promise<Overview> {
  const today = serviceDayOf(now);
  const month = today.slice(0, 7);
  const last7 = daysEnding(today, WINDOW_DAYS);
  const prev7 = daysEnding(addDays(today, -WINDOW_DAYS), WINDOW_DAYS);
  const [sales, pnl, spend, ops, rankings, working, latest] = await Promise.all([
    salesView(models, "today", now),
    monthlyPnl(models, month, now),
    expensesForMonth(models, month, today),
    opsForDays(models, [...prev7, ...last7], now),
    // Top staff over the rolling last 7 service days (today included), so a Monday isn't empty.
    rankingForDays(models, last7, now),
    workingNow(models, today, now),
    latestExpenses(models),
  ]);
  const ratingsOf = (days: string[]) => days.reduce((a, d) => mergeRatingAgg(a, ops.get(d)!.ratings), emptyRatings());
  const cur = ratingsOf(last7);
  const expensesTotal = spend.byCategory.reduce((n, c) => n + c.spent, 0);
  const budgetTotal = spend.byCategory.reduce((n, c) => n + c.budget, 0);
  return {
    today: { sales: sales.current.revenue, salesPrev: sales.previous.revenue, covers: sales.current.covers, coversPrev: sales.previous.covers },
    rating7d: { restaurant: restaurantRating(cur), prev: restaurantRating(ratingsOf(prev7)) },
    month: { ...pnl, budgetTotal, expensesTotal },
    working,
    topStaff: Object.fromEntries(RANKED_GROUPS.map((g) => [g, rankings[g].filter((r) => r.score !== null).slice(0, TOP)])) as Record<RankedGroup, Row[]>,
    expenses: { total: expensesTotal, budget: budgetTotal, latest },
    dishes: dishesOf(cur),
  };
}
