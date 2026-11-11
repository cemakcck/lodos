import {
  CopyWeekBody,
  mondayOf,
  serviceDayOf,
  ShiftBody,
  ShiftPatchBody,
  ShiftTemplateBody,
  ShiftTemplatePatchBody,
  ShiftWeekQuery,
} from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { ALL_ROLES, staffRoute } from "../auth/guard";
import {
  copyLastWeek,
  createShift,
  createTemplate,
  deleteShift,
  deleteTemplate,
  listTemplates,
  myShifts,
  updateShift,
  updateTemplate,
  weekView,
} from "./service";

type IdParams = { Params: { id: string } };

/** The weekly schedule (spec §6.2, §6.4). Editing is manager only (`staffRoute([])`); My shifts is any signed-in role. */
export function registerShiftRoutes(app: FastifyInstance): void {
  const { models } = app;
  const thisWeek = () => mondayOf(serviceDayOf(app.clock.now()));

  app.get("/api/shifts", staffRoute([], async (req) => weekView(models, ShiftWeekQuery.parse(req.query).week ?? thisWeek())));

  app.post(
    "/api/shifts",
    staffRoute([], async (req, reply) => reply.status(201).send({ shift: await createShift(models, ShiftBody.parse(req.body)) })),
  );

  app.post(
    "/api/shifts/copy-last-week",
    staffRoute([], async (req) => copyLastWeek(models, CopyWeekBody.parse(req.body).week)),
  );

  app.patch<IdParams>(
    "/api/shifts/:id",
    staffRoute([], async (req) => ({ shift: await updateShift(models, req.params.id, ShiftPatchBody.parse(req.body ?? {})) })),
  );

  app.delete<IdParams>(
    "/api/shifts/:id",
    staffRoute([], async (req) => {
      await deleteShift(models, req.params.id);
      return { ok: true };
    }),
  );

  app.get("/api/shift-templates", staffRoute([], async () => ({ templates: await listTemplates(models) })));

  app.post(
    "/api/shift-templates",
    staffRoute([], async (req, reply) => reply.status(201).send({ template: await createTemplate(models, ShiftTemplateBody.parse(req.body)) })),
  );

  app.patch<IdParams>(
    "/api/shift-templates/:id",
    staffRoute([], async (req) => ({ template: await updateTemplate(models, req.params.id, ShiftTemplatePatchBody.parse(req.body ?? {})) })),
  );

  app.delete<IdParams>(
    "/api/shift-templates/:id",
    staffRoute([], async (req) => {
      await deleteTemplate(models, req.params.id);
      return { ok: true };
    }),
  );

  app.get("/api/me/shifts", staffRoute(ALL_ROLES, async (req) => myShifts(models, req.staff.id, thisWeek())));
}
