import { personRoom, StaffCreateBody, StaffPatchBody, StaffPinBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute, type StaffRequest } from "../auth/guard";
import { roleRooms } from "../realtime/io";
import {
  createStaff,
  deactivateStaff,
  listStaff,
  reactivateStaff,
  resetPin,
  updateStaff,
  type StaffCtx,
  type StaffEffects,
} from "./service";

type IdParams = { Params: { id: string } };

/** Staff management (spec §5). Manager only (`staffRoute([])`), inside the manager's tenant. */
export function registerStaffRoutes(app: FastifyInstance): void {
  const { models } = app;
  const ctxOf = (req: StaffRequest): StaffCtx => ({ requesterId: req.staff.id, demoMode: app.demoMode, tenantId: req.staff.tenantId });

  /** Announces a committed write: table sections, ended sessions (event first, then the disconnect), moved rooms. */
  const announce = (tenantId: string, staffId: string, fx: StaffEffects): void => {
    if (fx.changedTableIds.length > 0) app.realtime.emit(tenantId, "tables.changed", { ids: fx.changedTableIds }, ["floor", "manager"]);
    const own = app.io.in(personRoom(tenantId, staffId));
    if (fx.sessionsEnded) {
      app.realtime.emit(tenantId, "session.ended", { ids: [staffId] }, ["person"]);
      own.disconnectSockets(true);
    } else if (fx.roleMoved) {
      // A signed-in person whose role changed keeps their sockets, in the new role's rooms only.
      const next = roleRooms(tenantId, fx.roleMoved.to);
      own.socketsLeave(roleRooms(tenantId, fx.roleMoved.from).filter((r) => !next.includes(r)));
      own.socketsJoin(next);
    }
  };

  app.get("/api/staff", staffRoute([], async (req) => listStaff(models, ctxOf(req))));

  app.post(
    "/api/staff",
    staffRoute([], async (req, reply) => {
      const { row, fx } = await createStaff(models, StaffCreateBody.parse(req.body), ctxOf(req));
      announce(req.staff.tenantId, row.id, fx);
      return reply.status(201).send({ staff: row });
    }),
  );

  app.patch<IdParams>(
    "/api/staff/:id",
    staffRoute([], async (req) => {
      const { row, fx } = await updateStaff(models, req.params.id, StaffPatchBody.parse(req.body ?? {}), ctxOf(req));
      announce(req.staff.tenantId, row.id, fx);
      return { staff: row, unassignedTables: fx.unassignedTables };
    }),
  );

  app.post<IdParams>(
    "/api/staff/:id/pin",
    staffRoute([], async (req) => {
      await resetPin(models, req.params.id, StaffPinBody.parse(req.body).pin, ctxOf(req));
      return { ok: true };
    }),
  );

  app.post<IdParams>(
    "/api/staff/:id/deactivate",
    staffRoute([], async (req) => {
      const { row, fx } = await deactivateStaff(models, req.params.id, ctxOf(req));
      announce(req.staff.tenantId, row.id, fx);
      return { staff: row, unassignedTables: fx.unassignedTables };
    }),
  );

  app.post<IdParams>(
    "/api/staff/:id/reactivate",
    staffRoute([], async (req) => ({ staff: await reactivateStaff(models, req.params.id, ctxOf(req)) })),
  );
}
