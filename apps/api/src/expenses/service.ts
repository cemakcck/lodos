import { serviceDayOf, type ExpenseBody, type ExpenseCategoryBody } from "@lodos/shared";
import { Types } from "mongoose";
import type { Models } from "../db/models/index";
import { ApiError } from "../errors";
import { BOM, csvField, lira } from "../sales/service";

/** Expenses, categories and monthly budgets (phase 3). Must run inside the manager's tenant. */

type Name = { en: string; tr: string };
type Kind = "food_drink" | "other";
export type CategoryRow = { id: string; name: Name; kind: Kind; monthlyBudget: number; archived: boolean };
export type ByCategory = { categoryId: string; name: Name; kind: Kind; spent: number; budget: number };
export type ExpenseRow = { id: string; categoryId: string; amount: number; date: string; payee: string | null; note: string | null };
export type MonthSpend = { foodDrink: number; other: number; byCategory: ByCategory[] };

/** The seven starting categories (spec §6), budgets 0. */
const SEED_CATEGORIES: { name: Name; kind: Kind }[] = [
  { name: { en: "Suppliers – food", tr: "Tedarikçi – yiyecek" }, kind: "food_drink" },
  { name: { en: "Suppliers – drinks", tr: "Tedarikçi – içecek" }, kind: "food_drink" },
  { name: { en: "Rent", tr: "Kira" }, kind: "other" },
  { name: { en: "Utilities", tr: "Faturalar" }, kind: "other" },
  { name: { en: "Repairs and maintenance", tr: "Bakım ve onarım" }, kind: "other" },
  { name: { en: "Marketing", tr: "Pazarlama" }, kind: "other" },
  { name: { en: "Other", tr: "Diğer" }, kind: "other" },
];

/** Creates the starting categories the tenant does not have yet (matched by English name), so calling it twice adds nothing. */
export async function seedExpenseCategories(models: Models): Promise<void> {
  const have = new Set((await models.ExpenseCategory.find({}, { name: 1 }).lean()).map((c) => c.name.en));
  const todo = SEED_CATEGORIES.map((c, sort) => ({ ...c, sort, monthlyBudget: 0 })).filter((c) => !have.has(c.name.en));
  if (todo.length > 0) await models.ExpenseCategory.insertMany(todo);
}

const catRow = (c: { _id: Types.ObjectId; name: Name; kind: Kind; monthlyBudget: number; archived: boolean }): CategoryRow => ({
  id: String(c._id),
  name: { en: c.name.en, tr: c.name.tr },
  kind: c.kind,
  monthlyBudget: c.monthlyBudget,
  archived: c.archived,
});

const expRow = (e: { _id: Types.ObjectId; categoryId: Types.ObjectId; amount: number; date: string; payee?: string | null; note?: string | null }): ExpenseRow => ({
  id: String(e._id),
  categoryId: String(e.categoryId),
  amount: e.amount,
  date: e.date,
  payee: e.payee ?? null,
  note: e.note ?? null,
});

const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
const oid = (id: string, what: string) => {
  if (!Types.ObjectId.isValid(id) || String(new Types.ObjectId(id)) !== id.toLowerCase()) throw notFound(what);
  return new Types.ObjectId(id);
};

export async function listCategories(models: Models): Promise<CategoryRow[]> {
  return (await models.ExpenseCategory.find({}).sort({ sort: 1, _id: 1 }).lean()).map(catRow);
}

export async function createCategory(models: Models, body: ExpenseCategoryBody): Promise<CategoryRow> {
  const last = await models.ExpenseCategory.findOne({}, { sort: 1 }).sort({ sort: -1 }).lean();
  const doc = await models.ExpenseCategory.create({
    name: body.name,
    kind: body.kind,
    monthlyBudget: body.monthlyBudget,
    archived: body.archived ?? false,
    sort: (last?.sort ?? -1) + 1,
  });
  return catRow(doc);
}

/** A category in use (any expense) keeps its kind, because the kind decides where past spending counts. */
export async function updateCategory(models: Models, id: string, body: ExpenseCategoryBody): Promise<CategoryRow> {
  const _id = oid(id, "Category");
  const cat = await models.ExpenseCategory.findById(_id);
  if (!cat) throw notFound("Category");
  if (cat.kind !== body.kind && (await models.Expense.exists({ categoryId: _id }))) {
    throw new ApiError(409, "conflict", "A category with expenses can't change kind");
  }
  cat.name = body.name;
  cat.kind = body.kind;
  cat.monthlyBudget = body.monthlyBudget;
  if (body.archived !== undefined) cat.archived = body.archived;
  await cat.save();
  return catRow(cat);
}

/** The month's spending per category: active categories always, archived ones only when they have spending. */
async function spendOf(models: Models, month: string, categoryId?: Types.ObjectId) {
  const [cats, sums, rows] = await Promise.all([
    models.ExpenseCategory.find({}).sort({ sort: 1, _id: 1 }).lean(),
    models.Expense.aggregate<{ _id: Types.ObjectId; spent: number }>([
      { $match: { date: { $gte: `${month}-01`, $lte: `${month}-31` } } },
      { $group: { _id: "$categoryId", spent: { $sum: "$amount" } } },
    ]),
    models.Expense.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` }, ...(categoryId ? { categoryId } : {}) })
      .sort({ date: -1, _id: -1 })
      .lean(),
  ]);
  const spentBy = new Map(sums.map((s) => [String(s._id), s.spent]));
  const byCategory: ByCategory[] = cats
    .filter((c) => !c.archived || (spentBy.get(String(c._id)) ?? 0) > 0)
    .map((c) => ({ categoryId: String(c._id), name: { en: c.name.en, tr: c.name.tr }, kind: c.kind, spent: spentBy.get(String(c._id)) ?? 0, budget: c.monthlyBudget }));
  return { byCategory, rows };
}

/** Food-and-drink and other spending of calendar month `month` ("YYYY-MM"), for the profit view. */
export async function expensesForMonth(models: Models, month: string): Promise<MonthSpend> {
  const { byCategory } = await spendOf(models, month);
  const sum = (kind: Kind) => byCategory.filter((c) => c.kind === kind).reduce((n, c) => n + c.spent, 0);
  return { foodDrink: sum("food_drink"), other: sum("other"), byCategory };
}

export async function monthView(models: Models, month: string, categoryId?: string) {
  const { byCategory, rows } = await spendOf(models, month, categoryId ? oid(categoryId, "Category") : undefined);
  return {
    month,
    expenses: rows.map(expRow),
    byCategory,
    total: byCategory.reduce((n, c) => n + c.spent, 0),
    budgetTotal: byCategory.reduce((n, c) => n + c.budget, 0),
  };
}

/** A real expense: an active category of this tenant and a date that is not after the app clock's service day. */
async function checked(models: Models, body: ExpenseBody, now: Date) {
  if (body.date > serviceDayOf(now)) throw new ApiError(400, "validation", "The date can't be in the future");
  const cat = await models.ExpenseCategory.findById(oid(body.categoryId, "Category"), { archived: 1 }).lean();
  if (!cat) throw notFound("Category");
  if (cat.archived) throw new ApiError(400, "validation", "That category is archived");
  return {
    categoryId: cat._id,
    amount: body.amount,
    date: body.date,
    payee: body.payee || null,
    note: body.note || null,
  };
}

export async function createExpense(models: Models, body: ExpenseBody, ctx: { staffId: string; now: Date }): Promise<string> {
  const doc = await models.Expense.create({ ...(await checked(models, body, ctx.now)), createdBy: new Types.ObjectId(ctx.staffId) });
  return String(doc._id);
}

export async function updateExpense(models: Models, id: string, body: ExpenseBody, now: Date): Promise<void> {
  const _id = oid(id, "Expense");
  const res = await models.Expense.updateOne({ _id }, { $set: await checked(models, body, now) });
  if (res.matchedCount === 0) throw notFound("Expense");
}

export async function deleteExpense(models: Models, id: string): Promise<void> {
  const res = await models.Expense.deleteOne({ _id: oid(id, "Expense") });
  if (res.deletedCount === 0) throw notFound("Expense");
}

const CSV_HEADER = "date,category_en,category_tr,kind,amount_lira,payee,note";

/** One row per expense of the month (optionally one category), oldest first. */
export async function expensesCsv(models: Models, month: string, categoryId?: string): Promise<{ filename: string; body: string }> {
  const [{ rows }, cats] = await Promise.all([
    spendOf(models, month, categoryId ? oid(categoryId, "Category") : undefined),
    models.ExpenseCategory.find({}).lean(),
  ]);
  const catById = new Map(cats.map((c) => [String(c._id), c]));
  const lines = [CSV_HEADER];
  for (const e of [...rows].reverse()) {
    const c = catById.get(String(e.categoryId));
    lines.push(
      [csvField(e.date), csvField(c?.name.en ?? ""), csvField(c?.name.tr ?? ""), csvField(c?.kind ?? ""), lira(e.amount), csvField(e.payee ?? ""), csvField(e.note ?? "")].join(","),
    );
  }
  return { filename: `lodos-expenses-${month}.csv`, body: BOM + lines.join("\r\n") + "\r\n" };
}
