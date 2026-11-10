import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { makeTestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
let t: Awaited<ReturnType<typeof makeTestApp>>;
let seed: SeedResult;
const sids: Record<string, string> = {};
let ip = 0;

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  seed = await seedRestaurant(t.models, "main", NOW, { liveService: true });
  for (const role of ["kitchen", "bar", "manager", "waiter"] as const) {
    const pin = { kitchen: "3333", bar: "4444", manager: "9999", waiter: "1111" }[role];
    const res = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: seed.staff[role], pin }, remoteAddress: `10.9.0.${++ip}` });
    expect(res.statusCode).toBe(200);
    sids[role] = res.cookies.find((c) => c.name === "lodos_sid")!.value;
  }
});
afterAll(() => t.close());

const call = (role: string, method: "GET" | "POST", url: string) => t.inject({ method, url, cookies: { lodos_sid: sids[role]! } });
const tickets = (station: string, tab = "active", role = station) => call(role, "GET", `/api/kds/${station}?tab=${tab}`);
const find = (q: object) => runWithTenant("main", () => t.models.Ticket.findOne(q).lean().orFail());

/** Adds an unserved ready bar ticket (readyAt = `at`) so recall tests do not depend on how many the seed has. */
async function addReadyBar(at: Date) {
  const base = await find({ station: "bar" });
  const doc = await runWithTenant("main", () =>
    t.models.Ticket.create({ orderId: base.orderId, checkId: base.checkId, tableId: base.tableId, tableName: base.tableName, station: "bar", status: "ready", sentAt: new Date(at.getTime() - 60_000), readyAt: at, items: base.items }),
  );
  return String(doc._id);
}

describe("GET /api/kds/:station", () => {
  it("active tickets are oldest first, with ageState and stats.late counting the seeded 2", async () => {
    const res = await tickets("kitchen");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const sent = body.tickets.map((x: { sentAt: string }) => Date.parse(x.sentAt));
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
    expect(body.tickets.every((x: { status: string }) => x.status === "new" || x.status === "started")).toBe(true);
    expect(body.stats.late).toBe(2);
    expect(body.thresholds).toEqual({ warnMin: 8, lateMin: 15 });
    expect(body.now).toBe(NOW.toISOString());
    expect(body.tickets.filter((x: { ageState: string }) => x.ageState === "late")).toHaveLength(2);
    expect(body.tickets[0].items[0].name).toHaveProperty("tr");
  });

  it("the bar never sees kitchen tickets, and a kitchen account cannot open the bar", async () => {
    const bar = (await tickets("bar")).json();
    expect(bar.tickets.length).toBeGreaterThan(0);
    expect(bar.tickets.every((x: { station: string }) => x.station === "bar")).toBe(true);
    expect((await tickets("bar", "active", "kitchen")).statusCode).toBe(403);
    expect((await tickets("kitchen", "active", "manager")).statusCode).toBe(200);
    expect((await tickets("kitchen", "active", "waiter")).statusCode).toBe(403);
    expect((await call("manager", "GET", "/api/kds/pastry")).statusCode).toBe(404);
  });

  it("all-day counts unchecked items across active tickets, grouped by menu item, and drops after a toggle", async () => {
    const before = (await tickets("kitchen")).json();
    const sum = (b: typeof before) => b.allDay.reduce((n: number, e: { qty: number }) => n + e.qty, 0);
    const qtys = before.allDay.map((e: { qty: number }) => e.qty);
    expect(qtys).toEqual([...qtys].sort((a: number, b: number) => b - a));
    const target = before.tickets.find((x: { items: { checked: boolean }[] }) => x.items.some((i) => !i.checked));
    const idx = target.items.findIndex((i: { checked: boolean }) => !i.checked);
    const qty = target.items[idx].qty;
    const res = await call("kitchen", "POST", `/api/tickets/${target.id}/items/${idx}/toggle`);
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.items[idx].checked).toBe(true);
    expect(sum((await tickets("kitchen")).json())).toBe(sum(before) - qty);
    await call("kitchen", "POST", `/api/tickets/${target.id}/items/${idx}/toggle`); // restore
    expect(sum((await tickets("kitchen")).json())).toBe(sum(before));
  });

  it("flags allergens and notes mentioning allergies, and masks profanity in notes", async () => {
    const tk = await find({ station: "kitchen", status: "new", servedAt: null }).catch(() => null);
    const target = tk ?? (await find({ station: "kitchen", servedAt: null }));
    await runWithTenant("main", () =>
      t.models.Ticket.updateOne({ _id: target._id }, { $push: { items: { orderItemIndex: 9, name: { en: "X", tr: "X" }, qty: 1, options: [], note: "no peanut, shit", allergens: [], checked: false } } }),
    );
    const body = (await tickets("kitchen", "active")).json();
    const tv = body.tickets.find((x: { id: string }) => x.id === String(target._id));
    const line = tv.items[tv.items.length - 1];
    expect(line.allergyFlag).toBe(true);
    expect(line.note).toBe("no peanut, •••");
    await runWithTenant("main", () => t.models.Ticket.updateOne({ _id: target._id }, { $pop: { items: 1 } }));
    // Task 16 ruling: dish allergens alone are a quiet line, not the red flag; only the guest's note raises it.
    await runWithTenant("main", () =>
      t.models.Ticket.updateOne({ _id: target._id }, { $push: { items: { orderItemIndex: 9, name: { en: "Y", tr: "Y" }, qty: 1, options: [], note: null, allergens: ["sesame"], checked: false } } }),
    );
    const again = (await tickets("kitchen", "active")).json().tickets.find((x: { id: string }) => x.id === String(target._id));
    expect(again.items[again.items.length - 1]).toMatchObject({ allergens: ["sesame"], allergyFlag: false });
    await runWithTenant("main", () => t.models.Ticket.updateOne({ _id: target._id }, { $pop: { items: 1 } }));
  });

  it("done tab lists today's ready tickets newest first; eightySix lists seeded sold-out items", async () => {
    const done = (await tickets("kitchen", "done")).json();
    expect(done.tickets.length).toBeGreaterThan(0);
    const ready = done.tickets.map((x: { readyAt: string }) => Date.parse(x.readyAt));
    expect(ready).toEqual([...ready].sort((a, b) => b - a));
    expect(done.stats.avgTicketMs).toBeGreaterThan(0);
    const all = [...(await tickets("kitchen")).json().eightySix, ...(await tickets("bar")).json().eightySix];
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]).toMatchObject({ itemId: expect.any(String), name: { en: expect.any(String), tr: expect.any(String) } });
  });
});

describe("ticket actions", () => {
  it("start moves new to started", async () => {
    const target = await find({ station: "bar", status: "new" });
    const res = await call("bar", "POST", `/api/tickets/${target._id}/start`);
    expect(res.json().ticket).toMatchObject({ status: "started", startedAt: NOW.toISOString() });
  });

  it("bump marks ready, checks every item, and emits ticket.updated to the floor; a double bump is a 200 no-op without a second event", async () => {
    const target = await find({ station: "kitchen", status: "new" }).catch(() => find({ station: "kitchen", status: "started" }));
    const emit = vi.spyOn(t.app.realtime, "emit");
    const res = await call("kitchen", "POST", `/api/tickets/${target._id}/bump`);
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket).toMatchObject({ status: "ready", readyAt: NOW.toISOString() });
    expect(res.json().ticket.items.every((i: { checked: boolean }) => i.checked)).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("main", "ticket.updated", { ids: [String(target._id)], tableId: String(target.tableId) }, expect.arrayContaining(["floor", "kitchen"]));
    const again = await call("kitchen", "POST", `/api/tickets/${target._id}/bump`);
    expect(again.statusCode).toBe(200);
    expect(again.json().ticket.status).toBe("ready");
    expect(emit).toHaveBeenCalledTimes(1);
    emit.mockRestore();
  });

  it("concurrent bumps yield one change", async () => {
    const target = await find({ station: "bar", status: { $in: ["new", "started"] } });
    const emit = vi.spyOn(t.app.realtime, "emit");
    const rs = await Promise.all([1, 2, 3].map(() => call("bar", "POST", `/api/tickets/${target._id}/bump`)));
    expect(rs.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(emit).toHaveBeenCalledTimes(1);
    emit.mockRestore();
  });

  it("recall brings back only the latest bumped unserved ticket (never a served one), and 404s when none", async () => {
    // Kitchen: the bump above is the latest; served rounds are older and must never be chosen.
    const res = await call("kitchen", "POST", "/api/kds/kitchen/recall");
    expect(res.statusCode).toBe(200);
    const back = res.json().ticket;
    expect(back).toMatchObject({ status: "started", readyAt: null, servedAt: null });
    expect(back.items.every((i: { checked: boolean }) => i.checked)).toBe(true);
    const doc = await find({ _id: back.id });
    expect(doc.servedAt).toBeNull();
    // Next recall takes another unserved ready ticket or 404s, but never a served one.
    t.clock.advance(4000);
    const next = await call("kitchen", "POST", "/api/kds/kitchen/recall");
    if (next.statusCode === 200) expect((await find({ _id: next.json().ticket.id })).servedAt).toBeNull();
    else expect(next.statusCode).toBe(404);
    const servedStill = await runWithTenant("main", () => t.models.Ticket.countDocuments({ station: "kitchen", status: "ready", servedAt: { $ne: null } }));
    expect(servedStill).toBeGreaterThan(0);
    t.clock.advance(4000);
    expect((await call("kitchen", "POST", "/api/kds/kitchen/recall")).statusCode).toBe(404);
  });

  it("concurrent recalls un-ready exactly one ticket and emit once", async () => {
    const ids = await runWithTenant("main", async () => {
      const rs = await t.models.Ticket.find({ station: "bar", status: "ready", servedAt: null }).lean();
      return rs.map((r) => String(r._id));
    });
    // Ensure at least two unserved ready bar tickets exist.
    while (ids.length < 2) {
      ids.push(await addReadyBar(new Date(t.clock.now().getTime() - 1000 * (3 - ids.length))));
    }
    t.clock.advance(4000);
    const emit = vi.spyOn(t.app.realtime, "emit");
    const rs = await Promise.all([call("bar", "POST", "/api/kds/bar/recall"), call("bar", "POST", "/api/kds/bar/recall")]);
    expect(rs.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(rs[0]!.json().ticket.id).toBe(rs[1]!.json().ticket.id);
    const back = await runWithTenant("main", () => t.models.Ticket.countDocuments({ _id: { $in: ids }, status: "started" }));
    const stillReady = await runWithTenant("main", () => t.models.Ticket.countDocuments({ _id: { $in: ids }, status: "ready" }));
    expect(back).toBe(1);
    expect(stillReady).toBe(ids.length - 1);
    emit.mockRestore();
  });

  it("sequential recalls inside 3 s return the same ticket unchanged; after 4 s the next ticket is recalled", async () => {
    t.clock.advance(4000);
    const ids = await runWithTenant("main", async () => (await t.models.Ticket.find({ station: "bar", status: "ready", servedAt: null }).lean()).map((r) => String(r._id)));
    while (ids.length < 3) {
      ids.push(await addReadyBar(new Date(t.clock.now().getTime() - 1000 * (5 - ids.length))));
    }
    t.clock.advance(4000);
    const emit = vi.spyOn(t.app.realtime, "emit");
    const first = await call("bar", "POST", "/api/kds/bar/recall");
    expect(first.statusCode).toBe(200);
    t.clock.advance(1000);
    const second = await call("bar", "POST", "/api/kds/bar/recall");
    expect(second.statusCode).toBe(200);
    expect(second.json().ticket.id).toBe(first.json().ticket.id);
    expect(emit).toHaveBeenCalledTimes(1);
    const started = () => runWithTenant("main", () => t.models.Ticket.countDocuments({ _id: { $in: ids }, status: "started" }));
    const startedBefore = await started();
    t.clock.advance(4000);
    const third = await call("bar", "POST", "/api/kds/bar/recall");
    expect(third.statusCode).toBe(200);
    expect(third.json().ticket.id).not.toBe(first.json().ticket.id);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(await started()).toBe(startedBefore + 1);
    emit.mockRestore();
  });

  it("hold and unhold round trip; invalid transitions and served tickets give 409", async () => {
    const target = await find({ station: "kitchen", status: "started" });
    const id = String(target._id);
    expect((await call("kitchen", "POST", `/api/tickets/${id}/unhold`)).statusCode).toBe(409);
    const held = await call("kitchen", "POST", `/api/tickets/${id}/hold`);
    expect(held.json().ticket.status).toBe("held");
    expect((await tickets("kitchen", "held")).json().tickets.map((x: { id: string }) => x.id)).toContain(id);
    expect((await tickets("kitchen")).json().tickets.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await call("kitchen", "POST", `/api/tickets/${id}/hold`)).statusCode).toBe(409);
    expect((await call("kitchen", "POST", `/api/tickets/${id}/bump`)).statusCode).toBe(409);
    expect((await call("kitchen", "POST", `/api/tickets/${id}/unhold`)).json().ticket.status).toBe("started");
    const served = await find({ station: "kitchen", status: "ready", servedAt: { $ne: null } });
    for (const a of ["hold", "unhold", "start"]) expect((await call("kitchen", "POST", `/api/tickets/${served._id}/${a}`)).statusCode).toBe(409);
    expect((await call("kitchen", "POST", `/api/tickets/${served._id}/items/0/toggle`)).statusCode).toBe(409);
  });

  it("a ticket of the other station, a malformed id and a bad item index all give 404; waiters get 403", async () => {
    const kitchenTicket = await find({ station: "kitchen", status: "started" });
    const before = JSON.stringify(kitchenTicket);
    for (const a of ["start", "hold", "unhold", "bump", "items/0/toggle"]) {
      expect((await call("bar", "POST", `/api/tickets/${kitchenTicket._id}/${a}`)).statusCode).toBe(404);
    }
    expect(JSON.stringify(await find({ _id: kitchenTicket._id }))).toBe(before);
    expect((await call("manager", "POST", `/api/tickets/${kitchenTicket._id}/items/99/toggle`)).statusCode).toBe(404);
    expect((await call("manager", "POST", `/api/tickets/${kitchenTicket._id}/items/x/toggle`)).statusCode).toBe(404);
    expect((await call("kitchen", "POST", "/api/tickets/not-an-id/bump")).statusCode).toBe(404);
    expect((await call("kitchen", "POST", "/api/tickets/000000000000000000000000/bump")).statusCode).toBe(404);
    expect((await call("waiter", "POST", `/api/tickets/${kitchenTicket._id}/bump`)).statusCode).toBe(403);
  });
});
