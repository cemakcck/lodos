import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { menuView } from "./view";

/** The orderable menu for waiter order entry (waiter + manager). Same shape as `GET /api/guest/menu`. */
export function registerMenuRoutes(app: FastifyInstance): void {
  app.get(
    "/api/menu",
    staffRoute(["waiter"], async (req) => menuView(req.server.models, req.server.clock.now())),
  );
}
