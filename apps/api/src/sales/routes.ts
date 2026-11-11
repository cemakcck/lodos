import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { parseRange, salesCsv, salesView } from "./service";

type RangeQuery = { Querystring: { range?: string } };

/** Sales dashboard (spec §4). Manager only (`staffRoute([])`), inside the manager's tenant. */
export function registerSalesRoutes(app: FastifyInstance): void {
  const { models } = app;

  app.get<RangeQuery>(
    "/api/sales",
    staffRoute([], async (req) => salesView(models, parseRange(req.query.range), app.clock.now())),
  );

  app.get<RangeQuery>(
    "/api/sales/export.csv",
    staffRoute([], async (req, reply) => {
      const { filename, body } = await salesCsv(models, parseRange(req.query.range), app.clock.now());
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "no-store")
        .send(body);
    }),
  );
}
