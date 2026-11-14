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
    ratings: await t.models.Rating.find({}).sort({ _id: 1 }).lean(),
    clockEntries: await t.models.ClockEntry.find({}).sort({ _id: 1 }).lean(),
    expenses: await t.models.Expense.find({}).sort({ _id: 1 }).lean(),
    expenseCategories: await t.models.ExpenseCategory.find({}).sort({ _id: 1 }).lean(),
  }));

async function pdfText(body: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join(" ");
}

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
  });
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
  });

  it("Phase 2 Task 18: A's manager gets 404 on B's shifts, templates and people, and never sees them; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    expect(before.shifts.length).toBeGreaterThan(0);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      t.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    // This week's and next week's shifts plus a few of the demo's past ones (all of them would be ~700 requests).
    const probed = [...before.shifts.filter((s) => s.serviceDay < "2026-11-09").slice(0, 5), ...before.shifts.filter((s) => s.serviceDay >= "2026-11-09")];
    for (const sh of probed) {
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
  });

  it("Phase 2 Task 19: the shift PDFs: A gets 404 for B's people and A's PDFs never show B's names; B unchanged", async () => {
    // Both sandboxes are copies of the same demo, so B's people and restaurant get names only B has.
    await runWithTenant(b.tenantId, async () => {
      const people = await t.models.Staff.find({}).sort({ _id: 1 }).lean();
      for (const [i, p] of people.entries()) await t.models.Staff.updateOne({ _id: p._id }, { $set: { name: `Bonly${i} Person` } });
      await t.models.Tenant.updateOne({}, { $set: { name: "Bonly Bistro" } });
    });
    const before = await snapshot(b.tenantId);
    expect(before.shifts.length).toBeGreaterThan(0);
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const get = (url: string) => t.inject({ method: "GET", url, cookies });
    const week = before.shifts[0]!.serviceDay;
    for (const st of before.staff) {
      expect((await get(`/api/shifts/pdf/person/${String(st._id)}?week=${week}`)).statusCode).toBe(404);
    }
    for (const url of [`/api/shifts/pdf/week?week=${week}`, `/api/shifts/pdf/people?week=${week}`, `/api/me/shifts/pdf?week=${week}`]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      const text = await pdfText(res.rawPayload);
      expect(text.length, url).toBeGreaterThan(0);
      expect(text, url).not.toContain("Bonly");
      if (!url.startsWith("/api/me")) expect(text, url).toContain("Deniz"); // A's own people are there
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

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
  });

  it("Phase 3 Task 2: A's token and manager cannot rate, read or moderate B's checks and ratings; B unchanged", async () => {
    const paid = async (v: Visitor) => {
      const check = await runWithTenant(v.tenantId, () => t.models.Check.findOne({ status: "paid" }).lean().orFail());
      const table = await runWithTenant(v.tenantId, () => t.models.Table.findOne({ _id: check.tableId }).lean().orFail());
      return { checkId: String(check._id), token: table.token };
    };
    const bPaid = await paid(b);
    const rated = await t.inject({ method: "POST", url: "/api/guest/ratings", headers: { "x-table-token": bPaid.token }, payload: { checkId: bPaid.checkId, food: 4, comment: "ok" } });
    expect(rated.statusCode, rated.body).toBe(201);
    const bRatingId = rated.json().id as string;
    const before = await snapshot(b.tenantId);
    expect(before.ratings.filter((r) => !r.generated)).toHaveLength(1); // besides the demo's seeded ratings

    const aPaid = await paid(a);
    const headers = { "x-table-token": aPaid.token };
    const card = await t.inject({ method: "GET", url: `/api/guest/rating?checkId=${bPaid.checkId}`, headers });
    expect(card.json().state).toBe("closed");
    const post = await t.inject({ method: "POST", url: "/api/guest/ratings", headers, payload: { checkId: bPaid.checkId, food: 1 } });
    expect(post.statusCode).toBe(409);
    expect(post.json().error.code).toBe("rating_closed");

    // A's manager session alone: B's rating id is not found.
    for (const action of ["hide", "unhide"]) {
      expect((await t.inject({ method: "POST", url: `/api/ratings/${bRatingId}/${action}`, cookies: { lodos_sid: a.sid } })).statusCode).toBe(404);
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

  it("Phase 3 Task 5: the clock lists only the sandbox's people, B's ids can't punch in A's, A's manager gets 404 on B's staff; B unchanged", async () => {
    const before = await snapshot(b.tenantId);
    const aPeople = (await t.inject({ method: "GET", url: "/api/clock/people", cookies: { lodos_sb: a.sb } })).json() as { id: string }[];
    expect(aPeople.length).toBeGreaterThan(0);
    const bCook = String(before.staff.find((s) => s.role === "cook")!._id);
    const bWaiter = String(before.staff.find((s) => s.role === "waiter")!._id);
    for (const p of aPeople) expect([bCook, bWaiter]).not.toContain(p.id);
    // A's sandbox cookie with B's staff ids: unknown people fail like a wrong PIN, and nothing is written for B.
    for (const id of [bCook, bWaiter]) {
      const res = await t.inject({ method: "POST", url: "/api/clock/punch", cookies: { lodos_sb: a.sb }, payload: { staffId: id, pin: "1234" } });
      expect(res.statusCode).toBe(401);
    }
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    for (const [method, url, payload] of [
      ["PUT", `/api/staff/${bCook}/rate`, { kurusPerHour: 5 }],
      ["POST", `/api/staff/${bCook}/clock-pin`, { pin: "1234" }],
      ["POST", "/api/timesheets/entries", { staffId: bCook, in: "2026-11-05T09:00:00Z", out: "2026-11-05T17:00:00Z", reason: "x" }],
    ] as const) {
      expect((await t.inject({ method, url, cookies, payload })).statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

  it("Phase 3 Task 8: A's manager sees only A's expenses and categories; B's ids are 404 on every write; B unchanged", async () => {
    const mk = async (v: Visitor, amount: number) => {
      const cat = await runWithTenant(v.tenantId, () => t.models.ExpenseCategory.create({ name: { en: "Rent", tr: "Kira" }, kind: "other", monthlyBudget: 123, sort: 0 }));
      const exp = await runWithTenant(v.tenantId, () =>
        t.models.Expense.create({ categoryId: cat._id, amount, date: "2026-11-05", createdBy: cat._id }),
      );
      return { cat: String(cat._id), exp: String(exp._id) };
    };
    const aIds = await mk(a, 1_111);
    const bIds = await mk(b, 2_222);
    const before = await snapshot(b.tenantId);
    const own = { lodos_sid: a.sid, lodos_sb: a.sb };
    const view = (await t.inject({ method: "GET", url: "/api/expenses?month=2026-11", cookies: own })).json();
    // Next to the demo's seeded expenses of the month.
    const ids = view.expenses.map((e: { id: string }) => e.id);
    expect(ids).toContain(aIds.exp);
    expect(ids).not.toContain(bIds.exp);
    const aMonth = await runWithTenant(a.tenantId, () => t.models.Expense.find({ date: { $gte: "2026-11-01", $lte: "2026-11-31" } }).lean());
    expect(ids.sort()).toEqual(aMonth.map((e) => String(e._id)).sort());
    expect(view.total).toBe(aMonth.reduce((n, e) => n + e.amount, 0));
    const cats = (await t.inject({ method: "GET", url: "/api/expense-categories", cookies: own })).json().categories as { id: string }[];
    expect(cats.map((c) => c.id)).toContain(aIds.cat);
    expect(cats.map((c) => c.id)).not.toContain(bIds.cat);
    const csv = (await t.inject({ method: "GET", url: "/api/expenses.csv?month=2026-11", cookies: own })).body;
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(aMonth.length + 1);
    expect(csv).toContain("11.11");
    expect(csv).not.toContain("22.22");

    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const body = { categoryId: bIds.cat, amount: 5, date: "2026-11-05" };
    const catBody = { name: { en: "x", tr: "x" }, kind: "other", monthlyBudget: 1 };
    for (const [method, url, payload] of [
      ["POST", "/api/expenses", body],
      ["PUT", `/api/expenses/${bIds.exp}`, body],
      ["DELETE", `/api/expenses/${bIds.exp}`, undefined],
      ["PUT", `/api/expense-categories/${bIds.cat}`, catBody],
    ] as const) {
      // With B's sandbox cookie A's session resolves A's own tenant, where B's ids don't exist.
      expect((await t.inject({ method, url, cookies, ...(payload ? { payload } : {}) })).statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

  it("Phase 3 Task 10: A's performance routes read only A's people and ratings; B's staff ids are 404; B unchanged", async () => {
    const mk = (v: Visitor, comment: string) =>
      runWithTenant(v.tenantId, async () => {
        const waiter = await t.models.Staff.findOne({ role: "waiter" }).lean().orFail();
        await t.models.Rating.create({ serviceDay: "2026-11-10", paidAt: NOW, submittedAt: NOW, serverStaffId: waiter._id, waiter: 5, comment });
        return String(waiter._id);
      });
    const aWaiter = await mk(a, "only-in-sandbox-a");
    const bWaiter = await mk(b, "only-in-sandbox-b");
    const before = await snapshot(b.tenantId);
    const own = { lodos_sid: a.sid, lodos_sb: a.sb };
    const ranking = await t.inject({ method: "GET", url: "/api/performance/ranking", cookies: own });
    expect(ranking.statusCode).toBe(200);
    const ids = (ranking.json().groups.floor as { staffId: string }[]).map((r) => r.staffId);
    expect(ids).toContain(aWaiter);
    expect(ids).not.toContain(bWaiter);
    const person = await t.inject({ method: "GET", url: `/api/performance/${aWaiter}`, cookies: own });
    expect(person.body).toContain("only-in-sandbox-a");
    expect(person.body).not.toContain("only-in-sandbox-b");
    const cross = { lodos_sid: a.sid, lodos_sb: b.sb };
    expect((await t.inject({ method: "GET", url: `/api/performance/${bWaiter}`, cookies: cross })).statusCode).toBe(404);
    const me = await t.inject({ method: "GET", url: "/api/me/performance", cookies: cross });
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain("only-in-sandbox-b");
    expect(await snapshot(b.tenantId)).toEqual(before);
  });

  it("Phase 3 Task 12: A's monthly business data, PDF and CSV read only A's sales, expenses and comments; B unchanged", async () => {
    const mk = (v: Visitor, amount: number, comment: string) =>
      runWithTenant(v.tenantId, async () => {
        const cat = await t.models.ExpenseCategory.create({ name: { en: `Cat ${comment}`, tr: `Kat ${comment}` }, kind: "other", monthlyBudget: 0, sort: 99 });
        await t.models.Expense.create({ categoryId: cat._id, amount, date: "2026-11-04", payee: comment, createdBy: cat._id });
        await t.models.Rating.create({ serviceDay: "2026-11-10", paidAt: NOW, submittedAt: NOW, comment });
      });
    // Bigger than any of the demo's seeded expenses.
    await mk(a, 77_777_777, "monthly-only-in-a");
    await mk(b, 99_999_999, "monthly-only-in-b");
    const before = await snapshot(b.tenantId);
    const bSummaries = await runWithTenant(b.tenantId, () => t.models.DailySummary.countDocuments({}));
    const cookies = { lodos_sid: a.sid, lodos_sb: b.sb };
    const view = await t.inject({ method: "GET", url: "/api/business/monthly?month=2026-11", cookies });
    expect(view.statusCode, view.body).toBe(200);
    expect(view.body).toContain("monthly-only-in-a");
    expect(view.body).not.toContain("monthly-only-in-b");
    expect(view.json().expenses.biggest[0].amount).toBe(77_777_777);
    const pdf = await t.inject({ method: "GET", url: "/api/business/monthly.pdf?month=2026-11", cookies });
    expect(pdf.statusCode).toBe(200);
    const text = await pdfText(pdf.rawPayload);
    expect(text).toContain("monthly-only-in-a");
    expect(text).not.toContain("monthly-only-in-b");
    const csv = await t.inject({ method: "GET", url: "/api/business/monthly.csv?month=2026-11&section=expenses", cookies });
    expect(csv.body).toContain("Cat monthly-only-in-a");
    expect(csv.body).not.toContain("Cat monthly-only-in-b");
    expect(await snapshot(b.tenantId)).toEqual(before);
    expect(await runWithTenant(b.tenantId, () => t.models.DailySummary.countDocuments({}))).toBe(bSummaries);
  });

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
