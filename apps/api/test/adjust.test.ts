import { serviceDayOf } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/sessions";
import { billOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
const SELIN_PIN = "9999";
const DENIZ_PIN = "1111";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Req = (method: Method, path: string, payload?: object) => ReturnType<TestApp["inject"]>;

let ipSeq = 0;
async function session(s: Seeded, who: keyof Seeded["seed"]["staff"]): Promise<Req> {
  const kind = who === "kitchen" || who === "bar" ? "station" : "person";
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, kind, NOW);
  // A fresh IP per session so the per-IP PIN limit never couples tests.
  const remoteAddress = `10.66.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  return (method, path, payload) => t.inject({ method, url: path, cookies: { lodos_sid: sid }, remoteAddress, ...(payload ? { payload } : {}) });
}

const code = (res: { statusCode: number; json: () => { error?: { code: string } } }) => `${res.statusCode} ${res.json().error?.code ?? ""}`.trim();

/** A fresh tenant with T7 seated (by Deniz) and one order of `lines` (seeded items by English name prefix). */
async function setup(lines: { name: string; qty?: number }[]) {
  const s = await seedTenant(t);
  const w = await session(s, "waiter");
  const m = await session(s, "manager");
  const T7 = s.seed.tables.T7!.id;
  const seat = await w("POST", `/api/tables/${T7}/seat`, { covers: 2 });
  expect(seat.statusCode).toBe(201);
  const checkId = seat.json().checkId as string;
  const items: Record<string, Awaited<ReturnType<typeof itemNamed>>> = {};
  for (const l of lines) items[l.name] = await itemNamed(t, s.tenantId, l.name);
  // The live seed 86es some items; these tests set their own limits.
  await runWithTenant(s.tenantId, () => t.models.Availability.deleteMany({ itemId: { $in: Object.values(items).map((i) => i.id) } }));
  const placed = await w("POST", `/api/tables/${T7}/orders`, orderBody(lines.map((l) => ({ itemId: items[l.name]!.id, qty: l.qty ?? 1 }))));
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().orderId as string;
  const ref = (name: string) => `${orderId}:${lines.findIndex((l) => l.name === name)}`;
  const inTenant = <T>(fn: () => Promise<T>) => runWithTenant(s.tenantId, fn);
  const bill = () => inTenant(() => billOf(t.models, checkId));
  const line = async (name: string) => (await bill()).lines.find((l) => l.lineRef === ref(name))!;
  const adjust = (as: Req, body: { name: string; kind: "comp" | "void"; qty?: number; reason?: string; note?: string; approval?: { managerId: string; pin: string } }) =>
    as("POST", `/api/checks/${checkId}/adjustments`, {
      lineRef: ref(body.name),
      kind: body.kind,
      qty: body.qty ?? 1,
      reason: body.reason ?? (body.kind === "comp" ? "celebration" : "wrong_item"),
      ...(body.note ? { note: body.note } : {}),
      ...(body.approval ? { approval: body.approval } : {}),
    });
  const selin = { managerId: s.seed.staff.manager, pin: SELIN_PIN };
  const ticketOf = (station: "kitchen" | "bar") => inTenant(() => t.models.Ticket.findOne({ orderId, station }).lean().orFail());
  const adjustmentCount = () => inTenant(() => t.models.Adjustment.countDocuments({ checkId }));
  const check = () => inTenant(() => t.models.Check.findById(checkId).lean().orFail());
  const setRemaining = (name: string, remaining: number) =>
    inTenant(() =>
      t.models.Availability.updateOne(
        { serviceDay: serviceDayOf(NOW), itemId: items[name]!.id },
        { $set: { remaining, soldOut: remaining === 0 } },
        { upsert: true },
      ),
    );
  const remaining = async (name: string) =>
    (await inTenant(() => t.models.Availability.findOne({ serviceDay: serviceDayOf(NOW), itemId: items[name]!.id }).lean()))?.remaining ?? null;
  return { s, w, m, T7, checkId, orderId, items, ref, bill, line, adjust, selin, ticketOf, adjustmentCount, check, setRemaining, remaining };
}

const GELATO = "Olive oil gelato";
const FRIES = "Truffle fries";
const BURRATA = "Burrata";

describe("comps", () => {
  it("a waiter comps 1 of Gelato × 3 with Selin's approval", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    const price = c.items[GELATO]!.price;
    const res = await c.adjust(c.w, { name: GELATO, kind: "comp", approval: c.selin });
    expect(res.statusCode).toBe(201);
    expect(res.json().adjustment).toMatchObject({
      kind: "comp",
      qty: 1,
      reason: "celebration",
      amount: price,
      units: [`${c.ref(GELATO)}:2`],
      requestedByName: "Deniz",
      approvedByName: "Selin",
      approvedBy: c.s.seed.staff.manager,
      tableName: "T7",
      reversedAt: null,
    });
    const line = await c.line(GELATO);
    expect(line).toMatchObject({ lineTotal: 2 * price, compedQty: 1, voidedQty: 0 });
    const stored = await runWithTenant(c.s.tenantId, () => t.models.Adjustment.findOne({ checkId: c.checkId }).lean().orFail());
    expect(stored).toMatchObject({ serviceDay: serviceDayOf(NOW), itemName: { en: expect.stringMatching(/^Olive oil gelato/) }, station: "kitchen" });
    expect((await c.check()).splitVersion).toBe(1);
  });

  it("a waiter without approval → 403 approval_required; with his own PIN → 403 not_a_manager", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    expect(code(await c.adjust(c.w, { name: GELATO, kind: "comp" }))).toBe("403 approval_required");
    expect(code(await c.adjust(c.w, { name: GELATO, kind: "comp", approval: { managerId: c.s.seed.staff.waiter, pin: DENIZ_PIN } }))).toBe("403 not_a_manager");
    expect(code(await c.adjust(c.w, { name: GELATO, kind: "comp", approval: { managerId: c.s.seed.staff.manager, pin: "0000" } }))).toBe("401 unauthorized");
    expect(await c.adjustmentCount()).toBe(0);
  });

  it("a manager requester needs no approval and approves herself", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    const res = await c.adjust(c.m, { name: GELATO, kind: "comp" });
    expect(res.statusCode).toBe(201);
    expect(res.json().adjustment).toMatchObject({ approvedBy: c.s.seed.staff.manager, approvedByName: "Selin", requestedByName: "Selin" });
  });

  it("an invalid reason or a missing note for other → 400", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "comp", reason: "wrong_item" }))).toBe("400 validation");
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "comp", reason: "other" }))).toBe("400 validation");
    const ok = await c.adjust(c.m, { name: GELATO, kind: "comp", reason: "other", note: "Dropped the spoon" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().adjustment.note).toBe("Dropped the spoon");
  });

  it("too many units: comp 3 when only 2 are free → 409 conflict; an unknown line → 409 conflict", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    expect((await c.adjust(c.m, { name: GELATO, kind: "comp" })).statusCode).toBe(201);
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "comp", qty: 3 }))).toBe("409 conflict");
    const bogus = await c.m("POST", `/api/checks/${c.checkId}/adjustments`, { lineRef: `${c.orderId}:7`, kind: "comp", qty: 1, reason: "regular" });
    expect(code(bogus)).toBe("409 conflict");
    const two = await c.adjust(c.m, { name: GELATO, kind: "comp", qty: 2 });
    expect(two.statusCode).toBe(201);
    expect(two.json().adjustment.units).toEqual([`${c.ref(GELATO)}:1`, `${c.ref(GELATO)}:0`]);
    expect((await c.line(GELATO)).lineTotal).toBe(0);
  });
});

describe("voids", () => {
  it("before ready: the KDS line shows voidedQty, the all-day tally drops, and a 3-left portion comes back", async () => {
    const c = await setup([{ name: GELATO, qty: 3 }]);
    const kitchen = await session(c.s, "kitchen");
    await c.setRemaining(GELATO, 3);
    const kds = async () => (await kitchen("GET", "/api/kds/kitchen")).json();
    const gelatoTally = (v: { allDay: { itemName: { en: string }; qty: number }[] }) => v.allDay.find((x) => x.itemName.en.startsWith(GELATO))?.qty ?? 0;
    const before = await kds();
    expect(gelatoTally(before)).toBe(3);

    const res = await c.adjust(c.w, { name: GELATO, kind: "void", approval: c.selin });
    expect(res.statusCode).toBe(201);
    expect(res.json().adjustment).toMatchObject({ kind: "void", qty: 1, reason: "wrong_item", amount: c.items[GELATO]!.price });

    const after = await kds();
    const ticket = await c.ticketOf("kitchen");
    const shown = after.tickets.find((x: { id: string }) => x.id === String(ticket._id));
    expect(shown.items[0]).toMatchObject({ qty: 3, voidedQty: 1 });
    expect(gelatoTally(after)).toBe(2);
    expect(await c.remaining(GELATO)).toBe(4);
    expect((await c.line(GELATO))).toMatchObject({ voidedQty: 1, lineTotal: 2 * c.items[GELATO]!.price, units: expect.any(Array) });
    expect((await c.line(GELATO)).units).toHaveLength(2);
    expect(ticket.voidedAt).toBeNull();
  });

  it("an item with no limit gives nothing back; a sold-out flag clears when a portion returns", async () => {
    const c = await setup([{ name: GELATO, qty: 1 }, { name: FRIES, qty: 1 }]);
    await c.setRemaining(FRIES, 0);
    expect((await c.adjust(c.m, { name: GELATO, kind: "void" })).statusCode).toBe(201);
    expect(await c.remaining(GELATO)).toBeNull();
    expect((await c.adjust(c.m, { name: FRIES, kind: "void" })).statusCode).toBe(201);
    const avail = await runWithTenant(c.s.tenantId, () => t.models.Availability.findOne({ itemId: c.items[FRIES]!.id }).lean().orFail());
    expect(avail).toMatchObject({ remaining: 1, soldOut: false });
  });

  it("voiding every line of a single-item ticket makes it leave the KDS active list", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    const kitchen = await session(c.s, "kitchen");
    const ticketId = String((await c.ticketOf("kitchen"))._id);
    const ids = async (tab = "active") => ((await kitchen("GET", `/api/kds/kitchen?tab=${tab}`)).json().tickets as { id: string }[]).map((x) => x.id);
    expect(await ids()).toContain(ticketId);
    expect((await c.adjust(c.m, { name: GELATO, kind: "void", qty: 2 })).statusCode).toBe(201);
    expect(await ids()).not.toContain(ticketId);
    expect((await c.ticketOf("kitchen")).voidedAt).toEqual(NOW);
    expect((await c.bill()).total).toBe(0);
  });

  it("after ready (or served) → 409 void_after_ready, 'Already made: comp it instead'", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    const ticketId = String((await c.ticketOf("kitchen"))._id);
    expect((await c.m("POST", `/api/tickets/${ticketId}/bump`)).statusCode).toBe(200);
    const res = await c.adjust(c.m, { name: GELATO, kind: "void" });
    expect(code(res)).toBe("409 void_after_ready");
    expect(res.json().error.message).toBe("Already made: comp it instead");
    expect(await c.adjustmentCount()).toBe(0);
    // A comp is still allowed.
    expect((await c.adjust(c.m, { name: GELATO, kind: "comp" })).statusCode).toBe(201);
  });
});

describe("undo", () => {
  it("reversing a void as Selin restores the bill, the ticket line and the portion; again → changed: false", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    const kitchen = await session(c.s, "kitchen");
    await c.setRemaining(GELATO, 3);
    const total = (await c.bill()).total;
    const ticketId = String((await c.ticketOf("kitchen"))._id);
    const v = await c.adjust(c.w, { name: GELATO, kind: "void", qty: 2, approval: c.selin });
    expect(v.statusCode).toBe(201);
    const adjId = v.json().adjustment.id as string;
    expect(await c.remaining(GELATO)).toBe(5);
    expect((await c.ticketOf("kitchen")).voidedAt).toEqual(NOW);

    expect(code(await c.w("DELETE", `/api/checks/${c.checkId}/adjustments/${adjId}`))).toBe("403 forbidden");
    const undo = await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${adjId}`);
    expect(undo.statusCode).toBe(200);
    expect(undo.json()).toMatchObject({ changed: true, adjustment: { id: adjId, reversedAt: NOW.toISOString() } });
    expect((await c.bill()).total).toBe(total);
    const ticket = await c.ticketOf("kitchen");
    expect(ticket.voidedAt).toBeNull();
    expect(ticket.items[0]!.voidedQty).toBe(0);
    expect(await c.remaining(GELATO)).toBe(3);
    const stored = await runWithTenant(c.s.tenantId, () => t.models.Adjustment.findById(adjId).lean().orFail());
    expect(stored).toMatchObject({ reversedAt: NOW });
    expect(String(stored.reversedBy)).toBe(c.s.seed.staff.manager);
    const ids = ((await kitchen("GET", "/api/kds/kitchen")).json().tickets as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(ticketId);

    const again = await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${adjId}`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ changed: false });
  });

  it("taking a portion back is floored at 0 and never errors for sold out", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    await c.setRemaining(GELATO, 3);
    const v = await c.adjust(c.m, { name: GELATO, kind: "void", qty: 2 });
    await c.setRemaining(GELATO, 1);
    const undo = await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${v.json().adjustment.id}`);
    expect(undo.statusCode).toBe(200);
    expect(await c.remaining(GELATO)).toBe(0);
  });

  it("reversing a comp restores the line; an unknown adjustment id → 404", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    const comp = await c.adjust(c.m, { name: GELATO, kind: "comp" });
    expect((await c.line(GELATO)).compedQty).toBe(1);
    expect((await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${comp.json().adjustment.id}`)).statusCode).toBe(200);
    expect((await c.line(GELATO)).compedQty).toBe(0);
    expect((await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/0123456789abcdef01234567`)).statusCode).toBe(404);
    expect((await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/nope`)).statusCode).toBe(404);
  });
});

describe("split locks", () => {
  it("Evenly with one share paid → comp → 409 split_locked (and undo too)", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }, { name: FRIES }]);
    const comp = await c.adjust(c.m, { name: FRIES, kind: "comp" });
    expect(comp.statusCode).toBe(201);
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "even", count: 2 })).statusCode).toBe(200);
    const amount = (await c.w("GET", `/api/checks/${c.checkId}/split`)).json().shares[0].amount;
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "card", amount })).statusCode).toBe(200);
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "comp" }))).toBe("409 split_locked");
    expect(code(await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${comp.json().adjustment.id}`))).toBe("409 split_locked");
    expect(await c.adjustmentCount()).toBe(1);
  });

  it("By item: the gelato unit in paid share A can't be comped (409 conflict); an unassigned unit can (201)", async () => {
    const c = await setup([{ name: GELATO }, { name: FRIES }]);
    const gelatoUnit = `${c.ref(GELATO)}:0`;
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "items", count: 2, assignments: [{ unit: gelatoUnit, labels: ["A"] }] })).statusCode).toBe(200);
    expect((await c.w("POST", `/api/checks/${c.checkId}/shares/A/pay`, { method: "cash", amount: c.items[GELATO]!.price })).statusCode).toBe(200);
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "comp" }))).toBe("409 conflict");
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "void" }))).toBe("409 conflict");
    expect((await c.adjust(c.m, { name: FRIES, kind: "comp" })).statusCode).toBe(201);
    expect((await c.check()).status).toBe("open");
  });

  it("By item: a voided unit leaves the assignments; voiding the last unassigned unit after every share is paid closes the check", async () => {
    const c = await setup([{ name: GELATO }, { name: FRIES }, { name: BURRATA }]);
    const unit = (n: string) => `${c.ref(n)}:0`;
    const put = await c.w("PUT", `/api/checks/${c.checkId}/split`, {
      mode: "items",
      count: 2,
      assignments: [
        { unit: unit(GELATO), labels: ["A"] },
        { unit: unit(FRIES), labels: ["B"] },
        { unit: unit(BURRATA), labels: ["B"] },
      ],
    });
    expect(put.statusCode).toBe(200);
    expect((await c.adjust(c.m, { name: BURRATA, kind: "void", reason: "changed_mind" })).statusCode).toBe(201);
    expect((await c.check()).split!.assignments.map((a) => a.unit)).toEqual([unit(GELATO), unit(FRIES)]);

    // Unassign the fries, pay both shares, then void the fries: nothing is left, so the check closes.
    expect((await c.w("PUT", `/api/checks/${c.checkId}/split`, { mode: "items", count: 2, assignments: [{ unit: unit(GELATO), labels: ["A", "B"] }] })).statusCode).toBe(200);
    const shares = (await c.w("GET", `/api/checks/${c.checkId}/split`)).json().shares as { label: string; amount: number }[];
    for (const sh of shares) expect((await c.w("POST", `/api/checks/${c.checkId}/shares/${sh.label}/pay`, { method: "card", amount: sh.amount })).statusCode).toBe(200);
    expect((await c.check()).status).toBe("open");
    expect((await c.adjust(c.m, { name: FRIES, kind: "void" })).statusCode).toBe(201);
    const closed = await c.check();
    expect(closed.status).toBe("paid");
    expect(closed.closedAt).toEqual(NOW);
  });
});

describe("Review Focus 2", () => {
  it("adjusting a paid check is rejected and writes nothing", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    await c.setRemaining(GELATO, 3);
    expect((await c.w("POST", `/api/checks/${c.checkId}/close`, { method: "card" })).statusCode).toBe(200);
    const before = { count: await c.adjustmentCount(), remaining: await c.remaining(GELATO), ticket: await c.ticketOf("kitchen") };
    expect(code(await c.adjust(c.w, { name: GELATO, kind: "comp", approval: c.selin }))).toBe("409 check_closed");
    expect(code(await c.adjust(c.m, { name: GELATO, kind: "void" }))).toBe("409 check_closed");
    expect(await c.adjustmentCount()).toBe(before.count);
    expect(await c.remaining(GELATO)).toBe(before.remaining);
    expect(await c.ticketOf("kitchen")).toEqual(before.ticket);
  });

  it("a void racing a full close: either the void lands first and is not charged, or it is rejected and writes nothing", async () => {
    for (let i = 0; i < 3; i++) {
      const c = await setup([{ name: GELATO, qty: 2 }]);
      await c.setRemaining(GELATO, 3);
      const full = (await c.bill()).total;
      const [close, adj] = await Promise.all([
        c.w("POST", `/api/checks/${c.checkId}/close`, { method: "card" }),
        c.adjust(c.m, { name: GELATO, kind: "void" }),
      ]);
      expect(close.statusCode).toBe(200);
      const paid = (await c.check()).payment!.amount;
      if (adj.statusCode === 201) {
        expect(paid).toBe(full - c.items[GELATO]!.price);
        expect(await c.remaining(GELATO)).toBe(4);
      } else {
        expect(code(adj)).toBe("409 check_closed");
        expect(paid).toBe(full);
        expect(await c.adjustmentCount()).toBe(0);
        expect(await c.remaining(GELATO)).toBe(3);
      }
    }
  }, 30_000);
});

describe("approvers", () => {
  it("GET /api/approvers lists the active managers for a waiter", async () => {
    const c = await setup([{ name: GELATO }]);
    const res = await c.w("GET", "/api/approvers");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: c.s.seed.staff.manager, name: "Selin" }]);
  });
});

describe("events", () => {
  it("a void emits adjustment.changed, ticket.updated to the station and availability.changed to all; a rejected one emits nothing", async () => {
    const c = await setup([{ name: GELATO, qty: 2 }]);
    await c.setRemaining(GELATO, 3);
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      const v = await c.adjust(c.m, { name: GELATO, kind: "void" });
      expect(v.statusCode).toBe(201);
      const ticketId = String((await c.ticketOf("kitchen"))._id);
      expect(emit.mock.calls.map((call) => [call[1], call[2], call[3]])).toEqual([
        ["adjustment.changed", { ids: [v.json().adjustment.id], tableId: c.T7 }, ["floor", "manager", "table", "kitchen"]],
        ["ticket.updated", { ids: [ticketId], tableId: c.T7 }, ["kitchen"]],
        ["availability.changed", { ids: [c.items[GELATO]!.id] }, ["all"]],
      ]);
      emit.mockClear();
      expect((await c.adjust(c.w, { name: GELATO, kind: "comp" })).statusCode).toBe(403);
      expect(emit).not.toHaveBeenCalled();
      expect((await c.m("DELETE", `/api/checks/${c.checkId}/adjustments/${v.json().adjustment.id}`)).statusCode).toBe(200);
      expect(emit.mock.calls.map((call) => call[1])).toEqual(["adjustment.changed", "ticket.updated", "availability.changed"]);
    } finally {
      emit.mockRestore();
    }
  });
});
