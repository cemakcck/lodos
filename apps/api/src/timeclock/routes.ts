import { ClockPunchBody, mondayOf, serviceDayOf, ShiftWeekQuery, TimesheetEntryBody, TimesheetEntryPatchBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { loginTenant } from "../auth/login-tenant";
import { staffRoute } from "../auth/guard";
import { runWithTenant } from "../db/tenancy";
import { addEntry, clockPeople, editEntry, punch, timesheets } from "./service";

/** The time clock (phase 3): the punch screen needs no session; timesheets are manager only. */
export function registerTimeclockRoutes(app: FastifyInstance): void {
  const { models } = app;
  const changed = (tenantId: string, staffId: string) => app.realtime.emit(tenantId, "clock.changed", { ids: [staffId] }, ["manager"]);

  app.get("/api/clock/people", async (req) => runWithTenant(loginTenant(req), () => clockPeople(models)));

  app.post("/api/clock/punch", async (req) => {
    const tenantId = loginTenant(req);
    const { staffId, pin } = ClockPunchBody.parse(req.body);
    const { staffId: who, ...result } = await runWithTenant(tenantId, () =>
      punch(models, { tenantId, ip: req.ip, staffId, pin, now: app.clock.now() }),
    );
    changed(tenantId, who);
    return result;
  });

  app.get(
    "/api/timesheets",
    staffRoute([], async (req) => {
      const now = app.clock.now();
      return timesheets(models, ShiftWeekQuery.parse(req.query).week ?? mondayOf(serviceDayOf(now)), now);
    }),
  );

  app.post(
    "/api/timesheets/entries",
    staffRoute([], async (req, reply) => {
      const body = TimesheetEntryBody.parse(req.body);
      const id = await addEntry(models, body);
      changed(req.staff.tenantId, body.staffId);
      return reply.status(201).send({ id });
    }),
  );

  app.put<{ Params: { id: string } }>(
    "/api/timesheets/entries/:id",
    staffRoute([], async (req) => {
      const staffId = await editEntry(models, req.params.id, TimesheetEntryPatchBody.parse(req.body), { staffId: req.staff.id, now: app.clock.now() });
      changed(req.staff.tenantId, staffId);
      return { ok: true };
    }),
  );
}
