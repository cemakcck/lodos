import type { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant, unscoped } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";
import { labourForDays } from "../src/timeclock/service";
import { makeTestApp, newTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z"); // Tue 20:00 Istanbul, service day 2026-11-10
const HOUR = 3_600_000;
const AFTER = new Date("2026-11-20T12:00:00Z"); // after the whole week

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

let ipSeq = 0;
const nextIp = () => `10.7.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

/** A fresh tenant (live, no history) with a manager session; the app runs as the live tenant, so punches use `main`. */
async function fresh() {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false });
  const sid = await createSession(t.models, seed.staff.manager, tenantId, "person", NOW);
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
    t.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
  const person = (name: string) => runWithTenant(tenantId, () => t.models.Staff.findOne({ name }).lean().orFail());
  return { tenantId, seed, sid, call, person };
}

const entries = (tenantId: string, staffId: Types.ObjectId) =>
  runWithTenant(tenantId, () => t.models.ClockEntry.find({ staffId }).sort({ in: 1 }).lean());

describe("punching on the main tenant", () => {
  const punch = (staffId: string, pin: string, ip = nextIp()) =>
    t.inject({ method: "POST", url: "/api/clock/punch", payload: { staffId, pin }, remoteAddress: ip });

  it("a cook with a clock PIN punches in then out: one closed entry with the minutes; no session is created", async () => {
    await seedRestaurant(t.models, "main", NOW, { liveService: false });
    const mgr = await createSession(t.models, (await runWithTenant("main", () => t.models.Staff.findOne({ role: "manager" }).lean().orFail()))._id, "main", "person", NOW);
    const cook = await runWithTenant("main", () => t.models.Staff.findOne({ name: "Emre Yıldız" }).lean().orFail());
    const id = String(cook._id);
    const set = await t.inject({ method: "POST", url: `/api/staff/${id}/clock-pin`, cookies: { lodos_sid: mgr }, payload: { pin: "4321" } });
    expect(set.statusCode).toBe(200);
    await t.inject({ method: "PUT", url: `/api/staff/${id}/rate`, cookies: { lodos_sid: mgr }, payload: { kurusPerHour: 12_000 } });

    t.clock.set(NOW);
    const sessionsBefore = await runWithTenant("main", () => t.models.Session.countDocuments({}));
    const inRes = await punch(id, "4321");
    expect(inRes.statusCode).toBe(200);
    expect(inRes.json()).toMatchObject({ action: "in", minutesToday: 0 });
    expect(inRes.headers["set-cookie"]).toBeUndefined();
    t.clock.advance(90 * 60_000);
    const outRes = await punch(id, "4321");
    expect(outRes.json()).toMatchObject({ action: "out", minutesToday: 90 });
    const rows = await entries("main", cook._id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.out).toEqual(new Date(NOW.getTime() + 90 * 60_000));
    expect(rows[0]!.rate).toBe(12_000);
    expect(await runWithTenant("main", () => t.models.Session.countDocuments({}))).toBe(sessionsBefore);

    // The clock PIN is not a login PIN.
    const login = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: id, pin: "4321" }, remoteAddress: nextIp() });
    expect(login.statusCode).toBe(401);

    // A forgotten clock-out is refused, not closed.
    await punch(id, "4321");
    t.clock.advance(17 * HOUR);
    const forgot = await punch(id, "4321");
    expect(forgot.statusCode).toBe(409);
    expect(forgot.json().error.code).toBe("forgot_clock_out");
    expect((await entries("main", cook._id))[1]!.out ?? null).toBeNull();
    t.clock.set(NOW);
  });

  it("waiters clock with their login PIN; wrong PIN 5 times locks like login", async () => {
    const waiter = await runWithTenant("main", () => t.models.Staff.findOne({ role: "waiter" }).lean().orFail());
    const id = String(waiter._id);
    for (let i = 0; i < 5; i++) expect((await punch(id, "0000")).statusCode).toBe(401);
    expect((await punch(id, "0000")).statusCode).toBe(429);
    // The lock is the login lock: login is locked as well.
    const login = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: id, pin: "0000" }, remoteAddress: nextIp() });
    expect(login.statusCode).toBe(429);
  });

  it("lists everyone on the schedule and no station accounts", async () => {
    const res = await t.inject({ method: "GET", url: "/api/clock/people" });
    expect(res.statusCode).toBe(200);
    const people = res.json() as { id: string; name: string; clockedIn: boolean }[];
    const names = people.map((p) => p.name);
    expect(names).toContain("Emre Yıldız");
    expect(names).not.toContain("Kitchen");
    expect(names).not.toContain("Bar");
    expect(people.find((p) => p.name === "Emre Yıldız")!.clockedIn).toBe(true);
    const stations = await runWithTenant("main", () => t.models.Staff.find({ role: { $in: ["kitchen", "bar"] } }).lean());
    for (const s of stations) expect(people.map((p) => p.id)).not.toContain(String(s._id));
    // A station cannot punch.
    expect((await punch(String(stations[0]!._id), "1111")).statusCode).toBe(401);
  });
});

describe("clock punches and the IP buckets", () => {
  it("many successful punches from one IP never 429, and leave the login IP bucket alone", async () => {
    const mgr = await createSession(t.models, (await runWithTenant("main", () => t.models.Staff.findOne({ role: "manager" }).lean().orFail()))._id, "main", "person", NOW);
    const cook = await runWithTenant("main", () => t.models.Staff.findOne({ role: "cook", name: { $ne: "Emre Yıldız" } }).lean().orFail());
    const id = String(cook._id);
    await t.inject({ method: "POST", url: `/api/staff/${id}/clock-pin`, cookies: { lodos_sid: mgr }, payload: { pin: "2468" } });
    const ip = "10.99.0.1";
    const before = await unscoped("test", () => t.models.RateEvent.countDocuments({ key: `ip:${ip}` }));
    for (let i = 0; i < 40; i++) {
      const res = await t.inject({ method: "POST", url: "/api/clock/punch", payload: { staffId: id, pin: "2468" }, remoteAddress: ip });
      expect(res.statusCode, `punch ${i}`).toBe(200);
    }
    expect(await unscoped("test", () => t.models.RateEvent.countDocuments({ key: `ip:${ip}` }))).toBe(before);
  });
});

describe("staff rate and clock PIN", () => {
  it("hourlyRate is read against the app clock, not the wall clock", async () => {
    const future = new Date("2030-01-01T10:00:00Z");
    const app = await makeTestApp({ now: future });
    try {
      const tenantId = newTenant();
      const seed = await seedRestaurant(app.models, tenantId, future, { liveService: false });
      const sid = await createSession(app.models, seed.staff.manager, tenantId, "person", future);
      const cook = await runWithTenant(tenantId, () => app.models.Staff.findOne({ name: "Emre Yıldız" }).lean().orFail());
      const put = await app.inject({ method: "PUT", url: `/api/staff/${String(cook._id)}/rate`, cookies: { lodos_sid: sid }, payload: { kurusPerHour: 9_900 } });
      expect(put.json().staff.hourlyRate).toBe(9_900);
      const list = (await app.inject({ method: "GET", url: "/api/staff", cookies: { lodos_sid: sid } })).json() as { people: { name: string; hourlyRate: number }[] };
      expect(list.people.find((p) => p.name === "Emre Yıldız")!.hourlyRate).toBe(9_900);
    } finally {
      await app.close();
    }
  });

  it("a login role cannot get a clock PIN; rows carry hourlyRate and hasClockPin", async () => {
    const f = await fresh();
    const waiter = await f.person("Mert");
    expect((await f.call("POST", `/api/staff/${String(waiter._id)}/clock-pin`, { pin: "1234" })).statusCode).toBe(400);
    const cook = await f.person("Emre Yıldız");
    expect((await f.call("PUT", `/api/staff/${String(cook._id)}/rate`, { kurusPerHour: 15_000 })).statusCode).toBe(200);
    expect((await f.call("POST", `/api/staff/${String(cook._id)}/clock-pin`, { pin: "1234" })).statusCode).toBe(200);
    const list = (await f.call("GET", "/api/staff")).json() as { people: { name: string; hourlyRate: number; hasClockPin: boolean }[] };
    expect(list.people.find((p) => p.name === "Emre Yıldız")).toMatchObject({ hourlyRate: 15_000, hasClockPin: true });
    expect(list.people.find((p) => p.name === "Mert")).toMatchObject({ hourlyRate: 0, hasClockPin: false });
  });
});

describe("timesheet edits", () => {
  it("records history, re-derives the service day and reprices at the new start's rate", async () => {
    const f = await fresh();
    const cook = await f.person("Emre Yıldız");
    const id = String(cook._id);
    const early = new Date("2026-11-01T00:00:00Z");
    const late = new Date("2026-11-09T00:00:00Z");
    await runWithTenant(f.tenantId, () =>
      t.models.Staff.updateOne({ _id: cook._id }, { $set: { rates: [{ from: early, kurusPerHour: 10_000 }, { from: late, kurusPerHour: 20_000 }] } }),
    );
    const inAt = new Date("2026-11-05T09:00:00Z");
    const created = await f.call("POST", "/api/timesheets/entries", { staffId: id, in: inAt.toISOString(), out: new Date(inAt.getTime() + 8 * HOUR).toISOString(), reason: "Forgot to punch" });
    expect(created.statusCode).toBe(201);
    const entryId = created.json().id as string;
    const [made] = await entries(f.tenantId, cook._id);
    expect(made!.rate).toBe(10_000);
    expect(made!.edits).toHaveLength(1);
    expect(made!.edits[0]).toMatchObject({ reason: "Forgot to punch", before: null });
    expect(String(made!.edits[0]!.byStaffId)).toBe(String(f.seed.staff.manager));
    const first = (await f.call("GET", "/api/timesheets?week=2026-11-02")).json() as { people: { staffId: string; entries: { edited: boolean }[] }[] };
    expect(first.people.find((p) => p.staffId === id)!.entries[0]!.edited).toBe(true);

    const newIn = new Date("2026-11-09T09:00:00Z");
    const edit = await f.call("PUT", `/api/timesheets/entries/${entryId}`, { in: newIn.toISOString(), out: new Date(newIn.getTime() + 6 * HOUR).toISOString(), reason: "Wrong day" });
    expect(edit.statusCode).toBe(200);
    const [row] = await entries(f.tenantId, cook._id);
    expect(row!.rate).toBe(20_000);
    expect(row!.serviceDay).toBe("2026-11-09");
    expect(row!.edits).toHaveLength(2);
    expect(row!.edits[1]).toMatchObject({ reason: "Wrong day", before: { in: inAt } });
    expect(String(row!.edits[1]!.byStaffId)).toBe(String(f.seed.staff.manager));

    const sheet = (await f.call("GET", "/api/timesheets?week=2026-11-09")).json() as {
      people: { staffId: string; cost: number; entries: { edited: boolean; minutes: number }[] }[];
    };
    const mine = sheet.people.find((p) => p.staffId === id)!;
    expect(mine.entries[0]).toMatchObject({ edited: true, minutes: 360 });
    expect(mine.cost).toBe(Math.round((360 * 20_000) / 60));
    expect((await f.call("PUT", `/api/timesheets/entries/${entryId}`, { in: newIn.toISOString(), out: newIn.toISOString(), reason: "x" })).statusCode).toBe(400);
  });

  it("labourForDays over a week with a mid-week rate change sums to the per-entry costs, with overtime", async () => {
    const f = await fresh();
    const cook = await f.person("Emre Yıldız");
    const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    // 5 × 10 h = 50 h: 5 h overtime on the last two entries. Rate changes from 100 to 200 TL/h on Wednesday.
    const make = async (day: string, rate: number) => {
      const start = new Date(`${day}T07:00:00Z`);
      await runWithTenant(f.tenantId, () =>
        t.models.ClockEntry.create({ staffId: cook._id, serviceDay: day, in: start, out: new Date(start.getTime() + 10 * HOUR), rate }),
      );
    };
    await make(days[0]!, 10_000);
    await make(days[1]!, 10_000);
    await make(days[2]!, 20_000);
    await make(days[3]!, 20_000);
    await make(days[4]!, 20_000);
    await runWithTenant(f.tenantId, () => t.models.Shift.deleteMany({}));
    // A shift on Monday, started late, and one on Tuesday, on time.
    const shiftAt = (day: string, startIso: string) =>
      runWithTenant(f.tenantId, () => t.models.Shift.create({ staffId: cook._id, serviceDay: day, start: new Date(startIso), end: new Date(new Date(startIso).getTime() + 8 * HOUR), area: "kitchen" }));
    await shiftAt(days[0]!, "2026-11-09T06:50:00Z"); // in at 07:00Z: 10 min late
    await shiftAt(days[1]!, "2026-11-10T06:56:00Z"); // 4 min: within grace
    const result = await runWithTenant(f.tenantId, () => labourForDays(t.models, days, AFTER));
    const rows = days.flatMap((d) => result.get(d)!.filter((r) => r.staffId === String(cook._id)).map((r) => ({ d, ...r })));
    expect(rows).toHaveLength(5);
    const total = rows.reduce((n, r) => n + r.labourCost, 0);
    // 50 h: 600 min each, overtime 300 min on Fri (the 5th entry crosses 2700 min: 3000 − 2700 = 300).
    const expected = 2 * Math.round((600 * 10_000) / 60) + 3 * Math.round((600 * 20_000) / 60) + Math.round((300 * 20_000) / 120);
    expect(total).toBe(expected);
    expect(rows.reduce((n, r) => n + r.overtimeMinutes, 0)).toBe(300);
    expect(rows.find((r) => r.d === days[0])).toMatchObject({ shifts: 1, lateShifts: 1 });
    expect(rows.find((r) => r.d === days[1])).toMatchObject({ shifts: 1, lateShifts: 0 });
    expect(rows.find((r) => r.d === days[2])).toMatchObject({ shifts: 0, lateShifts: 0 });
    // Asking for Friday alone still sees the overtime built up earlier in the week.
    const fri = await runWithTenant(f.tenantId, () => labourForDays(t.models, [days[4]!], AFTER));
    expect(fri.get(days[4]!)![0]).toMatchObject({ overtimeMinutes: 300 });
  });
});

describe("labourForDays shifts and lateness", () => {
  it("counts started shifts; late = own entry after the grace, or a finished shift with no entry; split halves are judged separately", async () => {
    const f = await fresh();
    const cook = await f.person("Emre Yıldız");
    const day = "2026-11-02";
    await runWithTenant(f.tenantId, () => t.models.Shift.deleteMany({}));
    const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
    const shift = (start: string, end: string) =>
      runWithTenant(f.tenantId, () => t.models.Shift.create({ staffId: cook._id, serviceDay: day, start: at(start), end: at(end), area: "kitchen" }));
    const entry = (inAt: string, outAt: string) =>
      runWithTenant(f.tenantId, () => t.models.ClockEntry.create({ staffId: cook._id, serviceDay: day, in: at(inAt), out: at(outAt), rate: 6_000 }));
    const labour = async (now: string) => (await runWithTenant(f.tenantId, () => labourForDays(t.models, [day], at(now)))).get(day)!.find((r) => r.staffId === String(cook._id));

    // Split shift 08:00-12:00 and 16:00-20:00; first half on time (4 min), second half 10 min late.
    await shift("08:00", "12:00");
    await shift("16:00", "20:00");
    await entry("08:04", "12:00");
    await entry("16:10", "20:00");
    expect(await labour("22:00")).toMatchObject({ shifts: 2, lateShifts: 1, minutes: 236 + 230 });
    // Second half only late the other way round: first half 10 min late, second on time.
    await runWithTenant(f.tenantId, () => t.models.ClockEntry.deleteMany({}));
    await entry("08:10", "12:00");
    await entry("16:00", "20:00");
    expect(await labour("22:00")).toMatchObject({ shifts: 2, lateShifts: 1 });
    // Mid-service: the second shift has not started and is not counted.
    expect(await labour("13:00")).toMatchObject({ shifts: 1, lateShifts: 1 });
    // No-show: a finished shift with no entry is late; a running one without an entry is not yet.
    await runWithTenant(f.tenantId, () => t.models.ClockEntry.deleteMany({}));
    expect(await labour("22:00")).toMatchObject({ shifts: 2, lateShifts: 2, minutes: 0 });
    expect(await labour("10:00")).toMatchObject({ shifts: 1, lateShifts: 0 });
    // Entries without any shift: minutes counted, no shifts.
    await runWithTenant(f.tenantId, () => t.models.Shift.deleteMany({}));
    await entry("09:00", "10:00");
    expect(await labour("22:00")).toMatchObject({ shifts: 0, lateShifts: 0, minutes: 60 });
  });
});

describe("isolation", () => {
  it("another tenant's staff id and entry id are 404 for the manager; their data is unchanged", async () => {
    const a = await fresh();
    const b = await fresh();
    const bCook = await b.person("Emre Yıldız");
    const bId = String(bCook._id);
    const when = new Date("2026-11-05T09:00:00Z").toISOString();
    const out = new Date("2026-11-05T17:00:00Z").toISOString();
    const bEntry = await runWithTenant(b.tenantId, () =>
      t.models.ClockEntry.create({ staffId: bCook._id, serviceDay: "2026-11-05", in: new Date(when), out: new Date(out), rate: 1 }),
    );
    expect((await a.call("POST", "/api/timesheets/entries", { staffId: bId, in: when, out, reason: "x" })).statusCode).toBe(404);
    expect((await a.call("PUT", `/api/timesheets/entries/${String(bEntry._id)}`, { in: when, out, reason: "x" })).statusCode).toBe(404);
    expect((await a.call("PUT", `/api/staff/${bId}/rate`, { kurusPerHour: 5 })).statusCode).toBe(404);
    expect((await a.call("POST", `/api/staff/${bId}/clock-pin`, { pin: "1234" })).statusCode).toBe(404);
    const sheet = await a.call("GET", "/api/timesheets?week=2026-11-02");
    expect(sheet.body).not.toContain(bId);
    const after = await runWithTenant(b.tenantId, () => t.models.ClockEntry.find({}).lean());
    expect(after).toHaveLength(1);
    expect(after[0]!.rate).toBe(1);
    expect((await runWithTenant(b.tenantId, () => t.models.Staff.findById(bCook._id).lean().orFail())).rates).toHaveLength(0);
  });
});
