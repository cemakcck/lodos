import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { makeTestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

type T = Awaited<ReturnType<typeof makeTestApp>>;
type Visitor = { sb: string; sid: string; tenantId: string };
const cookie = (res: { cookies: { name: string; value: string }[] }, name: string) =>
  res.cookies.find((c) => c.name === name)!.value;

let t: T;
let a: Visitor;
let b: Visitor;

async function visitor(role: string): Promise<Visitor> {
  const res = await t.inject({
    method: "POST",
    url: "/api/demo/session",
    payload: { role },
  });
  const sb = cookie(res, "lodos_sb");
  const val = decodeURIComponent(sb);
  return {
    sb,
    sid: cookie(res, "lodos_sid"),
    tenantId: val.slice(0, val.lastIndexOf(".")).replace(/^s:/, ""),
  };
}

const snapshot = (tenantId: string) =>
  runWithTenant(tenantId, async () => ({
    staff: await t.models.Staff.find({}).sort({ _id: 1 }).lean(),
    tables: await t.models.Table.find({}).sort({ _id: 1 }).lean(),
    tickets: await t.models.Ticket.find({}).sort({ _id: 1 }).lean(),
    checks: await t.models.Check.find({}).sort({ _id: 1 }).lean(),
    items: await t.models.MenuItem.find({}).sort({ _id: 1 }).lean(),
    orders: await t.models.Order.find({}).sort({ _id: 1 }).lean(),
    calls: await t.models.Call.find({}).sort({ _id: 1 }).lean(),
    availability: await t.models.Availability.find({}).sort({ _id: 1 }).lean(),
  }));

const t7 = (tenantId: string) => runWithTenant(tenantId, () => t.models.Table.findOne({ name: "T7" }).lean().orFail());

beforeAll(async () => {
  t = await makeTestApp({ now: NOW, demoMode: true, sandboxesPerIpHour: 1000 });
  a = await visitor("manager");
  b = await visitor("manager");
});
afterAll(() => t.close());

describe("cross-sandbox access through the HTTP surface", () => {
  it("A's session with B's sandbox cookie resolves A's own staff, never B's", async () => {
    const res = await t.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { lodos_sid: a.sid, lodos_sb: b.sb },
    });
    expect(res.statusCode).toBe(200);
    const sidStaff = await runWithTenant(a.tenantId, () => t.models.Staff.findOne({ role: "manager" }).lean());
    expect(res.json().staff.id).toBe(String(sidStaff!._id));
  });

  it("B's sandbox cookie lists only B's staff, and A's staff ids cannot log in there", async () => {
    const list = await t.inject({
      method: "GET",
      url: "/api/auth/staff",
      cookies: { lodos_sb: b.sb },
    });
    const aStaff = await runWithTenant(a.tenantId, () => t.models.Staff.find({}).lean());
    const bIds = (list.json() as { id: string }[]).map((s) => s.id);
    for (const s of aStaff) expect(bIds).not.toContain(String(s._id));
    const login = await t.inject({
      method: "POST",
      url: "/api/auth/pin",
      cookies: { lodos_sb: b.sb },
      payload: { staffId: String(aStaff[0]!._id), pin: "1111" },
    });
    expect(login.statusCode).toBe(401);
  });

  it("stub routes under A's session never touch B's data", async () => {
    const before = await snapshot(b.tenantId);
    for (const url of ["/api/floor", "/api/kds/kitchen"]) {
      const res = await t.inject({
        method: "GET",
        url,
        cookies: { lodos_sid: a.sid, lodos_sb: b.sb },
      });
      expect(JSON.stringify(res.json())).not.toContain(b.tenantId);
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

  it("a forged sandbox cookie yields no access", async () => {
    const res = await t.inject({
      method: "GET",
      url: "/api/auth/staff",
      cookies: { lodos_sb: b.tenantId },
    });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * EXTEND HERE (Tasks 7, 9, 10, 11): as each task adds routes, add cases that use A's cookies against B's
 * ticket, check, table and menu-item ids and assert 404 plus an unchanged `snapshot(b.tenantId)`
 * (T7: A's guest token cannot read B's menu; T9/T10: floor and KDS ids; T11: manager menu ids).
 */
describe("cross-sandbox ids on domain routes (extended by Tasks 7, 9, 10, 11)", () => {
  it("T7: A's guest token cannot read B's menu or order on B's table", async () => {
    const before = await snapshot(b.tenantId);
    const aT7 = await t7(a.tenantId);
    const bT7 = await t7(b.tenantId);
    const headers = { "x-table-token": aT7.token };
    const bItemIds = before.items.map((i) => String(i._id));

    const menu = await t.inject({ method: "GET", url: "/api/guest/menu", headers });
    expect(menu.statusCode).toBe(200);
    const menuIds = (menu.json().items as { id: string }[]).map((i) => i.id);
    for (const id of bItemIds) expect(menuIds).not.toContain(id);

    const table = await t.inject({ method: "GET", url: "/api/guest/table", headers });
    expect(table.json().table.id).toBe(String(aT7._id));

    // Ordering B's items with A's token: they do not exist in A's tenant.
    const order = await t.inject({
      method: "POST",
      url: "/api/guest/orders",
      headers,
      payload: { idempotencyKey: randomUUID(), items: [{ itemId: bItemIds[0], qty: 1, options: [] }] },
    });
    expect(order.statusCode).toBe(409);
    expect(order.json().error.code).toBe("item_unavailable");

    // A sandbox cookie for B changes nothing: the token alone decides the table.
    for (const url of ["/api/guest/orders", "/api/guest/calls", "/api/guest/bill"]) {
      await t.inject({ method: "POST", url, headers, cookies: { lodos_sb: b.sb }, payload: { reason: "wine", method: "card" } });
    }
    const orders = await t.inject({ method: "GET", url: "/api/guest/orders", headers, cookies: { lodos_sb: b.sb } });
    expect(JSON.stringify(orders.json())).not.toContain(String(bT7._id));
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
  it.todo("T9/T10: A's session gets 404 on B's ticket, check and table ids (GET and POST); B unchanged");
  it.todo("T11: A's manager session gets 404 on B's menu item ids (GET, PATCH, DELETE); B unchanged");
});
