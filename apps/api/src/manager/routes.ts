import { randomBytes } from "node:crypto";
import multipart from "@fastify/multipart";
import { AvailabilityInput, CategoryInput, MenuItemInput, TableEdit, tableRoom } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { unscoped } from "../db/tenancy";
import { ApiError } from "../errors";
import { isOid, notFound } from "../kds/service";
import {
  MAX_PHOTO_BYTES,
  createCategory,
  createItem,
  deactivateItem,
  deleteCategory,
  managerMenu,
  setAvailability,
  setItemPhoto,
  updateCategory,
  updateItem,
} from "./menu";
import { tonight } from "./tonight";

type IdParams = { Params: { id: string } };
const isDuplicate = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;
const conflictOn = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (isDuplicate(e)) throw new ApiError(409, "conflict", "Already exists");
    throw e;
  }
};

/** Manager API. Every route is manager-only (`staffRoute([])`) and runs inside the manager's tenant. */
export function registerManagerRoutes(app: FastifyInstance): void {
  const { models } = app;
  const emit = (tenantId: string, ev: "menu.changed" | "availability.changed" | "tables.changed", ids: string[]) =>
    app.realtime.emit(tenantId, ev, { ids }, ev === "tables.changed" ? ["floor", "manager"] : ["all"]);

  app.get("/api/manager/menu", staffRoute([], async () => managerMenu(models, app.clock.now())));

  app.post(
    "/api/manager/categories",
    staffRoute([], async (req, reply) => {
      const c = await conflictOn(() => createCategory(models, CategoryInput.parse(req.body)));
      emit(req.staff.tenantId, "menu.changed", [c.id]);
      return reply.status(201).send(c);
    }),
  );
  app.patch<IdParams>(
    "/api/manager/categories/:id",
    staffRoute([], async (req) => {
      const c = await conflictOn(() => updateCategory(models, req.params.id, CategoryInput.partial().parse(req.body)));
      emit(req.staff.tenantId, "menu.changed", [c.id]);
      return c;
    }),
  );
  app.delete<IdParams>(
    "/api/manager/categories/:id",
    staffRoute([], async (req) => {
      await deleteCategory(models, req.params.id);
      emit(req.staff.tenantId, "menu.changed", [req.params.id]);
      return { ok: true };
    }),
  );

  app.post(
    "/api/manager/items",
    staffRoute([], async (req, reply) => {
      const item = await conflictOn(() => createItem(models, MenuItemInput.parse(req.body)));
      emit(req.staff.tenantId, "menu.changed", [item.id]);
      return reply.status(201).send(item);
    }),
  );
  app.patch<IdParams>(
    "/api/manager/items/:id",
    staffRoute([], async (req) => {
      // Only the keys the client sent: a partial parse must not re-apply schema defaults to the rest.
      const body = MenuItemInput.partial().parse(req.body);
      const sent = Object.fromEntries(Object.entries(body).filter(([k]) => k in ((req.body ?? {}) as object)));
      const item = await conflictOn(() => updateItem(models, req.params.id, sent));
      emit(req.staff.tenantId, "menu.changed", [item.id]);
      return item;
    }),
  );
  app.delete<IdParams>(
    "/api/manager/items/:id",
    staffRoute([], async (req) => {
      await deactivateItem(models, req.params.id);
      emit(req.staff.tenantId, "menu.changed", [req.params.id]);
      return { ok: true };
    }),
  );

  app.post<{ Params: { itemId: string } }>(
    "/api/manager/availability/:itemId",
    staffRoute([], async (req) => {
      const out = await setAvailability(models, req.params.itemId, AvailabilityInput.parse(req.body ?? {}), app.clock.now());
      emit(req.staff.tenantId, "availability.changed", [out.itemId]);
      return out;
    }),
  );

  app.get(
    "/api/manager/tables",
    staffRoute([], async () => {
      const rows = await models.Table.find({}).sort({ name: 1 }).lean();
      return rows.map((r) => ({ id: String(r._id), name: r.name, capacity: r.capacity, roomId: String(r.roomId), active: r.active, token: r.token }));
    }),
  );
  app.patch<IdParams>(
    "/api/manager/tables/:id",
    staffRoute([], async (req) => {
      const body = TableEdit.parse(req.body);
      if (!isOid(req.params.id)) throw notFound();
      const row = await conflictOn(() => models.Table.findOneAndUpdate({ _id: req.params.id }, { $set: body }, { returnDocument: "after" }).lean());
      if (!row) throw notFound();
      emit(req.staff.tenantId, "tables.changed", [req.params.id]);
      return { id: String(row._id), name: row.name, capacity: row.capacity };
    }),
  );
  app.post<IdParams>(
    "/api/manager/tables/:id/token",
    staffRoute([], async (req) => {
      if (!isOid(req.params.id)) throw notFound();
      const token = randomBytes(32).toString("base64url");
      const row = await models.Table.findOneAndUpdate({ _id: req.params.id }, { $set: { token } }, { returnDocument: "after" }).lean();
      if (!row) throw notFound();
      // Whoever holds the old QR loses live updates too.
      await app.io.in(tableRoom(req.staff.tenantId, req.params.id)).disconnectSockets(true);
      emit(req.staff.tenantId, "tables.changed", [req.params.id]);
      return { id: String(row._id), token };
    }),
  );

  app.get("/api/manager/tonight", staffRoute([], async () => tonight(models, app.clock.now())));

  // Photos: the multipart parser lives in its own scope so no other route's body handling changes.
  void app.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 2 } });
    scope.post<IdParams>(
      "/api/manager/items/:id/photo",
      staffRoute([], async (req) => {
        if (!isOid(req.params.id)) throw notFound();
        let data: Buffer;
        try {
          const file = await req.file();
          if (!file) throw new ApiError(400, "validation", "Missing file");
          data = await file.toBuffer();
          if (file.file.truncated) throw new ApiError(400, "validation", "Photo must be at most 2 MB");
        } catch (e) {
          if (e instanceof ApiError) throw e;
          if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(400, "validation", "Photo must be at most 2 MB");
          if (typeof (e as { statusCode?: number }).statusCode === "number") throw new ApiError(400, "validation", "Invalid upload");
          throw e;
        }
        const photo = await setItemPhoto(models, req.params.id, data);
        emit(req.staff.tenantId, "menu.changed", [req.params.id]);
        return { photo };
      }),
    );
  });

  // Public: <img> tags cannot send credentials. Looked up by id across tenants. The id is an ObjectId, which is NOT
  // unguessable (timestamp + counter), so this is only fine because dish photos are public menu content anyway.
  app.get<IdParams>("/api/photos/:id", async (req, reply) => {
    if (!isOid(req.params.id)) throw notFound();
    const p = await unscoped("public photo by id", () => models.Photo.findById(req.params.id));
    if (!p) throw notFound();
    return reply
      .header("Content-Type", p.contentType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      // helmet defaults to same-origin, which would block <img> from the web origin (same-site subdomain).
      .header("Cross-Origin-Resource-Policy", "same-site")
      .send(p.data);
  });
}
