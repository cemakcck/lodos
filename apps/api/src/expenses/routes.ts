import { ExpenseBody, ExpenseCategoryBody, ExpenseQuery, serviceDayOf } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import {
  createCategory,
  createExpense,
  deleteExpense,
  expensesCsv,
  listCategories,
  monthView,
  updateCategory,
  updateExpense,
} from "./service";

type IdParams = { Params: { id: string } };

/** Expenses, categories and budgets (phase 3). Manager only (`staffRoute([])`), inside the manager's tenant. */
export function registerExpenseRoutes(app: FastifyInstance): void {
  const { models } = app;
  const changed = (tenantId: string, ids: string[]) => app.realtime.emit(tenantId, "expense.changed", { ids }, ["manager"]);
  const queryOf = (raw: unknown) => {
    const q = ExpenseQuery.parse(raw);
    return { month: q.month ?? serviceDayOf(app.clock.now()).slice(0, 7), categoryId: q.categoryId };
  };

  app.get(
    "/api/expenses",
    staffRoute([], async (req) => {
      const { month, categoryId } = queryOf(req.query);
      return monthView(models, month, categoryId);
    }),
  );

  app.get(
    "/api/expenses.csv",
    staffRoute([], async (req, reply) => {
      const { month, categoryId } = queryOf(req.query);
      const { filename, body } = await expensesCsv(models, month, categoryId);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .send(body);
    }),
  );

  app.post(
    "/api/expenses",
    staffRoute([], async (req, reply) => {
      const id = await createExpense(models, ExpenseBody.parse(req.body), { staffId: req.staff.id, now: app.clock.now() });
      changed(req.staff.tenantId, [id]);
      return reply.status(201).send({ id });
    }),
  );

  app.put<IdParams>(
    "/api/expenses/:id",
    staffRoute([], async (req) => {
      await updateExpense(models, req.params.id, ExpenseBody.parse(req.body), app.clock.now());
      changed(req.staff.tenantId, [req.params.id]);
      return { ok: true };
    }),
  );

  app.delete<IdParams>(
    "/api/expenses/:id",
    staffRoute([], async (req) => {
      await deleteExpense(models, req.params.id);
      changed(req.staff.tenantId, [req.params.id]);
      return { ok: true };
    }),
  );

  app.get("/api/expense-categories", staffRoute([], async () => ({ categories: await listCategories(models) })));

  app.post(
    "/api/expense-categories",
    staffRoute([], async (req, reply) => {
      const category = await createCategory(models, ExpenseCategoryBody.parse(req.body));
      changed(req.staff.tenantId, [category.id]);
      return reply.status(201).send({ category });
    }),
  );

  app.put<IdParams>(
    "/api/expense-categories/:id",
    staffRoute([], async (req) => {
      const category = await updateCategory(models, req.params.id, ExpenseCategoryBody.parse(req.body));
      changed(req.staff.tenantId, [category.id]);
      return { category };
    }),
  );
}
