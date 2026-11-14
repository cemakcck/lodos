import { PerformanceQuery } from "@lodos/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ALL_ROLES, staffRoute } from "../auth/guard";
import { assertMonth, assertWeek, dataRange } from "../ops/range";
import { myPerformance, personPerformance, ranking } from "./service";

type IdParams = { Params: { staffId: string } };

/** Staff performance (phase 3): rankings and one person's page for managers, "my performance" for any login role. */
export function registerPerformanceRoutes(app: FastifyInstance): void {
  const { models } = app;

  /** The query, checked against the data range (400 outside it, before anything is read or stored), and the range for the picker. */
  const periodOf = async (req: FastifyRequest) => {
    const q = PerformanceQuery.parse(req.query);
    const now = app.clock.now();
    const range = await dataRange(models, now);
    if (q.key !== undefined) {
      if (q.period === "month") assertMonth(range, q.key);
      else assertWeek(range, q.key, now);
    }
    return { q, now, range };
  };

  app.get(
    "/api/performance/ranking",
    staffRoute([], async (req) => {
      const { q, now, range } = await periodOf(req);
      return { ...(await ranking(models, q, now)), range };
    }),
  );

  app.get<IdParams>(
    "/api/performance/:staffId",
    staffRoute([], async (req) => {
      const { q, now, range } = await periodOf(req);
      return { ...(await personPerformance(models, req.params.staffId, q, now)), range };
    }),
  );

  app.get(
    "/api/me/performance",
    staffRoute(ALL_ROLES, async (req) => {
      const { q, now, range } = await periodOf(req);
      return { ...(await myPerformance(models, req.staff, q, now)), range };
    }),
  );
}
