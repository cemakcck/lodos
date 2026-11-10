import type { FastifyRequest } from "fastify";
import { ApiError } from "../errors";

/** Signed cookie holding the demo sandbox id (Task 6 sets it with `reply.setCookie(SANDBOX_COOKIE, id, { signed: true })`). */
export const SANDBOX_COOKIE = "lodos_sb";

/** The tenant of the live restaurant. */
export const MAIN_TENANT = "main";

/**
 * Which tenant's staff may log in on this request. Demo: the visitor's own sandbox, from the signed cookie
 * (401 when absent or tampered with). Live: the `main` tenant.
 */
export function loginTenant(req: FastifyRequest): string {
  if (!req.server.demoMode) return MAIN_TENANT;
  const raw = req.cookies[SANDBOX_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) throw new ApiError(401, "unauthorized", "No demo sandbox");
  return unsigned.value;
}
