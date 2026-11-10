import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";

/** Stub: a later task replaces the handler body. Waiter + manager. */
export function registerFloorRoutes(app: FastifyInstance): void {
  app.get("/api/floor", staffRoute(["waiter"], async () => ({ ok: true })));
}
