import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { ApiError } from "../errors";

/** Stub: Task 9 replaces the handler body; the guard stays. `/api/kds/kitchen` is kitchen + manager, `/api/kds/bar` bar + manager. */
export function registerKdsRoutes(app: FastifyInstance): void {
  app.get<{ Params: { station: string } }>(
    "/api/kds/:station",
    staffRoute(
      (req) => {
        const { station } = req.params as { station: string };
        return station === "kitchen" || station === "bar" ? [station] : [];
      },
      async (req) => {
        if (req.params.station !== "kitchen" && req.params.station !== "bar") throw new ApiError(404, "not_found");
        return { ok: true };
      },
    ),
  );
}
