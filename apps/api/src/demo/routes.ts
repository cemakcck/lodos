import { DemoRole } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionCookieOptions } from "../auth/guard";
import { loginTenant } from "../auth/login-tenant";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, deleteSession, sessionKindFor } from "../auth/sessions";
import { runWithTenant, unscoped } from "../db/tenancy";
import { ApiError } from "../errors";
import { ensureSandbox, type SandboxOpts } from "./sandboxes";

export type DemoRouteOptions = Pick<SandboxOpts, "maxSandboxes" | "perIpHour">;

const REDIRECT = {
  waiter: "/staff/floor",
  kitchen: "/staff/kitchen",
  bar: "/staff/bar",
  manager: "/staff/overview",
} as const;

/** Registers /api/demo/*. Call only in demo mode. */
export function registerDemoRoutes(app: FastifyInstance, routeOpts: DemoRouteOptions): void {
  const { models } = app;
  const opts = (): SandboxOpts => ({
    ...routeOpts,
    isConnected: (id) => app.presence.isConnected(id),
  });

  const guestToken = async (tenantId: string): Promise<string> => {
    const t7 = await runWithTenant(tenantId, () => models.Table.findOne({ name: "T7" }).lean());
    if (!t7) throw new ApiError(404, "not_found");
    return t7.token;
  };

  app.post("/api/demo/session", async (req, reply) => {
    const { role } = z.object({ role: DemoRole }).parse(req.body);
    const now = app.clock.now();
    const { tenantId } = await ensureSandbox(models, req, reply, now, opts());

    const old = req.cookies[SESSION_COOKIE];
    if (old) await deleteSession(models, old);

    if (role === "guest") {
      void reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { redirect: `/t/${await guestToken(tenantId)}` };
    }
    // The seeded, demo-protected account of that role (Deniz for waiter): it can't be deactivated in demo mode,
    // and is found even if the visitor renamed it or added another person with the same role. Sandboxes seeded
    // before the flag existed fall back to the old lookup.
    const staff = await runWithTenant(
      tenantId,
      async () =>
        (await models.Staff.findOne({ role, active: true, demoProtected: true })) ??
        models.Staff.findOne(role === "waiter" ? { role, name: "Deniz", active: true } : { role, active: true }),
    );
    if (!staff) throw new ApiError(404, "not_found");
    const token = await createSession(models, staff._id, tenantId, sessionKindFor(staff.role), now);
    void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_MS, app.cookieSecure));
    return { redirect: REDIRECT[role] };
  });

  app.get("/api/demo/info", async (req) => {
    const tenantId = loginTenant(req);
    const sandbox = await unscoped("sandbox registry is not tenant-scoped", () =>
      models.Sandbox.findById(tenantId).lean(),
    );
    if (!sandbox) throw new ApiError(401, "unauthorized", "No demo sandbox");
    return {
      guestUrl: `/t/${await guestToken(tenantId)}`,
      simulatorOn: sandbox.simulatorOn,
    };
  });

  app.post("/api/demo/simulator", async (req) => {
    const tenantId = loginTenant(req);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    const res = await unscoped("sandbox registry is not tenant-scoped", () =>
      models.Sandbox.updateOne({ _id: tenantId }, { $set: { simulatorOn: on } }),
    );
    if (res.matchedCount === 0) throw new ApiError(401, "unauthorized", "No demo sandbox");
    return { simulatorOn: on };
  });
}
