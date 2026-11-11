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
    adjustments: await t.models.Adjustment.find({}).sort({ _id: 1 }).lean(),
    shifts: await t.models.Shift.find({}).sort({ _id: 1 }).lean(),
    shiftTemplates: await t.models.ShiftTemplate.find({}).sort({ _id: 1 }).lean(),
    rooms: await t.models.Room.find({}).sort({ _id: 1 }).lean(),
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
    const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    const expect404 = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) => {
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
      await expect404("GET", `/api/checks/${String(c._id)}/receipt`);
      await expect404("POST", `/api/checks/${String(c._id)}/close`, { method: "card" });
      await expect404("GET", `/api/checks/${String(c._id)}/split`);
      await expect404("PUT", `/api/checks/${String(c._id)}/split`, { mode: "even", count: 2 });
      await expect404("POST", `/api/checks/${String(c._id)}/shares/A/pay`, { method: "card", amount: 0 });
      const order = before.orders.find((o) => String(o.checkId) === String(c._id));
      if (order) {
        await expect404("POST", `/api/checks/${String(c._id)}/adjustments`, { lineRef: `${String(order._id)}:0`, kind: "void", qty: 1, reason: "other", note: "x" });
      }
      await expect404("DELETE", `/api/checks/${String(c._id)}/adjustments/${String(c._id)}`);
    }
    for (const tk of before.tickets) await expect404("POST", `/api/tickets/${String(tk._id)}/served`);
    for (const c of before.calls) await expect404("POST", `/api/calls/${String(c._id)}/answer`);

    const approvers = await req("GET", "/api/approvers");
    expect(approvers.statusCode).toBe(200);
    for (const st of before.staff) expect(JSON.stringify(approvers.json())).not.toContain(String(st._id));

    const floor = await req("GET", "/api/floor");
    expect(floor.statusCode).toBe(200);
    const text = JSON.stringify(floor.json());
    for (const tb of before.tables) expect(text).not.toContain(String(tb._id));
    expect(await snapshot(b.tenantId)).toEqual(before);
  }, 20_000);
  it("Phase 2 Task 6: A's manager cannot reverse or add to B's adjustments (404); B unchanged", async () => {
    const bCheck = (await snapshot(b.tenantId)).checks.find((c) => c.status === "open")!;
    const bOrder = (await snapshot(b.tenantId)).orders.find((o) => String(o.checkId) === String(bCheck._id))!;
    const bReq = (method: "POST" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies: { lodos_sid: b.sid }, ...(payload ? { payload } : {}) });
    const made = await bReq("POST", `/api/checks/${String(bCheck._id)}/adjustments`, { lineRef: `${String(bOrder._id)}:0`, kind: "comp", qty: 1, reason: "regular" });
    expect(made.statusCode).toBe(201);
    const adjId = made.json().adjustment.id as string;
    const before = await snapshot(b.tenantId);
    const aCheck = (await snapshot(a.tenantId)).checks[0]!;
    const cookieSets: Record<string, string>[] = [{ lodos_sid: a.sid }, { lodos_sid: a.sid, lodos_sb: b.sb }];
    for (const cookies of cookieSets) {
      for (const checkId of [String(bCheck._id), String(aCheck._id)]) {
        const res = await t.inject({ method: "DELETE", url: `/api/checks/${checkId}/adjustments/${adjId}`, cookies });
        expect(res.statusCode).toBe(404);
      }
    }
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

  it("Phase 2 Task 16: A's manager gets 404 on B's staff ids and never lists them; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    const aTable = String((await t7(a.tenantId))._id);
    const bTable = String((await t7(b.tenantId))._id);
    for (const st of before.staff) {
      const id = String(st._id);
      for (const [method, url, payload] of [
        ["PATCH", `/api/staff/${id}`, { name: "Hacked" }],
        ["PATCH", `/api/staff/${id}`, { tableIds: [aTable] }],
        ["POST", `/api/staff/${id}/pin`, { pin: "0000" }],
        ["POST", `/api/staff/${id}/deactivate`, undefined],
        ["POST", `/api/staff/${id}/reactivate`, undefined],
      ] as const) {
        const res = await call(method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    const list = await call("GET", "/api/staff");
    expect(list.statusCode).toBe(200);
    for (const st of before.staff) expect(list.body).not.toContain(String(st._id));
    // B's table ids are unknown to A's staff routes.
    expect((await call("POST", "/api/staff", { name: "Probe", role: "waiter", pin: "1234", tableIds: [bTable] })).statusCode).toBe(404);
    const aMert = await runWithTenant(a.tenantId, () => t.models.Staff.findOne({ name: "Mert" }).lean().orFail());
    expect((await call("PATCH", `/api/staff/${String(aMert._id)}`, { tableIds: [bTable] })).statusCode).toBe(404);
    expect(await snapshot(b.tenantId)).toEqual(before);
  }, 20_000);

  it("Phase 2 Task 18: A's manager gets 404 on B's shifts, templates and people, and never sees them; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    expect(before.shifts.length).toBeGreaterThan(0);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    for (const sh of before.shifts) {
      const id = String(sh._id);
      expect((await call("PATCH", `/api/shifts/${id}`, { note: "Hacked" })).statusCode).toBe(404);
      expect((await call("DELETE", `/api/shifts/${id}`)).statusCode).toBe(404);
    }
    for (const tpl of before.shiftTemplates) {
      const id = String(tpl._id);
      expect((await call("PATCH", `/api/shift-templates/${id}`, { name: "Hacked" })).statusCode).toBe(404);
      expect((await call("DELETE", `/api/shift-templates/${id}`)).statusCode).toBe(404);
    }
    // B's people can't be scheduled from A, nor can A's shifts be moved onto them.
    const bPerson = String(before.staff.find((s) => s.role === "cook")!._id);
    const shift = { serviceDay: "2026-11-10", start: "08:00", end: "10:00", area: "salon" };
    expect((await call("POST", "/api/shifts", { ...shift, staffId: bPerson })).statusCode).toBe(404);
    const aShift = await runWithTenant(a.tenantId, () => t.models.Shift.findOne({}).lean().orFail());
    expect((await call("PATCH", `/api/shifts/${String(aShift._id)}`, { staffId: bPerson })).statusCode).toBe(404);
    for (const url of ["/api/shifts", "/api/shifts?week=2026-11-16", "/api/shift-templates", "/api/me/shifts"]) {
      const res = await call("GET", url);
      expect(res.statusCode, url).toBe(200);
      for (const sh of before.shifts) expect(res.body).not.toContain(String(sh._id));
      for (const tpl of before.shiftTemplates) expect(res.body).not.toContain(String(tpl._id));
      for (const st of before.staff) expect(res.body).not.toContain(String(st._id));
    }
    // Copying last week works inside A only.
    expect((await call("POST", "/api/shifts/copy-last-week", { week: "2026-11-16" })).statusCode).toBe(200);
    expect(await snapshot(b.tenantId)).toEqual(before);
  }, 30_000);

  it("Phase 2 Task 21: A's manager gets 404 on B's rooms, and A's layout can't take B's tables or waiters; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    expect(before.rooms.length).toBeGreaterThan(0);
    for (const r of before.rooms) {
      const id = String(r._id);
      for (const [method, url, payload] of [
        ["GET", `/api/rooms/${id}/layout`, undefined],
        ["PUT", `/api/rooms/${id}/layout`, { version: r.version, tables: [] }],
        ["PATCH", `/api/rooms/${id}`, { name: "Hacked" }],
        ["DELETE", `/api/rooms/${id}`, undefined],
      ] as const) {
        expect((await call(method, url, payload)).statusCode, `${method} ${url}`).toBe(404);
      }
    }
    // A's own room: B's table ids are unknown, B's waiters are not waiters here.
    const aT7 = await t7(a.tenantId);
    const aRoom = String(aT7.roomId);
    const layout = (await call("GET", `/api/rooms/${aRoom}/layout`)).json() as {
      room: { version: number };
      tables: { id: string; openCheck: boolean; sectionStaffId: string | null }[];
    };
    // `openCheck` is read-only; the body schema strips it.
    const rows = layout.tables.map((x) => ({ ...x, key: x.id }));
    const bT7 = await t7(b.tenantId);
    const bWaiter = String(before.staff.find((s) => s.role === "waiter")!._id);
    const res = await call("PUT", `/api/rooms/${aRoom}/layout`, {
      version: layout.room.version,
      tables: [
        ...rows.map((x) => (x.id === String(aT7._id) ? { ...x, sectionStaffId: bWaiter } : x)),
        { id: String(bT7._id), key: "b", name: "T99", shape: "round", x: 700, y: 400, w: 64, h: 64, capacity: 2, sectionStaffId: null },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.problems).toEqual([
      { key: "b", code: "unknown" },
      { key: String(aT7._id), code: "waiter" },
    ]);
    for (const r of before.rooms) {
      expect((await call("GET", `/api/rooms/${aRoom}/layout`)).body).not.toContain(String(r._id));
    }
    expect((await call("POST", "/api/rooms", { name: "A only" })).statusCode).toBe(201);
    expect(await snapshot(b.tenantId)).toEqual(before);
  }, 20_000);

  it("Phase 2 Task 14: A's manager sees only A's sales and CSV rows; B unchanged", async () => {
    const marker = "only-in-sandbox-b";
    await runWithTenant(b.tenantId, () =>
      t.models.Adjustment.create({
        qty: 1, kind: "comp", reason: "celebration", note: marker, amount: 123, itemName: { en: "X", tr: "X" }, tableName: "T7",
        station: "kitchen", requestedByName: "Deniz", approvedByName: "Selin", at: NOW, serviceDay: "2026-11-10",
      }),
    );
    const before = await snapshot(b.tenantId);
    const bSummaries = await runWithTenant(b.tenantId, () => t.models.DailySummary.countDocuments({}));
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const view = await t.inject({ method: "GET", url: "/api/sales?range=today", cookies });
    expect(view.statusCode).toBe(200);
    expect(view.body).not.toContain(marker);
    const aChecks = await runWithTenant(a.tenantId, () => t.models.Check.find({ status: "paid" }).lean());
    expect(view.json().current.checks).toBe(aChecks.length);
    const csv = await t.inject({ method: "GET", url: "/api/sales/export.csv?range=30d", cookies });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.trim().split("\r\n")).toHaveLength(1 + aChecks.length);
    expect(await snapshot(b.tenantId)).toEqual(before);
    expect(await runWithTenant(b.tenantId, () => t.models.DailySummary.countDocuments({}))).toBe(bSummaries);
  });
});
