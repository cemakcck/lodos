import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant, unscoped } from "../src/db/tenancy";
import { createPresence } from "../src/realtime/presence";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";
import { closeSockets, connect, connectError, listen, until, type WireEvent } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
let url: string;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW, demoMode: true, sandboxesPerIpHour: 1000 });
  url = await listen(t);
});
afterEach(() => closeSockets());
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
const sid = (s: Seeded, who: keyof Seeded["seed"]["staff"]) =>
  createSession(t.models, s.seed.staff[who], s.tenantId, who === "kitchen" || who === "bar" ? "station" : "person", t.clock.now());

const ticketFor = (tableId: string) => (e: WireEvent) => e.type === "ticket.created" && e.tableId === tableId;

async function order(s: Seeded, table: string, items: { name: string; options?: { groupId: string; optionIds: string[] }[]; qty?: number }[]) {
  const lines = await Promise.all(
    items.map(async (i) => ({ itemId: (await itemNamed(t, s.tenantId, i.name)).id, options: i.options ?? [], qty: i.qty ?? 1 })),
  );
  return guest(t, s.seed.tables[table]!.token).post("/api/guest/orders", orderBody(lines));
}

describe("handshake", () => {
  it("rejects a socket without credentials, with an unknown token, an inactive table or a bad cookie", async () => {
    const s = await seedTenant(t);
    expect(await connectError(url, {})).toBe("unauthorized");
    expect(await connectError(url, { tableToken: "nope" })).toBe("unauthorized");
    expect(await connectError(url, { tableToken: "" })).toBe("unauthorized");
    expect(await connectError(url, { sid: "not-a-session" })).toBe("unauthorized");
    await runWithTenant(s.tenantId, () => t.models.Table.updateOne({ _id: s.seed.tables.T3!.id }, { $set: { active: false } }));
    expect(await connectError(url, { tableToken: s.seed.tables.T3!.token })).toBe("unauthorized");
  });

  it("joins rooms by role, and every socket of the tenant also joins <t>:all", async () => {
    const s = await seedTenant(t);
    const T = s.tenantId;
    const roomsOf = async (id: string) => {
      const [sock] = await t.io.in(id).fetchSockets();
      return [...sock!.rooms].filter((r) => r !== id).sort();
    };
    const kitchen = await connect(url, { sid: await sid(s, "kitchen") });
    const bar = await connect(url, { sid: await sid(s, "bar") });
    const waiter = await connect(url, { sid: await sid(s, "waiter") });
    const manager = await connect(url, { sid: await sid(s, "manager") });
    const g = await connect(url, { tableToken: s.seed.tables.T7!.token });
    expect(await roomsOf(kitchen.socket.id!)).toEqual([`${T}:all`, `${T}:station:kitchen`]);
    expect(await roomsOf(bar.socket.id!)).toEqual([`${T}:all`, `${T}:station:bar`]);
    expect(await roomsOf(waiter.socket.id!)).toEqual([`${T}:all`, `${T}:floor`]);
    expect(await roomsOf(manager.socket.id!)).toEqual(
      [`${T}:all`, `${T}:floor`, `${T}:manager`, `${T}:station:bar`, `${T}:station:kitchen`].sort(),
    );
    expect(await roomsOf(g.socket.id!)).toEqual([`${T}:all`, `${T}:table:${s.seed.tables.T7!.id}`]);
  });

  it("a table token wins over a staff cookie in the same browser: the socket joins only the table room", async () => {
    const s = await seedTenant(t);
    const g = await connect(url, { sid: await sid(s, "manager"), tableToken: s.seed.tables.T7!.token });
    const [sock] = await t.io.in(g.socket.id!).fetchSockets();
    expect([...sock!.rooms].filter((r) => r !== g.socket.id).sort()).toEqual([
      `${s.tenantId}:all`,
      `${s.tenantId}:table:${s.seed.tables.T7!.id}`,
    ]);
  });

  it("a table token that is bad does not fall back to the staff cookie", async () => {
    const s = await seedTenant(t);
    expect(await connectError(url, { sid: await sid(s, "manager"), tableToken: "nope" })).toBe("unauthorized");
  });
});

describe("events after commit", () => {
  it("a food order reaches the kitchen within 1 s, and never the bar", async () => {
    const s = await seedTenant(t);
    const kitchen = await connect(url, { sid: await sid(s, "kitchen") });
    const bar = await connect(url, { sid: await sid(s, "bar") });
    const T7 = s.seed.tables.T7!.id;

    const started = Date.now();
    expect((await order(s, "T7", [{ name: "Truffle fries" }])).statusCode).toBe(201);
    const got = await kitchen.next(ticketFor(T7), 1_000);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(got).toEqual({ type: "ticket.created", ids: [expect.any(String)], tableId: T7, at: NOW.toISOString() });

    // Barrier: a later drink order reaches the bar; the food ticket must not have come before it.
    expect((await order(s, "T7", [{ name: "Bergamot spritz" }])).statusCode).toBe(201);
    await bar.next(ticketFor(T7));
    expect(bar.events.filter((e) => e.type === "ticket.created")).toHaveLength(1);
    expect(kitchen.events.filter((e) => e.type === "ticket.created")).toHaveLength(1);
  });

  it("a manager socket gets each event once, though it sits in several audience rooms", async () => {
    const s = await seedTenant(t);
    const manager = await connect(url, { sid: await sid(s, "manager") });
    expect((await order(s, "T7", [{ name: "Truffle fries" }])).statusCode).toBe(201);
    await manager.next((e) => e.type === "check.updated");
    expect(manager.events.map((e) => e.type)).toEqual(["ticket.created", "check.updated"]);
  });

  it("a T7 guest gets T7's ticket and check, nothing of T3's", async () => {
    const s = await seedTenant(t);
    const g7 = await connect(url, { tableToken: s.seed.tables.T7!.token });
    const T7 = s.seed.tables.T7!.id;
    expect((await order(s, "T3", [{ name: "Truffle fries" }])).statusCode).toBe(201);
    expect((await order(s, "T7", [{ name: "Truffle fries" }, { name: "Bergamot spritz" }])).statusCode).toBe(201);
    await g7.next((e) => e.type === "check.updated" && e.tableId === T7);
    expect(g7.events.every((e) => e.tableId === T7)).toBe(true);
    expect(g7.events.map((e) => e.type).sort()).toEqual(["check.updated", "ticket.created", "ticket.created"]);
  });

  it("availability.changed reaches guests of every table and the staff", async () => {
    const s = await seedTenant(t);
    const g3 = await connect(url, { tableToken: s.seed.tables.T3!.token });
    const kitchen = await connect(url, { sid: await sid(s, "kitchen") });
    const ribeye = await itemNamed(t, s.tenantId, "Dry-aged ribeye");
    expect(
      (await order(s, "T7", [{ name: "Dry-aged ribeye", options: [{ groupId: "doneness", optionIds: ["medium-rare"] }] }])).statusCode,
    ).toBe(201);
    const e = await g3.next((x) => x.type === "availability.changed");
    expect(e).toEqual({ type: "availability.changed", ids: [ribeye.id], at: NOW.toISOString() });
    await kitchen.next((x) => x.type === "availability.changed");
  });

  it("emits nothing when placeOrder throws sold_out", async () => {
    const s = await seedTenant(t);
    const manager = await connect(url, { sid: await sid(s, "manager") });
    const g7 = await connect(url, { tableToken: s.seed.tables.T7!.token });
    const res = await order(s, "T7", [{ name: "King prawns" }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("sold_out");
    // Barrier: the next successful order's events are the first anyone sees.
    expect((await order(s, "T7", [{ name: "Truffle fries" }])).statusCode).toBe(201);
    await manager.next((e) => e.type === "check.updated");
    await g7.next((e) => e.type === "check.updated");
    expect(manager.events.map((e) => e.type)).toEqual(["ticket.created", "check.updated"]);
    expect(g7.events.map((e) => e.type)).toEqual(["ticket.created", "check.updated"]);
  });

  it("call.opened reaches the floor and the table, not the kitchen", async () => {
    const s = await seedTenant(t);
    const waiter = await connect(url, { sid: await sid(s, "waiter") });
    const kitchen = await connect(url, { sid: await sid(s, "kitchen") });
    const g7 = await connect(url, { tableToken: s.seed.tables.T7!.token });
    const res = await guest(t, s.seed.tables.T7!.token).post("/api/guest/calls", { reason: "other" });
    expect(res.statusCode).toBeLessThan(300);
    await waiter.next((e) => e.type === "call.opened");
    await g7.next((e) => e.type === "call.opened");
    expect((await order(s, "T7", [{ name: "Truffle fries" }])).statusCode).toBe(201);
    await kitchen.next(ticketFor(s.seed.tables.T7!.id));
    expect(kitchen.events.map((e) => e.type)).toEqual(["ticket.created"]);
  });
});

describe("presence", () => {
  async function visitor() {
    const res = await t.inject({ method: "POST", url: "/api/demo/session", payload: { role: "kitchen" } });
    const sb = decodeURIComponent(res.cookies.find((c) => c.name === "lodos_sb")!.value);
    return {
      sid: res.cookies.find((c) => c.name === "lodos_sid")!.value,
      tenantId: sb.slice(0, sb.lastIndexOf(".")).replace(/^s:/, ""),
    };
  }
  const lastSeen = async (id: string) =>
    (await unscoped("test", () => t.models.Sandbox.findById(id).lean().orFail())).lastSeenAt.toISOString();

  it("connect → isConnected and lastSeenAt; heartbeat refreshes it; last disconnect → not connected, lastSeenAt updated", async () => {
    const v = await visitor();
    expect(t.app.presence.isConnected(v.tenantId)).toBe(false);

    t.clock.advance(5 * 60_000);
    const a = await connect(url, { sid: v.sid });
    const b = await connect(url, { sid: v.sid });
    expect(t.app.presence.isConnected(v.tenantId)).toBe(true);
    await t.app.presence.settled();
    expect(await lastSeen(v.tenantId)).toBe(t.clock.now().toISOString());

    t.clock.advance(60_000);
    await t.app.presence.heartbeat();
    expect(await lastSeen(v.tenantId)).toBe(t.clock.now().toISOString());

    t.clock.advance(60_000);
    a.close();
    await until(() => t.app.presence.count(v.tenantId) === 1);
    expect(t.app.presence.isConnected(v.tenantId)).toBe(true);

    t.clock.advance(60_000);
    b.close();
    await until(() => !t.app.presence.isConnected(v.tenantId));
    await t.app.presence.settled();
    expect(await lastSeen(v.tenantId)).toBe(t.clock.now().toISOString());
  });

  it("a non-sandbox tenant counts as connected but writes no Sandbox record", async () => {
    const s = await seedTenant(t);
    const k = await connect(url, { sid: await sid(s, "kitchen") });
    expect(t.app.presence.isConnected(s.tenantId)).toBe(true);
    await t.app.presence.heartbeat();
    await t.app.presence.settled();
    expect(await unscoped("test", () => t.models.Sandbox.findById(s.tenantId).lean())).toBeNull();
    k.close();
    await until(() => !t.app.presence.isConnected(s.tenantId));
  });
});

describe("createPresence (unit)", () => {
  it("persists every 60 s while connected, on the injected clock, and stops on stop()", async () => {
    vi.useFakeTimers();
    try {
      let now = NOW.getTime();
      const persist = vi.fn<(id: string, at: Date) => Promise<void>>(async () => {});
      const p = createPresence({ clock: { now: () => new Date(now) }, persist, onError: () => {} });
      p.start();
      p.connect("a");
      p.connect("b");
      p.disconnect("b");
      await p.settled();
      expect(persist.mock.calls.map((c) => c[0])).toEqual(["a", "b", "b"]);
      persist.mockClear();

      now += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(persist.mock.calls).toEqual([["a", new Date(now)]]);

      p.stop();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never goes below zero on a stray disconnect", () => {
    const p = createPresence({ clock: { now: () => NOW }, persist: async () => {}, onError: () => {} });
    p.disconnect("x");
    expect(p.count("x")).toBe(0);
    p.connect("x");
    expect(p.isConnected("x")).toBe(true);
  });
});
