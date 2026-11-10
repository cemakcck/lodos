import type { StaffRole } from "@lodos/shared";
import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";
import { runWithTenant } from "../db/tenancy";
import { ApiError } from "../errors";
import { SESSION_COOKIE, SESSION_TTL_MS, resolveSession, type AuthStaff } from "./sessions";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `staffRoute` before the handler runs. */
    staff?: AuthStaff;
  }
}

export const ALL_ROLES: readonly StaffRole[] = ["waiter", "kitchen", "bar", "manager"];

/** `secure` comes from config (COOKIE_SECURE, via `app.cookieSecure`). */
export const sessionCookieOptions = (maxAgeMs: number, secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: Math.floor(maxAgeMs / 1000),
  }) as const;

export type StaffRequest<R extends RouteGenericInterface = RouteGenericInterface> = FastifyRequest<R> & { staff: AuthStaff };
type Roles = readonly StaffRole[] | ((req: FastifyRequest) => readonly StaffRole[]);

/**
 * The only way to register a staff-only route. It authenticates the session cookie (401), checks the role
 * (403; `manager` passes every guard), then runs `handler` inside `runWithTenant(staff.tenantId)`, so a route
 * built with it cannot touch another tenant's data and cannot forget to enter the tenant.
 *
 *   app.get("/api/floor", staffRoute(["waiter"], async (req) => { ...req.staff, req.server.models... }));
 */
export function staffRoute<R extends RouteGenericInterface = RouteGenericInterface, T = unknown>(
  roles: Roles,
  handler: (req: StaffRequest<R>, reply: FastifyReply) => Promise<T>,
) {
  return async (req: FastifyRequest<R>, reply: FastifyReply): Promise<T> => {
    const raw = req.cookies[SESSION_COOKIE];
    const session = raw ? await resolveSession(req.server.models, raw, req.server.clock.now()) : null;
    if (!session) throw new ApiError(401, "unauthorized");
    const allowed = typeof roles === "function" ? roles(req) : roles;
    if (session.staff.role !== "manager" && !allowed.includes(session.staff.role)) throw new ApiError(403, "forbidden");

    req.staff = session.staff;
    // Station sessions slid forward in the database; keep the browser cookie in step.
    if (session.kind === "station") void reply.setCookie(SESSION_COOKIE, raw!, sessionCookieOptions(SESSION_TTL_MS, req.server.cookieSecure));
    return runWithTenant(session.staff.tenantId, () => handler(req as StaffRequest<R>, reply));
  };
}
