import { MonthSchema, serviceDayOf } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { staffRoute } from "../auth/guard";
import { assertMonth, dataRange } from "../ops/range";
import { CSV_SECTIONS, monthlyCsv, monthlyView } from "./monthly";
import { overviewView } from "./overview";
import { monthlyPdf } from "./pdf";

const MonthQuery = z.object({ month: MonthSchema.optional() });
const PdfQuery = MonthQuery.extend({ lang: z.enum(["en", "tr"]).default("en") });
const CsvQuery = MonthQuery.extend({ section: z.enum(CSV_SECTIONS) });

/** The monthly business dashboard (spec §8): data, PDF and CSV. Manager only (`staffRoute([])`), inside the manager's tenant. */
export function registerBusinessRoutes(app: FastifyInstance): void {
  const { models } = app;
  /** The month's view and the data range; a month outside the range is a 400 before anything is read or stored. */
  const viewOf = async (q: { month?: string }) => {
    const now = app.clock.now();
    const range = await dataRange(models, now);
    const month = q.month ?? serviceDayOf(now).slice(0, 7);
    assertMonth(range, month);
    return { ...(await monthlyView(models, month, now)), range };
  };

  app.get(
    "/api/business/overview",
    staffRoute([], async () => overviewView(models, app.clock.now())),
  );

  app.get(
    "/api/business/monthly",
    staffRoute([], async (req) => viewOf(MonthQuery.parse(req.query))),
  );

  app.get(
    "/api/business/monthly.pdf",
    staffRoute([], async (req, reply) => {
      const q = PdfQuery.parse(req.query);
      const [view, tenant] = await Promise.all([viewOf(q), models.Tenant.findOne({}, { name: 1 }).lean()]);
      const filename = `lodos-monthly-${view.month}.pdf`;
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .send(await monthlyPdf({ restaurant: tenant?.name ?? "Lodos", view }, q.lang));
    }),
  );

  app.get(
    "/api/business/monthly.csv",
    staffRoute([], async (req, reply) => {
      const q = CsvQuery.parse(req.query);
      const { filename, body } = monthlyCsv(await viewOf(q), q.section);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .send(body);
    }),
  );
}
