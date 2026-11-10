import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { makeTestApp, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Chip = { kind: string; tableId: string; tableName: string; since: string };
type TableView = { id: string; name: string; state: string; covers: number | null; checkId: string | null; sectionStaffId: string | null; serverInitials: string | null };

async function staff(s: Seeded, who: keyof Seeded["seed"]["staff"] = "waiter") {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
  return (method: "GET" | "POST", url: string, payload?: object) =>
    t.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}

const floor = async (s: Seeded) => {
  const res = await (await staff(s))("GET", "/api/floor");
  expect(res.statusCode).toBe(200);
  return res.json() as { rooms: { id: string; name: string }[]; tables: TableView[]; chips: Chip[]; stats: Record<string, number> };
};
const tableNamed = (f: { tables: TableView[] }, name: string) => f.tables.find((x) => x.name === name)!;

describe("GET /api/floor", () => {
  it("the seeded floor: one calling table, one bill, one ready; T7 free; rooms, sections and stats", async () => {
    const s = await seedTenant(t);
    const f = await floor(s);
    const byState = (st: string) => f.tables.filter((x) => x.state === st).map((x) => x.name);
    expect(byState("calling")).toEqual(["T2"]);
    expect(byState("ready")).toEqual(["B2"]);
    expect(byState("bill")).toEqual(["B4"]);
    expect(tableNamed(f, "T7")).toMatchObject({ state: "free", covers: null, checkId: null, sectionStaffId: s.seed.staff.waiter, serverInitials: "D" });
    expect(tableNamed(f, "B1")).toMatchObject({ state: "seated", covers: 4 });
    expect(f.rooms.map((r) => r.name)).toEqual(["Salon", "Bar", "Terrace"]);
    expect(f.stats).toMatchObject({ seated: 7, totalTables: f.tables.length, covers: 4 + 2 + 3 + 2 + 2 + 2 + 2, avgTurnMs: 0 });
    expect(f.stats.openChecksTotal).toBeGreaterThan(0);
  });

  it("chips are ordered calling → ready → bill, oldest first within a kind", async () => {
    const s = await seedTenant(t);
    // A second, older call at B1 sorts before T2's.
    await runWithTenant(s.tenantId, () => t.models.Call.create({ tableId: s.seed.tables.B1!.id, reason: "other", openedAt: new Date(NOW.getTime() - 5 * 60_000) }));
    const f = await floor(s);
    expect(f.chips.map((c) => `${c.kind}:${c.tableName}`)).toEqual(["calling:B1", "calling:T2", "ready:B2", "bill:B4"]);
    expect(f.chips[0]!.since).toBe(new Date(NOW.getTime() - 5 * 60_000).toISOString());
    expect(f.chips[0]!.tableId).toBe(s.seed.tables.B1!.id);
  });

  it("answering the call turns T2 seated (double tap: 200, one event)", async () => {
    const s = await seedTenant(t);
    const call = await runWithTenant(s.tenantId, () => t.models.Call.findOne({ tableId: s.seed.tables.T2!.id }).lean().orFail());
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      const w = await staff(s);
      const [a, b] = await Promise.all([w("POST", `/api/calls/${String(call._id)}/answer`), w("POST", `/api/calls/${String(call._id)}/answer`)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(emit.mock.calls.filter((c) => c[1] === "call.answered")).toHaveLength(1);
    } finally {
      emit.mockRestore();
    }
    const after = await runWithTenant(s.tenantId, () => t.models.Call.findById(call._id).lean().orFail());
    expect(after.answeredBy && String(after.answeredBy)).toBe(s.seed.staff.waiter);
    expect(after.answeredAt).toEqual(NOW);
    const f = await floor(s);
    expect(tableNamed(f, "T2").state).toBe("seated");
    expect(f.chips.some((c) => c.kind === "calling")).toBe(false);
  });

  it("marking the ready ticket served removes the ready chip; only ready tickets can be served", async () => {
    const s = await seedTenant(t);
    const ready = await runWithTenant(s.tenantId, () => t.models.Ticket.findOne({ tableId: s.seed.tables.B2!.id, status: "ready", servedAt: null }).lean().orFail());
    const notReady = await runWithTenant(s.tenantId, () => t.models.Ticket.findOne({ status: "new" }).lean().orFail());
    const w = await staff(s);
    const emit = vi.spyOn(t.app.realtime, "emit");
    try {
      const [a, b] = await Promise.all([w("POST", `/api/tickets/${String(ready._id)}/served`), w("POST", `/api/tickets/${String(ready._id)}/served`)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect(a.json().ticket.servedAt).toBe(NOW.toISOString());
      expect(emit.mock.calls.filter((c) => c[1] === "ticket.updated")).toHaveLength(1);
    } finally {
      emit.mockRestore();
    }
    const res = await w("POST", `/api/tickets/${String(notReady._id)}/served`);
    expect(res.statusCode).toBe(409);
    const f = await floor(s);
    expect(f.chips.some((c) => c.kind === "ready")).toBe(false);
    expect(tableNamed(f, "B2").state).toBe("seated");
  });

  it("malformed and unknown ids → 404; kitchen accounts cannot use the floor", async () => {
    const s = await seedTenant(t);
    const w = await staff(s);
    for (const url of ["/api/tickets/nope/served", "/api/calls/nope/answer", "/api/tickets/aaaaaaaaaaaaaaaaaaaaaaaa/served", "/api/calls/aaaaaaaaaaaaaaaaaaaaaaaa/answer"]) {
      expect((await w("POST", url)).statusCode).toBe(404);
    }
    expect((await (await staff(s, "kitchen"))("GET", "/api/floor")).statusCode).toBe(403);
    expect((await (await staff(s, "manager"))("GET", "/api/floor")).statusCode).toBe(200);
  });
});
