import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
    expect((await roomsOf(k.socket.id!)).sort()).toEqual([`${a.tenantId}:all`, `${a.tenantId}:station:kitchen`]);
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
