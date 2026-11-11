import type { Models, StaffDoc } from "../db/models";
import { runWithTenant } from "../db/tenancy";
import { ApiError } from "../errors";
import { verifyPin } from "./pin";
import { clearHits, hit } from "./rate-limit";
import type { AuthStaff } from "./sessions";

const MIN = 60_000;
const PIN_FAILURES = { limit: 5, windowMs: 5 * MIN };
const IP_ATTEMPTS = { limit: 30, windowMs: 10 * MIN };

/**
 * The PIN check shared by login and manager approval: per-IP limit, then the per-staff lock, then an active staff
 * member with a matching PIN; success clears the lock. Run inside the tenant (callers pass `tenantId` for the key).
 */
export async function verifyStaffPin(
  models: Models,
  a: { tenantId: string; ip: string; staffId: string; pin: string; now: Date },
): Promise<StaffDoc> {
  if (!(await hit(models, `ip:${a.ip}`, IP_ATTEMPTS.limit, IP_ATTEMPTS.windowMs, a.now))) {
    throw new ApiError(429, "rate_limited", "Too many attempts, try again later");
  }
  const failKey = `pin:${a.tenantId}:${a.staffId}`;
  // Every attempt is recorded before the (slow) verify, so parallel guesses count against the lock; success clears them.
  if (!(await hit(models, failKey, PIN_FAILURES.limit, PIN_FAILURES.windowMs, a.now))) {
    throw new ApiError(429, "rate_limited", "Too many wrong PINs, try again in a few minutes");
  }
  const staff = await runWithTenant(a.tenantId, () => models.Staff.findOne({ _id: a.staffId, active: true }));
  if (!staff || !(await verifyPin(staff.pinHash, a.pin))) throw new ApiError(401, "unauthorized", "Wrong PIN");
  await clearHits(models, failKey);
  return staff;
}

/** Who may authorize a comp or void: a manager requester needs nothing; anyone else needs a manager's PIN. */
export async function approve(
  models: Models,
  a: { tenantId: string; ip: string; approval: { managerId: string; pin: string } | undefined; requester: AuthStaff; now: Date },
): Promise<{ id: string; name: string }> {
  if (a.requester.role === "manager") return { id: a.requester.id, name: a.requester.name };
  if (!a.approval) throw new ApiError(403, "approval_required", "A manager's approval is required");
  const staff = await verifyStaffPin(models, { tenantId: a.tenantId, ip: a.ip, staffId: a.approval.managerId, pin: a.approval.pin, now: a.now });
  if (staff.role !== "manager" || String(staff._id) === a.requester.id) throw new ApiError(403, "not_a_manager", "That PIN is not a manager's");
  return { id: String(staff._id), name: staff.name };
}

export async function listApprovers(models: Models): Promise<{ id: string; name: string }[]> {
  const managers = await models.Staff.find({ active: true, role: "manager" }).sort({ name: 1 });
  return managers.map((m) => ({ id: String(m._id), name: m.name }));
}
