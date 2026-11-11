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
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ALL_ROLES, staffRoute } from "../auth/guard";
import { isOid, notFound } from "../kds/service";
import { allPersonalPdf, personalData, personalPdf, slug, weekRosterPdf } from "./pdf";
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

const PdfQuery = ShiftWeekQuery.extend({ lang: z.enum(["en", "tr"]).default("en") });

const sendPdf = (reply: FastifyReply, filename: string, body: Buffer) =>
  reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .header("Cache-Control", "no-store")
    .send(body);

/** The weekly schedule (spec §6.2, §6.4). Editing is manager only (`staffRoute([])`); My shifts is any signed-in role. */
export function registerShiftRoutes(app: FastifyInstance): void {
  const { models } = app;
  const thisWeek = () => mondayOf(serviceDayOf(app.clock.now()));

  app.get("/api/shifts", staffRoute([], async (req) => weekView(models, ShiftWeekQuery.parse(req.query).week ?? thisWeek())));

  const restaurantName = async (): Promise<string> => (await models.Tenant.findOne({}, { name: 1 }).lean())?.name ?? "Lodos";

  app.get(
    "/api/shifts/pdf/week",
    staffRoute([], async (req, reply) => {
      const q = PdfQuery.parse(req.query);
      const view = await weekView(models, q.week ?? thisWeek());
      return sendPdf(reply, `lodos-roster-${view.week}.pdf`, await weekRosterPdf({ restaurant: await restaurantName(), view }, q.lang));
    }),
  );

  app.get<{ Params: { staffId: string } }>(
    "/api/shifts/pdf/person/:staffId",
    staffRoute([], async (req, reply) => {
      const q = PdfQuery.parse(req.query);
      const view = await weekView(models, q.week ?? thisWeek());
      const person = isOid(req.params.staffId) ? view.people.find((p) => p.id === req.params.staffId) : undefined;
      if (!person) throw notFound();
      const data = personalData(await restaurantName(), view, person);
      return sendPdf(reply, `lodos-shifts-${slug(person.name)}-${view.week}.pdf`, await personalPdf(data, q.lang));
    }),
  );

  app.get(
    "/api/shifts/pdf/people",
    staffRoute([], async (req, reply) => {
      const q = PdfQuery.parse(req.query);
      const view = await weekView(models, q.week ?? thisWeek());
      const restaurant = await restaurantName();
      const all = view.people.map((p) => personalData(restaurant, view, p));
      const empty = personalData(restaurant, view, { id: "", name: restaurant });
      return sendPdf(reply, `lodos-shifts-all-${view.week}.pdf`, await allPersonalPdf(all, q.lang, empty));
    }),
  );

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

  app.get(
    "/api/me/shifts/pdf",
    staffRoute(ALL_ROLES, async (req, reply) => {
      const q = PdfQuery.parse(req.query);
      const view = await weekView(models, q.week ?? thisWeek());
      const data = personalData(await restaurantName(), view, { id: req.staff.id, name: req.staff.name });
      return sendPdf(reply, `lodos-shifts-${slug(req.staff.name)}-${view.week}.pdf`, await personalPdf(data, q.lang));
    }),
  );
}
