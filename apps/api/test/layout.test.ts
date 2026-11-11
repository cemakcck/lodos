import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant, type TestApp } from "./helpers";
import { closeSockets, connect, listen } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
let url: string;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  url = await listen(t);
});
afterEach(() => closeSockets());
afterAll(() => t.close());

type LayoutTable = { id: string; name: string; shape: "round" | "rect"; x: number; y: number; w: number; h: number; capacity: number; sectionStaffId: string | null; openCheck: boolean };
type Layout = { room: { id: string; name: string; width: number; height: number; version: number }; tables: LayoutTable[]; nextNames: { T: string; B: string } };
type BodyTable = { id?: string; key: string; name: string; shape: "round" | "rect"; x: number; y: number; w: number; h: number; capacity: number; sectionStaffId: string | null };
type Problem = { key: string; code: string };

/** A fresh tenant (no live service) with a manager session and the salon's id. */
async function fresh() {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false, scheduleTeam: false });
  const sid = (who: keyof typeof seed.staff) =>
    createSession(t.models, seed.staff[who], tenantId, who === "kitchen" || who === "bar" ? "station" : "person", NOW);
  const manager = await sid("manager");
  const as = (cookie: string) => (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", u: string, payload?: object) =>
    t.inject({ method, url: u, cookies: { lodos_sid: cookie }, ...(payload ? { payload } : {}) });
  const call = as(manager);
  const inT = <R>(fn: () => PromiseLike<R>) => runWithTenant(tenantId, fn);
  const roomOf = async (table: string) => String((await inT(() => t.models.Table.findOne({ name: table }).lean().orFail())).roomId);
  const salon = await roomOf("T7");
  const bar = await roomOf("T9");
  const layout = async (room = salon) => {
    const res = await call("GET", `/api/rooms/${room}/layout`);
    expect(res.statusCode).toBe(200);
    return res.json() as Layout;
  };
  /** The room's tables as a PUT body (key = id), with `edit` applied. */
  const bodyOf = (l: Layout, edit: (rows: BodyTable[]) => BodyTable[] = (r) => r) => ({
    version: l.room.version,
    tables: edit(l.tables.map((r) => ({ id: r.id, key: r.id, name: r.name, shape: r.shape, x: r.x, y: r.y, w: r.w, h: r.h, capacity: r.capacity, sectionStaffId: r.sectionStaffId }))),
  });
  const save = (body: object, room = salon) => call("PUT", `/api/rooms/${room}/layout`, body);
  const openCheck = (table: string) =>
    inT(() => t.models.Check.create({ tableId: seed.tables[table]!.id, openedAt: NOW, status: "open" }));
  const problems = (res: { json(): unknown }) => (res.json() as { error: { code: string; details: { problems: Problem[] } } }).error;
  return { tenantId, seed, sid, as, call, inT, salon, bar, layout, bodyOf, save, openCheck, problems };
}

const move = (name: string, to: Partial<BodyTable>) => (rows: BodyTable[]) => rows.map((r) => (r.name === name ? { ...r, ...to } : r));

describe("GET /api/rooms/:id/layout", () => {
  it("returns the room with its default size and version, its active tables and the next names", async () => {
    const f = await fresh();
    const l = await f.layout();
    expect(l.room).toEqual({ id: f.salon, name: "Salon", width: 800, height: 480, version: 0 });
    expect(l.tables.map((x) => x.name).sort()).toEqual(["B1", "B2", "B3", "B4", "B5", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);
    const t7 = l.tables.find((x) => x.name === "T7")!;
    expect(t7).toEqual({ id: f.seed.tables.T7!.id, name: "T7", shape: "round", x: 200, y: 298, w: 76, h: 76, capacity: 2, sectionStaffId: f.seed.staff.waiter, openCheck: false });
    expect(l.nextNames).toEqual({ T: "T17", B: "B6" });
  });

  it("every seeded table fits inside its room", async () => {
    const f = await fresh();
    for (const room of [f.salon, f.bar, await (async () => String((await f.inT(() => t.models.Table.findOne({ name: "T13" }).lean().orFail())).roomId))()]) {
      const l = await f.layout(room);
      for (const x of l.tables) {
        expect(x.x + x.w, x.name).toBeLessThanOrEqual(l.room.width);
        expect(x.y + x.h, x.name).toBeLessThanOrEqual(l.room.height);
      }
    }
  });

  it("is manager only; an unknown or malformed room id is 404", async () => {
    const f = await fresh();
    const waiter = f.as(await f.sid("waiter"));
    expect((await waiter("GET", `/api/rooms/${f.salon}/layout`)).statusCode).toBe(403);
    expect((await waiter("PUT", `/api/rooms/${f.salon}/layout`, { version: 0, tables: [] })).statusCode).toBe(403);
    expect((await waiter("POST", "/api/rooms", { name: "X" })).statusCode).toBe(403);
    expect((await f.call("GET", "/api/rooms/0123456789abcdef01234567/layout")).statusCode).toBe(404);
    expect((await f.call("GET", "/api/rooms/nope/layout")).statusCode).toBe(404);
    expect((await f.save({ version: 0, tables: [] }, "0123456789abcdef01234567")).statusCode).toBe(404);
  });
});

describe("PUT /api/rooms/:id/layout", () => {
  it("moving T7 saves, bumps the version and returns the new layout", async () => {
    const f = await fresh();
    const res = await f.save(f.bodyOf(await f.layout(), move("T7", { x: 208, y: 304 })));
    expect(res.statusCode).toBe(200);
    const l = res.json() as Layout;
    expect(l.room.version).toBe(1);
    expect(l.tables.find((x) => x.name === "T7")).toMatchObject({ x: 208, y: 304 });
    const row = await f.inT(() => t.models.Table.findById(f.seed.tables.T7!.id).lean().orFail());
    expect(row).toMatchObject({ x: 208, y: 304, active: true, token: f.seed.tables.T7!.token });
    expect(await f.layout()).toEqual(l);
  });

  it("two saves with the same version: the second gets 409 version_conflict", async () => {
    const f = await fresh();
    const l = await f.layout();
    const [a, b] = await Promise.all([f.save(f.bodyOf(l, move("T7", { x: 192 }))), f.save(f.bodyOf(l, move("T7", { x: 224 })))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const lost = a.statusCode === 409 ? a : b;
    expect(lost.json()).toMatchObject({ error: { code: "version_conflict" } });
    // A stale save afterwards is refused too, and nothing it carried is written.
    const stale = await f.save(f.bodyOf(l, move("T7", { x: 16 })));
    expect(stale.statusCode).toBe(409);
    const now = await f.layout();
    expect(now.room.version).toBe(1);
    expect([192, 224]).toContain(now.tables.find((x) => x.name === "T7")!.x);
  });

  it("two overlapping tables: 400 layout_invalid with both keys; touching edges are fine; the version is unchanged", async () => {
    const f = await fresh();
    const l = await f.layout();
    // T8 is at (340, 298) 88×88; T7 76×76 at x=280 reaches 356.
    const res = await f.save(f.bodyOf(l, move("T7", { x: 280 })));
    expect(res.statusCode).toBe(400);
    const err = f.problems(res);
    expect(err.code).toBe("layout_invalid");
    expect(err.details.problems).toEqual(
      expect.arrayContaining([
        { key: f.seed.tables.T7!.id, code: "overlap" },
        { key: f.seed.tables.T8!.id, code: "overlap" },
      ]),
    );
    expect(err.details.problems).toHaveLength(2);
    expect((await f.save(f.bodyOf(l, move("T7", { x: 264 })))).statusCode).toBe(200); // 264 + 76 = 340: touching
    expect((await f.layout()).room.version).toBe(1);
  });

  it("a round table overlaps by its bounding box", async () => {
    const f = await fresh();
    const l = await f.layout();
    // T7's box (200..276, 298..374) and a corner-to-corner neighbour whose circles would not touch.
    const res = await f.save(f.bodyOf(l, (rows) => [...rows, { key: "n1", name: "T17", shape: "round", x: 270, y: 368, w: 64, h: 64, capacity: 2, sectionStaffId: null }]));
    expect(res.statusCode).toBe(400);
    expect(f.problems(res).details.problems).toEqual(
      expect.arrayContaining([
        { key: "n1", code: "overlap" },
        { key: f.seed.tables.T7!.id, code: "overlap" },
      ]),
    );
  });

  it("out of bounds on any side → out_of_bounds", async () => {
    const f = await fresh();
    const l = await f.layout();
    for (const to of [{ x: -16 }, { y: -1 }, { x: 800 - 75 }, { y: 480 - 75 }]) {
      const res = await f.save(f.bodyOf(l, move("T7", to)));
      expect(res.statusCode, JSON.stringify(to)).toBe(400);
      expect(f.problems(res).details.problems).toContainEqual({ key: f.seed.tables.T7!.id, code: "out_of_bounds" });
    }
    // Flush with the far edges is inside.
    expect((await f.save(f.bodyOf(l, move("T7", { x: 800 - 76, y: 480 - 76 })))).statusCode).toBe(200);
  });

  it("reports every problem at once: name_invalid, name_taken, capacity, waiter, unknown", async () => {
    const f = await fresh();
    const l = await f.layout();
    await f.inT(() =>
      t.models.Table.create({ roomId: f.bar, name: "T17", shape: "round", x: 0, y: 0, w: 64, h: 64, capacity: 2, token: randomBytes(32).toString("base64url"), active: false }),
    );
    const res = await f.save(
      f.bodyOf(l, (rows) => [
        ...rows.map((r) => {
          if (r.name === "T1") return { ...r, name: "X1" };
          if (r.name === "T2") return { ...r, name: "T9" }; // in the bar
          if (r.name === "T3") return { ...r, name: "T17" }; // inactive
          if (r.name === "T4") return { ...r, capacity: 13 };
          if (r.name === "T5") return { ...r, capacity: 0 };
          if (r.name === "T6") return { ...r, sectionStaffId: f.seed.staff.kitchen };
          if (r.name === "T7") return { ...r, sectionStaffId: "0123456789abcdef01234567" };
          return r;
        }),
        { id: f.seed.tables.T9!.id, key: f.seed.tables.T9!.id, name: "T9", shape: "round", x: 600, y: 400, w: 64, h: 64, capacity: 2, sectionStaffId: null },
      ]),
    );
    expect(res.statusCode).toBe(400);
    const id = (n: string) => f.seed.tables[n]!.id;
    expect(f.problems(res).details.problems).toEqual(
      expect.arrayContaining([
        { key: id("T1"), code: "name_invalid" },
        { key: id("T2"), code: "name_taken" },
        { key: id("T3"), code: "name_taken" },
        { key: id("T4"), code: "capacity" },
        { key: id("T5"), code: "capacity" },
        { key: id("T6"), code: "waiter" },
        { key: id("T7"), code: "waiter" },
        { key: id("T9"), code: "unknown" },
      ]),
    );
    const after = await f.layout();
    expect(after).toEqual({ ...l, nextNames: { T: "T18", B: "B6" } });
  });

  it("an unchanged section of a waiter promoted to manager doesn't block a save; setting a non-waiter does", async () => {
    const f = await fresh();
    await f.inT(() => t.models.Staff.updateOne({ _id: f.seed.staff.waiter2 }, { $set: { role: "manager" } }));
    const l = await f.layout();
    const t1 = l.tables.find((x) => x.name === "T1")!;
    expect(t1.sectionStaffId).toBe(f.seed.staff.waiter2);
    const res = await f.save(f.bodyOf(l, move("T7", { x: 192 })));
    expect(res.statusCode).toBe(200);
    expect((res.json() as Layout).tables.find((x) => x.name === "T1")!.sectionStaffId).toBe(f.seed.staff.waiter2);
    const set = await f.save(f.bodyOf(res.json() as Layout, move("T7", { sectionStaffId: f.seed.staff.waiter2 })));
    expect(set.statusCode).toBe(400);
    expect(f.problems(set).details.problems).toEqual([{ key: f.seed.tables.T7!.id, code: "waiter" }]);
    const fresh1 = await f.save(f.bodyOf(res.json() as Layout, (rows) => [...rows, { key: "n", name: "T17", shape: "round", x: 640, y: 380, w: 64, h: 64, capacity: 2, sectionStaffId: f.seed.staff.waiter2 }]));
    expect(f.problems(fresh1).details.problems).toEqual([{ key: "n", code: "waiter" }]);
  });

  it("two tables with the same new name are both name_taken; swapping two names in one save is allowed", async () => {
    const f = await fresh();
    const l = await f.layout();
    const dup = await f.save(f.bodyOf(l, (rows) => [...rows, { key: "a", name: "T20", shape: "round", x: 0, y: 400, w: 64, h: 64, capacity: 2, sectionStaffId: null }, { key: "b", name: "T20", shape: "round", x: 100, y: 400, w: 64, h: 64, capacity: 2, sectionStaffId: null }]));
    expect(dup.statusCode).toBe(400);
    expect(f.problems(dup).details.problems).toEqual([
      { key: "a", code: "name_taken" },
      { key: "b", code: "name_taken" },
    ]);
    const swap = await f.save(f.bodyOf(l, (rows) => rows.map((r) => (r.name === "T1" ? { ...r, name: "T2" } : r.name === "T2" ? { ...r, name: "T1" } : r))));
    expect(swap.statusCode).toBe(200);
    const rows = await f.inT(() => t.models.Table.find({ name: { $in: ["T1", "T2"] } }).lean());
    expect(rows.find((r) => r.name === "T1")!._id.toString()).toBe(f.seed.tables.T2!.id);
    expect(rows.find((r) => r.name === "T2")!._id.toString()).toBe(f.seed.tables.T1!.id);
  });

  it("a malformed body is a plain 400 validation (duplicate keys, sizes over 400)", async () => {
    const f = await fresh();
    const l = await f.layout();
    const dupKeys = await f.save(f.bodyOf(l, (rows) => rows.map((r) => (r.name === "T1" ? { ...r, key: f.seed.tables.T2!.id } : r))));
    expect(dupKeys.statusCode).toBe(400);
    expect(dupKeys.json()).toMatchObject({ error: { code: "validation" } });
    expect((await f.save(f.bodyOf(l, move("T7", { w: 401 })))).json()).toMatchObject({ error: { code: "validation" } });
    expect((await f.save(f.bodyOf(l, move("T7", { w: 0 })))).json()).toMatchObject({ error: { code: "validation" } });
  });

  it("a table with an open check can be moved, but not renamed (also by a prefix change) or deleted", async () => {
    const f = await fresh();
    await f.openCheck("T7");
    const l = await f.layout();
    expect(l.tables.find((x) => x.name === "T7")!.openCheck).toBe(true);
    const id = f.seed.tables.T7!.id;
    const rename = await f.save(f.bodyOf(l, move("T7", { name: "T30" })));
    expect(rename.statusCode).toBe(400);
    expect(f.problems(rename).details.problems).toEqual([{ key: id, code: "open_check_rename" }]);
    const toBooth = await f.save(f.bodyOf(l, move("T7", { name: "B6", shape: "rect" })));
    expect(f.problems(toBooth).details.problems).toEqual([{ key: id, code: "open_check_rename" }]);
    const del = await f.save(f.bodyOf(l, (rows) => rows.filter((r) => r.name !== "T7")));
    expect(del.statusCode).toBe(400);
    expect(f.problems(del).details.problems).toEqual([{ key: id, code: "open_check_delete" }]);
    const moved = await f.save(f.bodyOf(l, move("T7", { x: 192, capacity: 4, sectionStaffId: f.seed.staff.waiter2 })));
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as Layout).tables.find((x) => x.id === id)).toMatchObject({ name: "T7", x: 192, capacity: 4, sectionStaffId: f.seed.staff.waiter2, openCheck: true });
  });

  it("a deleted table becomes inactive, and its past checks still name it on /print", async () => {
    const f = await fresh();
    const past = await f.inT(() => t.models.Check.create({ tableId: f.seed.tables.T6!.id, openedAt: NOW, status: "paid", closedAt: NOW }));
    const res = await f.save(f.bodyOf(await f.layout(), (rows) => rows.filter((r) => r.name !== "T6")));
    expect(res.statusCode).toBe(200);
    expect((res.json() as Layout).tables.map((x) => x.name)).not.toContain("T6");
    const row = await f.inT(() => t.models.Table.findById(f.seed.tables.T6!.id).lean().orFail());
    expect(row.active).toBe(false);
    const print = await f.call("GET", `/api/checks/${String(past._id)}/print`);
    expect(print.statusCode).toBe(200);
    expect(print.json()).toMatchObject({ table: { id: f.seed.tables.T6!.id, name: "T6" } });
    // A deleted name stays taken.
    const reuse = await f.save(f.bodyOf(res.json() as Layout, (rows) => [...rows, { key: "n", name: "T6", shape: "round", x: 640, y: 380, w: 64, h: 64, capacity: 2, sectionStaffId: null }]));
    expect(f.problems(reuse).details.problems).toEqual([{ key: "n", code: "name_taken" }]);
  });

  it("a new table gets a token; nextNames.T advances past the inactive T17", async () => {
    const f = await fresh();
    await f.inT(() =>
      t.models.Table.create({ roomId: f.bar, name: "T17", shape: "round", x: 0, y: 0, w: 64, h: 64, capacity: 2, token: randomBytes(32).toString("base64url"), active: false }),
    );
    const l = await f.layout();
    expect(l.nextNames).toEqual({ T: "T18", B: "B6" });
    const res = await f.save(
      f.bodyOf(l, (rows) => [
        ...rows,
        { key: "new-1", name: l.nextNames.T, shape: "round", x: 640, y: 380, w: 76, h: 76, capacity: 2, sectionStaffId: f.seed.staff.waiter },
        { key: "new-2", name: l.nextNames.B, shape: "rect", x: 16, y: 400, w: 96, h: 64, capacity: 4, sectionStaffId: null },
      ]),
    );
    expect(res.statusCode).toBe(200);
    const after = res.json() as Layout;
    expect(after.nextNames).toEqual({ T: "T19", B: "B7" });
    const t18 = after.tables.find((x) => x.name === "T18")!;
    expect(t18).toMatchObject({ shape: "round", x: 640, y: 380, capacity: 2, sectionStaffId: f.seed.staff.waiter, openCheck: false });
    const rows = await f.inT(() => t.models.Table.find({ name: { $in: ["T18", "B6"] } }).lean());
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(String(r.roomId)).toBe(f.salon);
      expect(r.active).toBe(true);
    }
    expect(rows[0]!.token).not.toBe(rows[1]!.token);
  });

  it("a waiter socket receives layout.saved and tables.changed (changed tables + room) after a save", async () => {
    const f = await fresh();
    const waiter = await connect(url, { sid: await f.sid("waiter") });
    const res = await f.save(f.bodyOf(await f.layout(), (rows) => move("T7", { x: 192 })(rows).filter((r) => r.name !== "T6")));
    expect(res.statusCode).toBe(200);
    const changed = await waiter.next((e) => e.type === "tables.changed");
    expect(changed.ids.sort()).toEqual([f.seed.tables.T6!.id, f.seed.tables.T7!.id, f.salon].sort());
    const saved = await waiter.next((e) => e.type === "layout.saved");
    expect(saved.ids).toEqual([f.salon]);
  });
});

describe("rooms", () => {
  it("create, rename and delete an empty room; a room with active tables can't be deleted", async () => {
    const f = await fresh();
    const created = await f.call("POST", "/api/rooms", { name: "Garden" });
    expect(created.statusCode).toBe(201);
    const room = created.json() as Layout["room"];
    expect(room).toMatchObject({ name: "Garden", width: 800, height: 480, version: 0 });
    const renamed = await f.call("PATCH", `/api/rooms/${room.id}`, { name: "Courtyard" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: room.id, name: "Courtyard" });
    expect((await f.call("PATCH", `/api/rooms/${room.id}`, { name: "" })).statusCode).toBe(400);
    expect((await f.layout(room.id)).tables).toEqual([]);

    const full = await f.call("DELETE", `/api/rooms/${f.salon}`);
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ error: { code: "room_not_empty" } });

    expect((await f.call("DELETE", `/api/rooms/${room.id}`)).statusCode).toBe(200);
    expect(await f.inT(() => t.models.Room.findById(room.id).lean())).toBeNull();
    expect((await f.call("DELETE", `/api/rooms/${room.id}`)).statusCode).toBe(404);
  });

  it("a room whose tables are all deleted can be removed; the inactive tables keep their history", async () => {
    const f = await fresh();
    const l = await f.layout(f.bar);
    expect((await f.save({ version: l.room.version, tables: [] }, f.bar)).statusCode).toBe(200);
    expect((await f.call("DELETE", `/api/rooms/${f.bar}`)).statusCode).toBe(200);
    const t9 = await f.inT(() => t.models.Table.findById(f.seed.tables.T9!.id).lean().orFail());
    expect(t9).toMatchObject({ active: false, name: "T9" });
  });
});
