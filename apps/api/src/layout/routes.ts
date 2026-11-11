import { LayoutBody, RoomBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { createRoom, deleteRoom, renameRoom, roomLayout, saveLayout } from "./service";

type IdParams = { Params: { id: string } };

/** Floor plan editor (spec §7). Manager only (`staffRoute([])`). Every write tells floors and managers to refetch. */
export function registerLayoutRoutes(app: FastifyInstance): void {
  const { models } = app;
  const tablesChanged = (tenantId: string, ids: string[]) => app.realtime.emit(tenantId, "tables.changed", { ids }, ["floor", "manager"]);

  app.get<IdParams>("/api/rooms/:id/layout", staffRoute([], async (req) => roomLayout(models, req.params.id)));

  app.put<IdParams>(
    "/api/rooms/:id/layout",
    staffRoute([], async (req) => {
      const body = LayoutBody.parse(req.body);
      const { changedIds } = await saveLayout(models, req.params.id, body);
      // After commit: the save above has returned.
      app.realtime.emit(req.staff.tenantId, "layout.saved", { ids: [req.params.id] }, ["floor", "manager"]);
      tablesChanged(req.staff.tenantId, [...changedIds, req.params.id]);
      return roomLayout(models, req.params.id);
    }),
  );

  app.post(
    "/api/rooms",
    staffRoute([], async (req, reply) => {
      const room = await createRoom(models, RoomBody.parse(req.body).name);
      tablesChanged(req.staff.tenantId, [room.id]);
      return reply.status(201).send(room);
    }),
  );
  app.patch<IdParams>(
    "/api/rooms/:id",
    staffRoute([], async (req) => {
      const room = await renameRoom(models, req.params.id, RoomBody.parse(req.body).name);
      tablesChanged(req.staff.tenantId, [room.id]);
      return room;
    }),
  );
  app.delete<IdParams>(
    "/api/rooms/:id",
    staffRoute([], async (req) => {
      await deleteRoom(models, req.params.id);
      tablesChanged(req.staff.tenantId, [req.params.id]);
      return { ok: true };
    }),
  );
}
