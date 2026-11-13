import { PerformanceQuery } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { ALL_ROLES, staffRoute } from "../auth/guard";
import { myPerformance, personPerformance, ranking } from "./service";

type IdParams = { Params: { staffId: string } };

/** Staff performance (phase 3): rankings and one person's page for managers, "my performance" for any login role. */
export function registerPerformanceRoutes(app: FastifyInstance): void {
  const { models } = app;

  app.get(
    "/api/performance/ranking",
    staffRoute([], async (req) => ranking(models, PerformanceQuery.parse(req.query), app.clock.now())),
  );

  app.get<IdParams>(
    "/api/performance/:staffId",
    staffRoute([], async (req) => personPerformance(models, req.params.staffId, PerformanceQuery.parse(req.query), app.clock.now())),
  );

  app.get(
    "/api/me/performance",
    staffRoute(ALL_ROLES, async (req) => myPerformance(models, req.staff, PerformanceQuery.parse(req.query), app.clock.now())),
  );
}
