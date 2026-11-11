import { createHash, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { isLoginRole, type StaffRole } from "@lodos/shared";
import type { Models } from "../db/models";
import { runWithTenant, unscoped } from "../db/tenancy";

export const SESSION_COOKIE = "lodos_sid";
export const SESSION_TTL_MS = 12 * 3_600_000;

export type SessionKind = "person" | "station";
export type AuthStaff = { id: string; name: string; role: StaffRole; tenantId: string };

export const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** Kitchen and bar accounts are shared wall-screen logins; everyone else is a person. */
export const sessionKindFor = (role: StaffRole): SessionKind => (role === "kitchen" || role === "bar" ? "station" : "person");

/** Creates a session and returns the raw token (the cookie value). Only its sha256 is stored. */
export async function createSession(
  models: Models,
  staffId: string | Types.ObjectId,
  tenantId: string,
  kind: SessionKind,
  now: Date,
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await runWithTenant(tenantId, () =>
    models.Session.create({
      tokenHash: hashToken(raw),
      staffId,
      kind,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    }),
  );
  return raw;
}

export type ResolvedSession = { staff: AuthStaff; kind: SessionKind };

/**
 * Resolves a raw token to its staff member, or null when unknown, expired (checked against `now`, not the TTL
 * index), or the staff member is gone, deactivated or schedule-only. Station sessions slide: every use extends them to now + 12 h.
 */
export async function resolveSession(models: Models, raw: string, now: Date): Promise<ResolvedSession | null> {
  const session = await unscoped("session lookup by token hash: the tenant is not known yet", () =>
    models.Session.findOne({ tokenHash: hashToken(raw) }),
  );
  if (!session || session.expiresAt.getTime() < now.getTime()) return null;

  return runWithTenant(session.tenantId, async () => {
    const staff = await models.Staff.findOne({ _id: session.staffId, active: true });
    if (!staff || !isLoginRole(staff.role)) return null;
    const update: Record<string, Date> = { lastUsedAt: now };
    if (session.kind === "station") update.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await models.Session.updateOne({ _id: session._id }, { $set: update });
    return {
      kind: session.kind,
      staff: { id: staff.id as string, name: staff.name, role: staff.role, tenantId: session.tenantId },
    };
  });
}

export function deleteSession(models: Models, raw: string): Promise<unknown> {
  return unscoped("session deletion by token hash", () => models.Session.deleteOne({ tokenHash: hashToken(raw) }));
}
