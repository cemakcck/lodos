import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { makeTestApp, newTenant, type TestApp } from "./helpers";
import { closeSockets, connect, listen } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
let demo: TestApp;
let main: SeedResult;

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  demo = await makeTestApp({ now: NOW, demoMode: true });
  main = await seedRestaurant(t.models, "main", NOW, { liveService: false });
});
afterEach(() => closeSockets());
afterAll(async () => {
  await t.close();
  await demo.close();
});

let ipSeq = 0;
const nextIp = () => `10.1.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const login = (staffId: string, pin: string, ip = nextIp()) =>
  t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId, pin }, remoteAddress: ip });

type Row = {
  id: string; name: string; role: string; active: boolean; lastSignInAt: string | null;
  tables: { id: string; name: string; roomId: string }[]; tableRanges: string; demoProtected: boolean;
  canDeactivate: boolean; whyNot: string | null;
};

/** A fresh tenant (no live service) with a manager session for Selin, on app `a`. */
async function fresh(a: TestApp = t) {
  const tenantId = newTenant();
  const seed = await seedRestaurant(a.models, tenantId, NOW, { liveService: false });
  const sid = await createSession(a.models, seed.staff.manager, tenantId, "person", NOW);
  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    a.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
  const list = async () => (await call("GET", "/api/staff")).json() as { people: Row[]; stations: Row[] };
  const tableIds = async (...names: string[]) => {
    const rows = await runWithTenant(tenantId, () => a.models.Table.find({ name: { $in: names } }).lean());
    return names.map((n) => String(rows.find((r) => r.name === n)!._id));
  };
  return { tenantId, seed, sid, call, list, tableIds };
}

const staffNamed = (tenantId: string, name: string) =>
  runWithTenant(tenantId, () => t.models.Staff.findOne({ name }).lean().orFail());

describe("login picker and schedule-only roles", () => {
  it("the login picker lists login and station roles only: no cooks", async () => {
    const res = await t.inject({ method: "GET", url: "/api/auth/staff" });
    const roles = (res.json() as { role: string }[]).map((s) => s.role);
    expect(roles).not.toContain("cook");
    expect(new Set(roles)).toEqual(new Set(["waiter", "kitchen", "bar", "manager"]));
  });

  it("a cook can't sign in (401), and the attempt counts toward the lockout", async () => {
    const cook = await staffNamed("main", "Emre Yıldız");
    expect(cook.role).toBe("cook");
    expect(cook.pinHash ?? null).toBeNull();
    for (let i = 0; i < 5; i++) expect((await login(String(cook._id), "1234")).statusCode).toBe(401);
    expect((await login(String(cook._id), "1234")).statusCode).toBe(429);
  });

  it("escalation needs a PIN: cook → waiter without one is 400 pin_required; with one they can sign in", async () => {
    const sid = await createSession(t.models, main.staff.manager, "main", "person", NOW);
    const zeynep = await staffNamed("main", "Zeynep Arslan");
    const patch = (payload: object) =>
      t.inject({ method: "PATCH", url: `/api/staff/${String(zeynep._id)}`, cookies: { lodos_sid: sid }, payload });
    const bare = await patch({ role: "waiter" });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().error.code).toBe("pin_required");
    expect((await patch({ role: "waiter", pin: "5678" })).statusCode).toBe(200);
    expect((await login(String(zeynep._id), "5678")).statusCode).toBe(200);
  });

  it("lastSignInAt is set on login", async () => {
    expect((await staffNamed("main", "Mert")).lastSignInAt ?? null).toBeNull();
    expect((await login(main.staff.waiter2, "2222")).statusCode).toBe(200);
    expect((await staffNamed("main", "Mert")).lastSignInAt).toEqual(NOW);
  });
});

describe("staff list and add", () => {
  it("is manager only", async () => {
    const f = await fresh();
    const waiterSid = await createSession(t.models, f.seed.staff.waiter, f.tenantId, "person", NOW);
    const res = await t.inject({ method: "GET", url: "/api/staff", cookies: { lodos_sid: waiterSid } });
    expect(res.statusCode).toBe(403);
  });

  it("lists people (active first, by name) and stations separately", async () => {
    const f = await fresh();
    const { people, stations } = await f.list();
    expect(stations.map((s) => s.name)).toEqual(["Bar", "Kitchen"]);
    for (const s of stations) expect(s).toMatchObject({ tables: [], canDeactivate: false, whyNot: "station", demoProtected: true });
    expect(people.map((p) => p.name)).toEqual(
      ["Burak Şahin", "Can Özkan", "Deniz", "Ece Demir", "Emre Yıldız", "Hasan Kılıç", "İpek Aydın", "Mert", "Selin", "Zeynep Arslan"],
    );
    const selin = people.find((p) => p.name === "Selin")!;
    expect(selin).toMatchObject({ role: "manager", canDeactivate: false, whyNot: "last_manager" });
    const deniz = people.find((p) => p.name === "Deniz")!;
    expect(deniz).toMatchObject({ canDeactivate: true, whyNot: null, demoProtected: true, tableRanges: "B1–B3, T5–T10, T13–T14" });
    expect(JSON.stringify(people)).not.toContain("pinHash");
  });

  it("adding waiter Ayla with T1 and T2 takes them from their waiter; her row shows T1–T2", async () => {
    const f = await fresh();
    const ids = await f.tableIds("T1", "T2");
    const res = await f.call("POST", "/api/staff", { name: "Ayla", role: "waiter", pin: "4321", tableIds: ids });
    expect(res.statusCode).toBe(201);
    const { people } = await f.list();
    const ayla = people.find((p) => p.name === "Ayla")!;
    expect(ayla.tableRanges).toBe("T1–T2");
    expect(ayla.tables.map((x) => x.id).sort()).toEqual([...ids].sort());
    const mert = people.find((p) => p.name === "Mert")!;
    expect(mert.tables.map((x) => x.name)).not.toContain("T1");
    const tables = await runWithTenant(f.tenantId, () => t.models.Table.find({ _id: { $in: ids } }).lean());
    for (const tb of tables) expect(String(tb.sectionStaffId)).toBe(ayla.id);
  });

  it("an unknown table id is 404 and writes nothing", async () => {
    const f = await fresh();
    const ghost = "0123456789abcdef01234567";
    const add = await f.call("POST", "/api/staff", { name: "Ayla", role: "waiter", pin: "4321", tableIds: [ghost] });
    expect(add.statusCode).toBe(404);
    expect(await runWithTenant(f.tenantId, () => t.models.Staff.countDocuments({ name: "Ayla" }))).toBe(0);
    const edit = await f.call("PATCH", `/api/staff/${f.seed.staff.waiter2}`, { name: "Mehmet", tableIds: [ghost] });
    expect(edit.statusCode).toBe(404);
    expect((await staffNamed(f.tenantId, "Mert")).name).toBe("Mert");
  });

  it("validates role and PIN on add", async () => {
    const f = await fresh();
    const noPin = await f.call("POST", "/api/staff", { name: "Ayla", role: "waiter" });
    expect(noPin.statusCode).toBe(400);
    expect(noPin.json().error.code).toBe("pin_required");
    expect((await f.call("POST", "/api/staff", { name: "Ayla", role: "cook", pin: "1234" })).statusCode).toBe(400);
    expect((await f.call("POST", "/api/staff", { name: "Ayla", role: "kitchen", pin: "1234" })).statusCode).toBe(400);
    const cook = await f.call("POST", "/api/staff", { name: "Ayla", role: "cook" });
    expect(cook.statusCode).toBe(201);
    expect(cook.json().staff).toMatchObject({ name: "Ayla", role: "cook", tables: [] });
  });

  it("names are unique among active staff, case-insensitive in Turkish", async () => {
    const f = await fresh();
    const dup = await f.call("POST", "/api/staff", { name: "deniz", role: "cook" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("name_taken");
    // Turkish folding: "İPEK AYDIN" is "ipek aydın".
    expect((await f.call("POST", "/api/staff", { name: " İPEK AYDIN ", role: "host" })).json().error.code).toBe("name_taken");
    const mert = await staffNamed(f.tenantId, "Mert");
    expect((await f.call("PATCH", `/api/staff/${String(mert._id)}`, { name: "DENİZ" })).statusCode).toBe(409);
  });
});

describe("edit", () => {
  it("the last active manager can't become a non-manager", async () => {
    const f = await fresh();
    const res = await f.call("PATCH", `/api/staff/${f.seed.staff.manager}`, { role: "waiter" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("last_manager");
  });

  it("a station accepts only a PIN reset", async () => {
    const f = await fresh();
    const res = await f.call("PATCH", `/api/staff/${f.seed.staff.kitchen}`, { name: "Cold kitchen" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("station");
    expect((await f.call("POST", `/api/staff/${f.seed.staff.kitchen}/pin`, { pin: "7777" })).statusCode).toBe(200);
  });

  it("a waiter moved to a schedule role loses PIN, sessions and tables", async () => {
    const f = await fresh();
    const sid = await createSession(t.models, f.seed.staff.waiter2, f.tenantId, "person", NOW);
    const res = await f.call("PATCH", `/api/staff/${f.seed.staff.waiter2}`, { role: "host" });
    expect(res.statusCode).toBe(200);
    expect(res.json().unassignedTables.length).toBeGreaterThan(0);
    const mert = await staffNamed(f.tenantId, "Mert");
    expect(mert.pinHash ?? null).toBeNull();
    expect((await t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: sid } })).statusCode).toBe(401);
    const left = await runWithTenant(f.tenantId, () => t.models.Table.countDocuments({ sectionStaffId: mert._id }));
    expect(left).toBe(0);
  });

  it("a manager resets a PIN", async () => {
    const f = await fresh();
    expect((await f.call("POST", `/api/staff/${f.seed.staff.waiter}/pin`, { pin: "6543" })).statusCode).toBe(200);
    const deniz = await staffNamed(f.tenantId, "Deniz");
    const { verifyPin } = await import("../src/auth/pin");
    expect(await verifyPin(deniz.pinHash!, "6543")).toBe(true);
  });
});

describe("deactivation rules", () => {
  it("yourself → 409 self; the last manager → 409 last_manager", async () => {
    const f = await fresh();
    const last = await f.call("POST", `/api/staff/${f.seed.staff.manager}/deactivate`);
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe("last_manager");
    expect((await f.call("POST", "/api/staff", { name: "Oya", role: "manager", pin: "1357" })).statusCode).toBe(201);
    const self = await f.call("POST", `/api/staff/${f.seed.staff.manager}/deactivate`);
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe("self");
    const station = await f.call("POST", `/api/staff/${f.seed.staff.bar}/deactivate`);
    expect(station.json().error.code).toBe("station");
  });

  it("in demo mode Deniz → 409 demo_protected while Mert → 200", async () => {
    const f = await fresh(demo);
    const deniz = await f.call("POST", `/api/staff/${f.seed.staff.waiter}/deactivate`);
    expect(deniz.statusCode).toBe(409);
    expect(deniz.json().error.code).toBe("demo_protected");
    const row = (await f.list()).people.find((p) => p.name === "Deniz")!;
    expect(row).toMatchObject({ canDeactivate: false, whyNot: "demo_protected" });
    expect((await f.call("POST", `/api/staff/${f.seed.staff.waiter2}/deactivate`)).statusCode).toBe(200);
  });

  it("reactivation re-checks the name", async () => {
    const f = await fresh();
    expect((await f.call("POST", `/api/staff/${f.seed.staff.waiter2}/deactivate`)).statusCode).toBe(200);
    expect((await f.call("POST", "/api/staff", { name: "mert", role: "cook" })).statusCode).toBe(201);
    const back = await f.call("POST", `/api/staff/${f.seed.staff.waiter2}/reactivate`);
    expect(back.statusCode).toBe(409);
    expect(back.json().error.code).toBe("name_taken");
    const { people } = await f.list();
    expect(people.at(-1)).toMatchObject({ name: "Mert", active: false, canDeactivate: false });
  });

  it("deactivation ends sessions and sockets", async () => {
    const f = await fresh();
    const url = await listen(t);
    const mertSid = await createSession(t.models, f.seed.staff.waiter2, f.tenantId, "person", NOW);
    expect((await t.inject({ method: "GET", url: "/api/floor", cookies: { lodos_sid: mertSid } })).statusCode).toBe(200);
    const sock = await connect(url, { sid: mertSid });
    const disconnected = new Promise<string>((resolve) => sock.socket.once("disconnect", (reason) => resolve(reason)));
    const mertTables = await runWithTenant(f.tenantId, () => t.models.Table.find({ sectionStaffId: f.seed.staff.waiter2 }).lean());
    expect(mertTables.length).toBeGreaterThan(0);

    const res = await f.call("POST", `/api/staff/${f.seed.staff.waiter2}/deactivate`);
    expect(res.statusCode).toBe(200);
    expect([...(res.json().unassignedTables as string[])].sort()).toEqual(mertTables.map((x) => x.name).sort());

    expect((await t.inject({ method: "GET", url: "/api/floor", cookies: { lodos_sid: mertSid } })).statusCode).toBe(401);
    const ended = await sock.next((e) => e.type === "session.ended");
    expect(ended.ids).toEqual([f.seed.staff.waiter2]);
    expect(await disconnected).toBe("io server disconnect");
    const after = await runWithTenant(f.tenantId, () => t.models.Table.find({ _id: { $in: mertTables.map((x) => x._id) } }).lean());
    for (const tb of after) expect(tb.sectionStaffId).toBeNull();
  });
});
