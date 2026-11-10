import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";

/** Stub: a later task replaces the handler body. Manager only. */
export function registerManagerRoutes(app: FastifyInstance): void {
  app.get("/api/manager/menu", staffRoute([], async () => ({ ok: true })));
}
