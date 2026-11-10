import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { z } from "zod";
import { runWithTenant } from "../db/tenancy";
import { ApiError } from "../errors";
import { ALL_ROLES, sessionCookieOptions, staffRoute } from "./guard";
import { loginTenant } from "./login-tenant";
import { PinSchema, verifyPin } from "./pin";
import { clearHits, hit } from "./rate-limit";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, deleteSession, sessionKindFor } from "./sessions";

const MIN = 60_000;
const PIN_FAILURES = { limit: 5, windowMs: 5 * MIN };
const IP_ATTEMPTS = { limit: 30, windowMs: 10 * MIN };

const LoginBody = z.object({
  staffId: z.string().refine((s) => Types.ObjectId.isValid(s) && s.length === 24, "Invalid staff id"),
  pin: PinSchema,
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/auth/staff", async (req) => {
    const tenantId = loginTenant(req);
    const staff = await runWithTenant(tenantId, () => app.models.Staff.find({ active: true }).sort({ name: 1 }));
    return staff.map((s) => ({ id: s.id as string, name: s.name, role: s.role }));
  });

  app.post("/api/auth/pin", async (req, reply) => {
    const tenantId = loginTenant(req);
    const { staffId, pin } = LoginBody.parse(req.body);
    const now = app.clock.now();
    const { models } = app;

    if (!(await hit(models, `ip:${req.ip}`, IP_ATTEMPTS.limit, IP_ATTEMPTS.windowMs, now))) {
      throw new ApiError(429, "rate_limited", "Too many attempts, try again later");
    }
    const failKey = `pin:${tenantId}:${staffId}`;
    // Every attempt is recorded before the (slow) verify, so parallel guesses count against the lock; success clears them.
    if (!(await hit(models, failKey, PIN_FAILURES.limit, PIN_FAILURES.windowMs, now))) {
      throw new ApiError(429, "rate_limited", "Too many wrong PINs, try again in a few minutes");
    }

    const staff = await runWithTenant(tenantId, () => models.Staff.findOne({ _id: staffId, active: true }));
    if (!staff || !(await verifyPin(staff.pinHash, pin))) {
      throw new ApiError(401, "unauthorized", "Wrong PIN");
    }

    await clearHits(models, failKey);
    const token = await createSession(models, staff._id, tenantId, sessionKindFor(staff.role), now);
    void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_MS));
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
