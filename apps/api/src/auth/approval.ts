import { canSignIn, scheduleGroupOf } from "@lodos/shared";
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
 * `clock` checks the time-clock PIN instead of the login PIN: anyone on the schedule (not stations), using `pinHash`
 * for login roles and `clockPinHash` for schedule-only roles. The lock key and limits are the same.
 */
export async function verifyStaffPin(
  models: Models,
  a: { tenantId: string; ip: string; staffId: string; pin: string; now: Date; clock?: boolean },
): Promise<StaffDoc> {
  // The time clock has its own per-IP bucket (a shared tablet punching at shift change must not lock staff login),
  // and a correct punch clears it; wrong PINs still count toward it and toward the shared per-staff lock below.
  const ipKey = a.clock ? `clockip:${a.ip}` : `ip:${a.ip}`;
  if (!(await hit(models, ipKey, IP_ATTEMPTS.limit, IP_ATTEMPTS.windowMs, a.now))) {
    throw new ApiError(429, "rate_limited", "Too many attempts, try again later");
  }
  const failKey = `pin:${a.tenantId}:${a.staffId}`;
  // Every attempt is recorded before the (slow) verify, so parallel guesses count against the lock; success clears them.
  if (!(await hit(models, failKey, PIN_FAILURES.limit, PIN_FAILURES.windowMs, a.now))) {
    throw new ApiError(429, "rate_limited", "Too many wrong PINs, try again in a few minutes");
  }
  const staff = await runWithTenant(a.tenantId, () => models.Staff.findOne({ _id: a.staffId, active: true }));
  // Schedule-only staff have no PIN: they fail like a wrong PIN (the attempt above already counts toward the lock).
  const eligible = a.clock ? staff !== null && scheduleGroupOf(staff.role) !== null : staff !== null && canSignIn(staff.role);
  const hash = staff && a.clock && !canSignIn(staff.role) ? staff.clockPinHash : staff?.pinHash;
  if (!staff || !eligible || !(await verifyPin(hash, a.pin))) throw new ApiError(401, "unauthorized", "Wrong PIN");
  await clearHits(models, failKey);
  if (a.clock) await clearHits(models, ipKey);
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
