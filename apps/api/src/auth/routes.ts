import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { z } from "zod";
import { runWithTenant } from "../db/tenancy";
import { ALL_ROLES, sessionCookieOptions, staffRoute } from "./guard";
import { loginTenant } from "./login-tenant";
import { verifyStaffPin } from "./approval";
import { PinSchema } from "./pin";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, deleteSession, sessionKindFor } from "./sessions";

const LoginBody = z.object({
  staffId: z.string().refine((s) => Types.ObjectId.isValid(s) && s.length === 24, "Invalid staff id"),
  pin: PinSchema,
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/auth/staff", async (req) => {
    const tenantId = loginTenant(req);
    // The picker shows who can sign in: people with a PIN role and the stations, never schedule-only staff.
    const staff = await runWithTenant(tenantId, () =>
      app.models.Staff.find({ active: true, role: { $in: ALL_ROLES } }).sort({ name: 1 }),
    );
    return staff.map((s) => ({ id: s.id as string, name: s.name, role: s.role }));
  });

  app.post("/api/auth/pin", async (req, reply) => {
    const tenantId = loginTenant(req);
    const { staffId, pin } = LoginBody.parse(req.body);
    const now = app.clock.now();
    const { models } = app;
    const staff = await verifyStaffPin(models, { tenantId, ip: req.ip, staffId, pin, now });
    await runWithTenant(tenantId, () => models.Staff.updateOne({ _id: staff._id }, { $set: { lastSignInAt: now } }));

    const token = await createSession(models, staff._id, tenantId, sessionKindFor(staff.role), now);
    void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_MS, app.cookieSecure));
    return { staff: { id: staff.id as string, name: staff.name, role: staff.role } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await deleteSession(app.models, raw);
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get(
    "/api/auth/me",
    staffRoute(ALL_ROLES, async (req) => ({ staff: { id: req.staff.id, name: req.staff.name, role: req.staff.role } })),
  );
}
