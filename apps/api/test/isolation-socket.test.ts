import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody } from "./helpers";
import { closeSockets, connect, connectError, listen, until, type WireEvent } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

type T = Awaited<ReturnType<typeof makeTestApp>>;
type Visitor = { sb: string; sid: string; tenantId: string; t7Token: string; t7Id: string };

let t: T;
let url: string;
let a: Visitor;
let b: Visitor;

async function visitor(role: string): Promise<Visitor> {
  const res = await t.inject({ method: "POST", url: "/api/demo/session", payload: { role } });
  const get = (name: string) => res.cookies.find((c) => c.name === name)!.value;
  const val = decodeURIComponent(get("lodos_sb"));
  const tenantId = val.slice(0, val.lastIndexOf(".")).replace(/^s:/, "");
  const t7 = await runWithTenant(tenantId, () => t.models.Table.findOne({ name: "T7" }).lean().orFail());
  return { sb: get("lodos_sb"), sid: get("lodos_sid"), tenantId, t7Token: t7.token, t7Id: String(t7._id) };
}

async function foodOrder(v: Visitor) {
  const fries = await itemNamed(t, v.tenantId, "Truffle fries");
  const ribeye = await itemNamed(t, v.tenantId, "Dry-aged ribeye");
  // The ribeye is low stock, so the order also emits availability.changed to `all` (guests included).
  const res = await guest(t, v.t7Token).post(
    "/api/guest/orders",
    orderBody([{ itemId: fries.id }, { itemId: ribeye.id, options: [{ groupId: "doneness", optionIds: ["medium-rare"] }] }]),
  );
  expect(res.statusCode).toBe(201);
}

const roomsOf = async (socketId: string) => {
  const [sock] = await t.io.in(socketId).fetchSockets();
  return [...sock!.rooms].filter((r) => r !== socketId);
};

beforeAll(async () => {
  t = await makeTestApp({ now: NOW, demoMode: true, sandboxesPerIpHour: 1000 });
  url = await listen(t);
  a = await visitor("kitchen");
  b = await visitor("manager");
});
afterEach(() => closeSockets());
afterAll(() => t.close());

describe("cross-sandbox isolation over sockets", () => {
  it("A's kitchen and guest sockets receive nothing when B gets an order", async () => {
    const aKitchen = await connect(url, { sid: a.sid });
    const aGuest = await connect(url, { tableToken: a.t7Token });
    const bManager = await connect(url, { sid: b.sid });

    await foodOrder(b);
    await bManager.next((e) => e.type === "availability.changed");

    // Barrier: A's own order arrives; nothing of B's may have come before it (per-socket delivery is ordered).
    await foodOrder(a);
    const own = (e: WireEvent) => e.type === "availability.changed";
    await aKitchen.next(own);
    await aGuest.next(own);
    for (const e of [...aKitchen.events, ...aGuest.events]) {
      if (e.tableId) expect(e.tableId).toBe(a.t7Id);
    }
    expect(aKitchen.events.map((e) => e.type)).toEqual(["ticket.created", "availability.changed"]);
    expect(aGuest.events.map((e) => e.type)).toEqual(["ticket.created", "check.updated", "availability.changed"]);
    expect(bManager.events.every((e) => !e.tableId || e.tableId === b.t7Id)).toBe(true);
  });

  it("split.updated reaches only its own tenant's floor", async () => {
    const aw = await visitor("waiter");
    const splitT7 = async (v: Visitor) => {
      const req = (method: "POST" | "PUT", path: string, payload: object) => t.inject({ method, url: path, cookies: { lodos_sid: v.sid }, payload });
      const seat = await req("POST", `/api/tables/${v.t7Id}/seat`, { covers: 2 });
      expect([200, 201]).toContain(seat.statusCode); // B's T7 may already have a QR-opened check
      const checkId = seat.json().checkId as string;
      expect((await req("PUT", `/api/checks/${checkId}/split`, { mode: "even", count: 2 })).statusCode).toBe(200);
      return checkId;
    };
    const aFloor = await connect(url, { sid: aw.sid });
    const bManager = await connect(url, { sid: b.sid });
    const bCheck = await splitT7(b);
    await bManager.next((e) => e.type === "split.updated" && e.ids.includes(bCheck));
    // Barrier: A's own split arrives; nothing of B's may have come before it.
    const aCheck = await splitT7(aw);
    await aFloor.next((e) => e.type === "split.updated");
    const splits = aFloor.events.filter((e) => e.type === "split.updated");
    expect(splits.map((e) => e.ids)).toEqual([[aCheck]]);
    for (const e of aFloor.events) if (e.tableId) expect(e.tableId).toBe(aw.t7Id);
  });

  it("layout.saved reaches only its own tenant's floor and managers", async () => {
    const am = await visitor("manager");
    const waiter = await runWithTenant(am.tenantId, () => t.models.Staff.findOne({ role: "waiter", active: true }).lean().orFail());
    const awSid = await createSession(t.models, String(waiter._id), am.tenantId, "person", NOW);
    const saveT7Room = async (v: Visitor) => {
      const req = (method: "GET" | "PUT", path: string, payload?: object) => t.inject({ method, url: path, cookies: { lodos_sid: v.sid }, ...(payload ? { payload } : {}) });
      const room = String((await runWithTenant(v.tenantId, () => t.models.Table.findById(v.t7Id).lean().orFail())).roomId);
      const layout = (await req("GET", `/api/rooms/${room}/layout`)).json() as { room: { version: number }; tables: { id: string }[] };
      const res = await req("PUT", `/api/rooms/${room}/layout`, { version: layout.room.version, tables: layout.tables.map((x) => ({ ...x, key: x.id })) });
      expect(res.statusCode, res.body).toBe(200);
      return room;
    };
    const aManager = await connect(url, { sid: am.sid });
    const aFloor = await connect(url, { sid: awSid });
    const bManager = await connect(url, { sid: b.sid });
    const bRoom = await saveT7Room(b);
    await bManager.next((e) => e.type === "layout.saved" && e.ids.includes(bRoom));
    // Barrier: A's own save arrives; nothing of B's may have come before it.
    const aRoom = await saveT7Room(am);
    for (const c of [aManager, aFloor]) {
      await c.next((e) => e.type === "layout.saved");
      expect(c.events.filter((e) => e.type === "layout.saved").map((e) => e.ids)).toEqual([[aRoom]]);
      expect(c.events.some((e) => e.ids?.includes(bRoom))).toBe(false);
    }
  });

  it("adjustment.changed reaches only its own tenant's kitchen and guests", async () => {
    // A comp of a kitchen line on T7, by the tenant's manager (the demo manager is "Selin").
    const compT7 = async (v: Visitor) => {
      await foodOrder(v);
      const manager = await runWithTenant(v.tenantId, () => t.models.Staff.findOne({ role: "manager" }).lean().orFail());
      const sid = await createSession(t.models, String(manager._id), v.tenantId, "person", NOW);
      const order = await runWithTenant(v.tenantId, () => t.models.Order.findOne({ tableId: v.t7Id }).sort({ placedAt: -1, _id: -1 }).lean().orFail());
      const res = await t.inject({
        method: "POST",
        url: `/api/checks/${String(order.checkId)}/adjustments`,
        cookies: { lodos_sid: sid },
        payload: { lineRef: `${String(order._id)}:0`, kind: "comp", qty: 1, reason: "regular" },
      });
      expect(res.statusCode).toBe(201);
      return res.json().adjustment.id as string;
    };
    const aKitchen = await connect(url, { sid: a.sid });
    const aGuest = await connect(url, { tableToken: a.t7Token });
    const bManager = await connect(url, { sid: b.sid });
    const bAdj = await compT7(b);
    await bManager.next((e) => e.type === "adjustment.changed" && e.ids.includes(bAdj));
    // Barrier: A's own adjustment arrives; nothing of B's may have come before it.
    const aAdj = await compT7(a);
    await aKitchen.next((e) => e.type === "adjustment.changed");
    await aGuest.next((e) => e.type === "adjustment.changed");
    for (const c of [aKitchen, aGuest]) {
      expect(c.events.filter((e) => e.type === "adjustment.changed").map((e) => e.ids)).toEqual([[aAdj]]);
      for (const e of c.events) if (e.tableId) expect(e.tableId).toBe(a.t7Id);
    }
  });

  it("session.ended reaches only the deactivated person's sockets, in their own tenant", async () => {
    // B's manager deactivates B's Mert while A's Mert (another sandbox, another id) and A's floor are connected.
    const aw = await visitor("waiter");
    const mertOf = (v: Visitor) => runWithTenant(v.tenantId, () => t.models.Staff.findOne({ name: "Mert" }).lean().orFail());
    const [aMert, bMert] = [await mertOf(aw), await mertOf(b)];
    const aMertSock = await connect(url, { sid: await createSession(t.models, String(aMert._id), aw.tenantId, "person", NOW) });
    const bMertSock = await connect(url, { sid: await createSession(t.models, String(bMert._id), b.tenantId, "person", NOW) });
    const aFloor = await connect(url, { sid: aw.sid });
    const res = await t.inject({ method: "POST", url: `/api/staff/${String(bMert._id)}/deactivate`, cookies: { lodos_sid: b.sid } });
    expect(res.statusCode).toBe(200);
    expect((await bMertSock.next((e) => e.type === "session.ended")).ids).toEqual([String(bMert._id)]);
    // A's Mert is a person in A's tenant: B's deactivation can't touch him. Barrier: A's own deactivation arrives.
    const aManager = await runWithTenant(aw.tenantId, () => t.models.Staff.findOne({ role: "manager" }).lean().orFail());
    const aMgrSid = await createSession(t.models, String(aManager._id), aw.tenantId, "person", NOW);
    expect((await t.inject({ method: "POST", url: `/api/staff/${String(aMert._id)}/deactivate`, cookies: { lodos_sid: aMgrSid } })).statusCode).toBe(200);
    await aMertSock.next((e) => e.type === "session.ended");
    expect(aMertSock.events.filter((e) => e.type === "session.ended").map((e) => e.ids)).toEqual([[String(aMert._id)]]);
    await aFloor.next((e) => e.type === "tables.changed");
    expect(aFloor.events.some((e) => e.type === "session.ended")).toBe(false);
  });

  it("a guest socket with A's token joins only A's rooms, whatever B cookies the browser holds", async () => {
    const g = await connect(url, {
      tableToken: a.t7Token,
      cookie: `lodos_sid=${b.sid}; lodos_sb=${b.sb}`,
    });
    const rooms = await roomsOf(g.socket.id!);
    expect(rooms.sort()).toEqual([`${a.tenantId}:all`, `${a.tenantId}:table:${a.t7Id}`]);
    for (const r of rooms) expect(r.startsWith(`${b.tenantId}:`)).toBe(false);
    for (const r of [`${b.tenantId}:all`, `${b.tenantId}:table:${b.t7Id}`, `${b.tenantId}:floor`]) {
      const ids = (await t.io.in(r).fetchSockets()).map((s) => s.id);
      expect(ids).not.toContain(g.socket.id);
    }
  });

  it("a staff cookie joins its own session's tenant rooms, never the sandbox cookie's", async () => {
    const k = await connect(url, { cookie: `lodos_sid=${a.sid}; lodos_sb=${b.sb}` });
    const kitchenId = await runWithTenant(a.tenantId, () => t.models.Staff.findOne({ role: "kitchen" }).lean().orFail());
    expect((await roomsOf(k.socket.id!)).sort()).toEqual(
      [`${a.tenantId}:all`, `${a.tenantId}:person:${String(kitchenId._id)}`, `${a.tenantId}:station:kitchen`].sort(),
    );
  });

  it("presence counts per tenant: A's socket does not keep B connected", async () => {
    // Sockets from earlier tests close asynchronously on the server.
    await until(() => !t.app.presence.isConnected(a.tenantId) && !t.app.presence.isConnected(b.tenantId));
    const k = await connect(url, { sid: a.sid });
    expect(t.app.presence.isConnected(a.tenantId)).toBe(true);
    expect(t.app.presence.isConnected(b.tenantId)).toBe(false);
    k.close();
  });

  it("a sandbox cookie alone, or a forged room request, gets no socket", async () => {
    expect(await connectError(url, { cookie: `lodos_sb=${b.sb}` })).toBe("unauthorized");
    expect(await connectError(url, { tableToken: `${b.tenantId}:table:${b.t7Id}` })).toBe("unauthorized");
  });
});
