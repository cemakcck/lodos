import { randomBytes } from "node:crypto";
import {
  TABLE_CAPACITY_MAX,
  TABLE_CAPACITY_MIN,
  TABLE_NAME_RE,
  type LayoutBody,
  type LayoutProblem,
  type LayoutProblemCode,
  type LayoutTableInput,
} from "@lodos/shared";
import { Types, type ClientSession } from "mongoose";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { inCheckTransaction } from "../floor/service";
import { isOid, notFound } from "../kds/service";

export type RoomView = { id: string; name: string; width: number; height: number; version: number };
export type LayoutTableView = {
  id: string;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  sectionStaffId: string | null;
  openCheck: boolean;
};
export type LayoutView = { room: RoomView; tables: LayoutTableView[]; nextNames: { T: string; B: string } };

type RoomLean = { _id: Types.ObjectId; name: string; width: number; height: number; version: number };
type TableLean = {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  name: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  sectionStaffId?: Types.ObjectId | null;
  active: boolean;
};

const roomView = (r: RoomLean): RoomView => ({ id: String(r._id), name: r.name, width: r.width, height: r.height, version: r.version });

/**
 * The next free number per prefix, counting every table of the tenant, inactive ones included, so a deleted T17
 * is never handed out again (plan ruling "Name sequences count inactive tables").
 */
export function nextNames(names: readonly string[]): { T: string; B: string } {
  const max = { T: 0, B: 0 };
  for (const n of names) {
    const m = TABLE_NAME_RE.exec(n);
    if (!m) continue;
    const prefix = m[1] as "T" | "B";
    max[prefix] = Math.max(max[prefix], Number(n.slice(1)));
  }
  return { T: `T${max.T + 1}`, B: `B${max.B + 1}` };
}

async function findRoom(models: Models, id: string, session?: ClientSession): Promise<RoomLean> {
  if (!isOid(id)) throw notFound();
  const room = await models.Room.findOne({ _id: id }).session(session ?? null).lean<RoomLean>();
  if (!room) throw notFound();
  return room;
}

/** GET /api/rooms/:id/layout: the room, its active tables (with whether each has an open check) and the next names. */
export async function roomLayout(models: Models, roomId: string): Promise<LayoutView> {
  const room = await findRoom(models, roomId);
  const [tables, allNames, open] = await Promise.all([
    models.Table.find({ roomId: room._id, active: true }).sort({ _id: 1 }).lean<TableLean[]>(),
    models.Table.find({}, { name: 1 }).lean<{ name: string }[]>(),
    models.Check.find({ status: "open" }, { tableId: 1 }).lean<{ tableId: Types.ObjectId }[]>(),
  ]);
  const openIds = new Set(open.map((c) => String(c.tableId)));
  return {
    room: roomView(room),
    tables: tables.map((t) => ({
      id: String(t._id),
      name: t.name,
      shape: t.shape,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      capacity: t.capacity,
      sectionStaffId: t.sectionStaffId ? String(t.sectionStaffId) : null,
      openCheck: openIds.has(String(t._id)),
    })),
    nextNames: nextNames(allNames.map((t) => t.name)),
  };
}

type Rect = { x: number; y: number; w: number; h: number };
/** Axis-aligned; touching edges do not overlap. A round table is its bounding box. */
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Every problem of a layout save at once (spec §7). `tables` is every table of the tenant, inactive ones included;
 * `openTableIds` the tables with an open check; `waiterIds` the tenant's active waiters.
 */
export function layoutProblems(input: {
  room: { _id: Types.ObjectId; width: number; height: number };
  body: readonly LayoutTableInput[];
  tables: readonly TableLean[];
  openTableIds: ReadonlySet<string>;
  waiterIds: ReadonlySet<string>;
}): LayoutProblem[] {
  const { room, body, tables, openTableIds, waiterIds } = input;
  const problems: LayoutProblem[] = [];
  const add = (key: string, code: LayoutProblemCode) => {
    if (!problems.some((p) => p.key === key && p.code === code)) problems.push({ key, code });
  };
  const current = new Map(tables.filter((t) => t.active && t.roomId.equals(room._id)).map((t) => [String(t._id), t]));
  const known: LayoutTableInput[] = [];
  for (const x of body) {
    if (x.id !== undefined && !current.has(x.id)) add(x.key, "unknown");
    else known.push(x);
  }
  const kept = new Set(known.flatMap((x) => (x.id === undefined ? [] : [x.id])));
  // Names held outside this save: other rooms, inactive tables, and this room's tables being deleted.
  const heldElsewhere = new Set(tables.filter((t) => !kept.has(String(t._id))).map((t) => t.name));

  for (const x of known) {
    if (!TABLE_NAME_RE.test(x.name)) add(x.key, "name_invalid");
    else if (heldElsewhere.has(x.name) || known.some((o) => o !== x && o.name === x.name)) add(x.key, "name_taken");
    if (x.x < 0 || x.y < 0 || x.x + x.w > room.width || x.y + x.h > room.height) add(x.key, "out_of_bounds");
    if (x.capacity < TABLE_CAPACITY_MIN || x.capacity > TABLE_CAPACITY_MAX) add(x.key, "capacity");
    if (x.sectionStaffId !== null && !waiterIds.has(x.sectionStaffId)) add(x.key, "waiter");
    if (x.id !== undefined && openTableIds.has(x.id) && current.get(x.id)!.name !== x.name) add(x.key, "open_check_rename");
  }
  for (let i = 0; i < known.length; i++) {
    for (let j = i + 1; j < known.length; j++) {
      if (overlaps(known[i]!, known[j]!)) {
        add(known[i]!.key, "overlap");
        add(known[j]!.key, "overlap");
      }
    }
  }
  for (const id of current.keys()) if (!kept.has(id) && openTableIds.has(id)) add(id, "open_check_delete");
  return problems;
}

const FIELDS = ["shape", "x", "y", "w", "h", "capacity"] as const;
const sameId = (a: Types.ObjectId | null | undefined, b: string | null) => (a ? String(a) : null) === b;

/**
 * PUT /api/rooms/:id/layout. One transaction: the conditional version bump (zero matched → `409 version_conflict`;
 * a concurrent save write-conflicts on the room and is re-run, then misses the version), the checks against that
 * snapshot, then renames, updates, inserts and soft deletes. Returns the ids of the tables that changed.
 */
export async function saveLayout(models: Models, roomId: string, body: LayoutBody): Promise<{ changedIds: string[] }> {
  await findRoom(models, roomId);
  return inCheckTransaction(models, async (session) => {
    const bumped = await models.Room.updateOne({ _id: roomId, version: body.version }, { $inc: { version: 1 } }, { session });
    if (bumped.matchedCount === 0) throw new ApiError(409, "version_conflict", "Someone else saved this room; reload it");
    const room = await findRoom(models, roomId, session);
    const [tables, open, waiters] = await Promise.all([
      models.Table.find({}).session(session).lean<TableLean[]>(),
      models.Check.find({ status: "open" }, { tableId: 1 }).session(session).lean<{ tableId: Types.ObjectId }[]>(),
      models.Staff.find({ role: "waiter", active: true }, { _id: 1 }).session(session).lean<{ _id: Types.ObjectId }[]>(),
    ]);
    const problems = layoutProblems({
      room,
      body: body.tables,
      tables,
      openTableIds: new Set(open.map((c) => String(c.tableId))),
      waiterIds: new Set(waiters.map((w) => String(w._id))),
    });
    if (problems.length > 0) throw new ApiError(400, "layout_invalid", "The layout has problems", { problems });

    const byId = new Map(tables.map((t) => [String(t._id), t]));
    const kept = new Set(body.tables.flatMap((x) => (x.id === undefined ? [] : [x.id])));
    const changed: string[] = [];
    const renames: { id: string; name: string }[] = [];
    const updates: { id: string; set: Record<string, unknown> }[] = [];
    for (const x of body.tables) {
      if (x.id === undefined) continue;
      const cur = byId.get(x.id)!;
      const set: Record<string, unknown> = {};
      for (const f of FIELDS) if (cur[f] !== x[f]) set[f] = x[f];
      if (!sameId(cur.sectionStaffId, x.sectionStaffId)) set.sectionStaffId = x.sectionStaffId === null ? null : new Types.ObjectId(x.sectionStaffId);
      if (cur.name !== x.name) renames.push({ id: x.id, name: x.name });
      if (Object.keys(set).length > 0) updates.push({ id: x.id, set });
      if (Object.keys(set).length > 0 || cur.name !== x.name) changed.push(x.id);
    }
    // Renames go through a placeholder first, so names can move between tables of the save under the unique index.
    if (renames.length > 0) {
      const step = (name: (r: (typeof renames)[number]) => string) =>
        models.Table.bulkWrite(
          renames.map((r) => ({ updateOne: { filter: { _id: new Types.ObjectId(r.id) }, update: { $set: { name: name(r) } } } })),
          { session, ordered: true },
        );
      await step((r) => `~${r.id}`);
      await step((r) => r.name);
    }
    if (updates.length > 0) {
      await models.Table.bulkWrite(
        updates.map((u) => ({ updateOne: { filter: { _id: new Types.ObjectId(u.id) }, update: { $set: u.set } } })),
        { session, ordered: true },
      );
    }
    const fresh = body.tables.filter((x) => x.id === undefined);
    if (fresh.length > 0) {
      const docs = fresh.map((x) => ({
        _id: new Types.ObjectId(),
        roomId: room._id,
        name: x.name,
        shape: x.shape,
        x: x.x,
        y: x.y,
        w: x.w,
        h: x.h,
        capacity: x.capacity,
        sectionStaffId: x.sectionStaffId === null ? null : new Types.ObjectId(x.sectionStaffId),
        token: randomBytes(32).toString("base64url"),
        active: true,
      }));
      await models.Table.insertMany(docs, { session });
      changed.push(...docs.map((d) => String(d._id)));
    }
    const removed = tables.filter((t) => t.active && t.roomId.equals(room._id) && !kept.has(String(t._id))).map((t) => t._id);
    if (removed.length > 0) {
      await models.Table.updateMany({ _id: { $in: removed } }, { $set: { active: false } }, { session });
      changed.push(...removed.map(String));
    }
    return { changedIds: changed };
  });
}

export async function createRoom(models: Models, name: string): Promise<RoomView> {
  const last = await models.Room.findOne({}, { sort: 1 }).sort({ sort: -1 }).lean<{ sort: number }>();
  const room = await models.Room.create({ name, sort: (last?.sort ?? -1) + 1 });
  return roomView(room.toObject() as RoomLean);
}

export async function renameRoom(models: Models, id: string, name: string): Promise<RoomView> {
  if (!isOid(id)) throw notFound();
  const room = await models.Room.findOneAndUpdate({ _id: id }, { $set: { name } }, { returnDocument: "after" }).lean<RoomLean>();
  if (!room) throw notFound();
  return roomView(room);
}

/**
 * Deletes a room with no active tables (else `409 room_not_empty`). Rooms keep no history; its inactive tables keep
 * pointing at the removed id, which only past checks' table names still use. In a transaction, so a layout save
 * adding a table here at the same moment write-conflicts on the room.
 */
export async function deleteRoom(models: Models, id: string): Promise<void> {
  await findRoom(models, id);
  await inCheckTransaction(models, async (session) => {
    const active = await models.Table.countDocuments({ roomId: id, active: true }).session(session);
    if (active > 0) throw new ApiError(409, "room_not_empty", "Move or delete this room's tables first");
    const gone = await models.Room.deleteOne({ _id: id }, { session });
    if (gone.deletedCount === 0) throw notFound();
  });
}
