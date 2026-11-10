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
  it("T9: A's manager session gets 404 on B's ticket ids (every KDS action); B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    expect(before.tickets.length).toBeGreaterThan(0);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    for (const tk of before.tickets) {
      for (const action of ["start", "hold", "unhold", "bump", "items/0/toggle"]) {
        const res = await t.inject({ method: "POST", url: `/api/tickets/${String(tk._id)}/${action}`, cookies });
        expect(res.statusCode).toBe(404);
      }
    }
    for (const station of ["kitchen", "bar"]) {
      const res = await t.inject({ method: "GET", url: `/api/kds/${station}?tab=done`, cookies });
      expect(res.statusCode).toBe(200);
      for (const tk of before.tickets) expect(JSON.stringify(res.json())).not.toContain(String(tk._id));
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
  it("T10: A's session gets 404 on B's check, table, ticket and call ids (GET and POST); B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    expect(before.checks.length).toBeGreaterThan(0);
    expect(before.calls.length).toBeGreaterThan(0);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const req = (method: "GET" | "POST", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    const expect404 = async (method: "GET" | "POST", url: string, payload?: object) => {
      const res = await req(method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    };
    const item = String(before.items[0]!._id);
    for (const tb of before.tables) {
      const id = String(tb._id);
      await expect404("GET", `/api/tables/${id}/check`);
      await expect404("POST", `/api/tables/${id}/seat`, { covers: 2 });
      await expect404("POST", `/api/tables/${id}/orders`, { idempotencyKey: randomUUID(), items: [{ itemId: item, qty: 1, options: [] }] });
    }
    for (const c of before.checks) {
      await expect404("GET", `/api/checks/${String(c._id)}/print`);
      await expect404("POST", `/api/checks/${String(c._id)}/close`, { method: "card" });
    }
    for (const tk of before.tickets) await expect404("POST", `/api/tickets/${String(tk._id)}/served`);
    for (const c of before.calls) await expect404("POST", `/api/calls/${String(c._id)}/answer`);

    const floor = await req("GET", "/api/floor");
    expect(floor.statusCode).toBe(200);
    const text = JSON.stringify(floor.json());
    for (const tb of before.tables) expect(text).not.toContain(String(tb._id));
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
  it("T11: A's manager session gets 404 on B's menu item, category, availability, table and token ids; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    const cats = await runWithTenant(b.tenantId, () => t.models.Category.find({}).lean());
    const item = await runWithTenant(b.tenantId, () => t.models.MenuItem.findOne({}).lean().orFail());
    const table = await t7(b.tenantId);
    const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies: { lodos_sid: a.sid }, ...(payload ? { payload } : {}) });
    const iid = String(item._id);
    const tid = String(table._id);
    const cid = String(cats[0]!._id);
    const results = await Promise.all([
      call("PATCH", `/api/manager/items/${iid}`, { price: 1 }),
      call("DELETE", `/api/manager/items/${iid}`),
      t.inject({
        method: "POST",
        url: `/api/manager/items/${iid}/photo`,
        cookies: { lodos_sid: a.sid },
        headers: { "content-type": "multipart/form-data; boundary=zz" },
        payload: '--zz\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n\x1a\n0000000\r\n--zz--\r\n',
      }),
      call("POST", `/api/manager/availability/${iid}`, { soldOut: true }),
      call("PATCH", `/api/manager/categories/${cid}`, { sort: 5 }),
      call("DELETE", `/api/manager/categories/${cid}`),
      call("PATCH", `/api/manager/tables/${tid}`, { name: "T98" }),
      call("POST", `/api/manager/tables/${tid}/token`),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    // B's ids never leak through A's lists, and A cannot move an item into B's category.
    const menu = JSON.stringify((await call("GET", "/api/manager/menu")).json());
    expect(menu).not.toContain(iid);
    expect(JSON.stringify((await call("GET", "/api/manager/tables")).json())).not.toContain(table.token);
    const own = await runWithTenant(a.tenantId, () => t.models.Category.findOne({}).lean().orFail());
    const mine = await runWithTenant(a.tenantId, () => t.models.MenuItem.findOne({ categoryId: own._id }).lean().orFail());
    expect((await call("PATCH", `/api/manager/items/${String(mine._id)}`, { categoryId: cid })).statusCode).toBe(404);
    expect(await snapshot(b.tenantId)).toEqual(before);
  });
});
