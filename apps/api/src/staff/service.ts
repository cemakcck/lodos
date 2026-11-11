import {
  isLoginRole,
  isScheduleRole,
  isStationRole,
  tableRanges,
  type StaffCreateBody,
  type StaffPatchBody,
  type StaffRole,
} from "@lodos/shared";
import type { Types } from "mongoose";
import { hashPin } from "../auth/pin";
import { clearHits } from "../auth/rate-limit";
import type { Models, StaffDoc } from "../db/models";
import { ApiError } from "../errors";
import { isOid, notFound } from "../kds/service";

/** Why the requesting manager can't deactivate a row; null when they can (or the person is already inactive). */
export type WhyNot = "self" | "last_manager" | "station" | "demo_protected" | null;

export type StaffRow = {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  lastSignInAt: string | null;
  tables: { id: string; name: string; roomId: string }[];
  tableRanges: string;
  demoProtected: boolean;
  canDeactivate: boolean;
  whyNot: WhyNot;
};

/** Who is asking, for the per-row `canDeactivate`/`whyNot`. */
export type StaffCtx = { requesterId: string; demoMode: boolean; tenantId: string };

/** What a write changed besides the person, for the route to announce (tables, sessions, socket rooms). */
export type StaffEffects = {
  /** Tables whose section changed (moved to this person or unassigned). */
  changedTableIds: string[];
  /** Names of tables that lost their waiter. */
  unassignedTables: string[];
  /** The person's sessions were deleted: notify and disconnect their sockets. */
  sessionsEnded: boolean;
  /** A change between login roles: move their sockets' role rooms. */
  roleMoved: { from: StaffRole; to: StaffRole } | null;
};

type Lean = Pick<StaffDoc, "_id" | "name" | "role" | "active" | "demoProtected"> & { lastSignInAt?: Date | null };
type TableLean = { _id: Types.ObjectId; name: string; roomId: Types.ObjectId; sectionStaffId?: Types.ObjectId | null };

const noEffects = (): StaffEffects => ({ changedTableIds: [], unassignedTables: [], sessionsEnded: false, roleMoved: null });

/** Names compare trimmed and case-folded the Turkish way ("İpek" = "ipek", "IŞIK" = "ışık"). */
export const foldName = (name: string): string => name.trim().toLocaleLowerCase("tr");

/**
 * Names are unique among active staff (the login picker shows names). The one place this rule lives, so a unique
 * index on a stored folded name can replace it later; until then two simultaneous adds of one name can both pass.
 */
export async function assertNameFree(models: Models, name: string, exceptId?: Types.ObjectId): Promise<void> {
  const want = foldName(name);
  const active = await models.Staff.find({ active: true }, { name: 1 }).lean();
  if (active.some((s) => foldName(s.name) === want && !(exceptId && s._id.equals(exceptId)))) {
    throw new ApiError(409, "name_taken", "Someone active already has that name");
  }
}

const activeManagers = (models: Models): Promise<number> => models.Staff.countDocuments({ role: "manager", active: true });

/** The deactivation rule, shared by the list (per row) and the deactivate route. */
function whyNotOf(s: Lean, ctx: StaffCtx, managers: number): WhyNot {
  if (isStationRole(s.role)) return "station";
  if (!s.active) return null;
  if (ctx.demoMode && s.demoProtected) return "demo_protected";
  if (s.role === "manager" && managers <= 1) return "last_manager";
  if (String(s._id) === ctx.requesterId) return "self";
  return null;
}

function rowOf(s: Lean, tables: TableLean[], ctx: StaffCtx, managers: number): StaffRow {
  const own = isStationRole(s.role) ? [] : tables.filter((t) => t.sectionStaffId?.equals(s._id));
  const whyNot = whyNotOf(s, ctx, managers);
  return {
    id: String(s._id),
    name: s.name,
    role: s.role,
    active: s.active,
    lastSignInAt: s.lastSignInAt ? s.lastSignInAt.toISOString() : null,
    tables: own.map((t) => ({ id: String(t._id), name: t.name, roomId: String(t.roomId) })),
    tableRanges: tableRanges(own.map((t) => t.name)),
    demoProtected: s.demoProtected,
    canDeactivate: s.active && whyNot === null,
    whyNot,
  };
}

const activeTables = (models: Models): Promise<TableLean[]> =>
  models.Table.find({ active: true }, { name: 1, roomId: 1, sectionStaffId: 1 }).lean();

async function rowFor(models: Models, id: Types.ObjectId, ctx: StaffCtx): Promise<StaffRow> {
  const [s, tables, managers] = await Promise.all([models.Staff.findById(id).lean().orFail(), activeTables(models), activeManagers(models)]);
  return rowOf(s, tables, ctx, managers);
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "tr");

/** GET /api/staff: people (active by name, then inactive by name) and the station accounts. */
export async function listStaff(models: Models, ctx: StaffCtx): Promise<{ people: StaffRow[]; stations: StaffRow[] }> {
  const [staff, tables, managers] = await Promise.all([models.Staff.find({}).lean(), activeTables(models), activeManagers(models)]);
  const rows = staff.map((s) => rowOf(s, tables, ctx, managers));
  const people = rows.filter((r) => !isStationRole(r.role));
  return {
    people: [...people.filter((r) => r.active).sort(byName), ...people.filter((r) => !r.active).sort(byName)],
    stations: rows.filter((r) => isStationRole(r.role)).sort(byName),
  };
}

async function findStaff(models: Models, id: string): Promise<StaffDoc> {
  if (!isOid(id)) throw notFound();
  const s = await models.Staff.findById(id);
  if (!s) throw notFound();
  return s;
}

const invalid = (message: string) => new ApiError(400, "validation", message);

/** Schedule-only people have no PIN; waiters and managers must have one. */
function checkPin(role: StaffRole, hasPin: boolean, pinSent: boolean): void {
  if (isScheduleRole(role) && pinSent) throw invalid("Schedule-only staff have no PIN");
  if (isLoginRole(role) && !hasPin && !pinSent) throw new ApiError(400, "pin_required", "Waiters and managers need a PIN");
}

type SectionTable = { _id: Types.ObjectId; name: string; sectionStaffId?: Types.ObjectId | null };

/** Resolves a section's table ids before any write: every id must be an active table of this tenant (else 404). */
async function sectionTables(models: Models, tableIds: string[] | undefined): Promise<SectionTable[] | undefined> {
  if (tableIds === undefined) return undefined;
  const wanted = [...new Set(tableIds)];
  const found = await models.Table.find({ _id: { $in: wanted }, active: true }, { name: 1, sectionStaffId: 1 }).lean();
  if (found.length !== wanted.length) throw notFound();
  return found;
}

/**
 * Makes `tableIds` exactly this person's section: listed tables move to them (from whoever had them), and tables
 * they had that are not listed become unassigned. `found` comes from `sectionTables`.
 */
async function setSection(models: Models, staffId: Types.ObjectId, found: SectionTable[], fx: StaffEffects): Promise<void> {
  const wanted = found.map((t) => t._id);
  const dropped = await models.Table.find({ sectionStaffId: staffId, active: true, _id: { $nin: wanted } }, { name: 1 }).lean();
  const moving = found.filter((t) => !t.sectionStaffId?.equals(staffId));
  if (dropped.length > 0) await models.Table.updateMany({ _id: { $in: dropped.map((t) => t._id) } }, { $set: { sectionStaffId: null } });
  if (moving.length > 0) await models.Table.updateMany({ _id: { $in: moving.map((t) => t._id) } }, { $set: { sectionStaffId: staffId } });
  fx.changedTableIds.push(...[...dropped, ...moving].map((t) => String(t._id)));
  fx.unassignedTables.push(...dropped.map((t) => t.name));
}

/** Unassigns every table of the person and ends their sessions (deactivation, or a move to a schedule-only role). */
async function cutOff(models: Models, staffId: Types.ObjectId, fx: StaffEffects): Promise<void> {
  const tables = await models.Table.find({ sectionStaffId: staffId }, { name: 1, active: 1 }).lean();
  if (tables.length > 0) await models.Table.updateMany({ sectionStaffId: staffId }, { $set: { sectionStaffId: null } });
  await models.Session.deleteMany({ staffId });
  fx.changedTableIds.push(...tables.map((t) => String(t._id)));
  fx.unassignedTables.push(...tables.filter((t) => t.active).map((t) => t.name));
  fx.sessionsEnded = true;
}

/** POST /api/staff. Stations are fixed (the body schema refuses their roles). */
export async function createStaff(models: Models, body: StaffCreateBody, ctx: StaffCtx): Promise<{ row: StaffRow; fx: StaffEffects }> {
  checkPin(body.role, false, body.pin !== undefined);
  if (isScheduleRole(body.role) && body.tableIds?.length) throw invalid("Only waiters and managers have tables");
  await assertNameFree(models, body.name);
  const section = await sectionTables(models, body.tableIds);
  const fx = noEffects();
  const s = await models.Staff.create({
    name: body.name,
    role: body.role,
    ...(body.pin !== undefined ? { pinHash: await hashPin(body.pin) } : {}),
  });
  if (section?.length) await setSection(models, s._id, section, fx);
  return { row: await rowFor(models, s._id, ctx), fx };
}

/** PATCH /api/staff/:id. A station takes nothing here (only a PIN reset). */
export async function updateStaff(
  models: Models,
  id: string,
  body: StaffPatchBody,
  ctx: StaffCtx,
): Promise<{ row: StaffRow; fx: StaffEffects }> {
  const s = await findStaff(models, id);
  if (isStationRole(s.role)) throw new ApiError(409, "station", "Station accounts only take a PIN reset");
  const from = s.role;
  const to = body.role ?? from;
  if (to !== from) {
    if (ctx.demoMode && s.demoProtected) throw new ApiError(409, "demo_protected", "The demo's own accounts keep their role");
    if (from === "manager" && s.active && (await activeManagers(models)) <= 1) {
      throw new ApiError(409, "last_manager", "There must always be an active manager");
    }
    if (String(s._id) === ctx.requesterId) throw new ApiError(409, "self", "You can't change your own role");
  }
  checkPin(to, Boolean(s.pinHash) && isLoginRole(from), body.pin !== undefined);
  if (isScheduleRole(to) && body.tableIds?.length) throw invalid("Only waiters and managers have tables");
  if (body.name !== undefined && s.active && foldName(body.name) !== foldName(s.name)) await assertNameFree(models, body.name, s._id);
  const section = await sectionTables(models, body.tableIds);

  const fx = noEffects();
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name;
  if (to !== from) set.role = to;
  if (body.pin !== undefined) set.pinHash = await hashPin(body.pin);
  await models.Staff.updateOne({ _id: s._id }, { $set: set, ...(isScheduleRole(to) ? { $unset: { pinHash: 1 } } : {}) });

  if (isScheduleRole(to) && isLoginRole(from)) await cutOff(models, s._id, fx);
  else if (section && !isScheduleRole(to)) await setSection(models, s._id, section, fx);
  if (to !== from && isLoginRole(from) && isLoginRole(to)) fx.roleMoved = { from, to };
  return { row: await rowFor(models, s._id, ctx), fx };
}

/** POST /api/staff/:id/pin: anyone with a sign-in role, stations included. Also lifts a wrong-PIN lock. */
export async function resetPin(models: Models, id: string, pin: string, ctx: StaffCtx): Promise<void> {
  const s = await findStaff(models, id);
  if (!isLoginRole(s.role)) throw invalid("Schedule-only staff have no PIN");
  await models.Staff.updateOne({ _id: s._id }, { $set: { pinHash: await hashPin(pin) } });
  await clearHits(models, `pin:${ctx.tenantId}:${String(s._id)}`);
}

/** POST /api/staff/:id/deactivate. History (checks, approvals, shifts) stays; sessions and tables go. */
export async function deactivateStaff(models: Models, id: string, ctx: StaffCtx): Promise<{ row: StaffRow; fx: StaffEffects }> {
  const s = await findStaff(models, id);
  const fx = noEffects();
  const why = whyNotOf(s, ctx, await activeManagers(models));
  if (why) throw new ApiError(409, why, deactivateMessage[why]);
  if (s.active) {
    const res = await models.Staff.updateOne({ _id: s._id, active: true }, { $set: { active: false } });
    if (res.modifiedCount === 1) await cutOff(models, s._id, fx);
  }
  return { row: await rowFor(models, s._id, ctx), fx };
}

const deactivateMessage: Record<Exclude<WhyNot, null>, string> = {
  self: "You can't deactivate yourself",
  last_manager: "There must always be an active manager",
  station: "Station accounts can't be deactivated",
  demo_protected: "The demo's own accounts can't be deactivated",
};

/** POST /api/staff/:id/reactivate. The name must still be free among active staff. */
export async function reactivateStaff(models: Models, id: string, ctx: StaffCtx): Promise<StaffRow> {
  const s = await findStaff(models, id);
  if (!s.active) {
    await assertNameFree(models, s.name, s._id);
    await models.Staff.updateOne({ _id: s._id }, { $set: { active: true } });
  }
  return rowFor(models, s._id, ctx);
}
