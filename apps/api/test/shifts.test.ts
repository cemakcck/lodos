import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant, type TestApp } from "./helpers";

/** Tuesday 2026-11-10, 20:00 Istanbul: the week of Monday 2026-11-09. */
const NOW = new Date("2026-11-10T17:00:00Z");
const WEEK = "2026-11-09";
const NEXT = "2026-11-16";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Warning = { kind: string; staffId: string; shiftIds: string[]; minutes?: number };
type Row = { id: string; staffId: string; serviceDay: string; start: string; end: string; startAt: string; endAt: string; area: string; note: string | null; minutes: number };
type Week = {
  week: string;
  days: string[];
  people: { id: string; name: string; role: string; group: string; active: boolean }[];
  shifts: Row[];
  totals: { byPerson: Record<string, number>; byDay: Record<string, number> };
  warnings: Warning[];
};

/** A fresh tenant with sessions; `scheduleTeam: false` gives an empty schedule (no team, no shifts). */
async function fresh(opts: { scheduleTeam?: boolean } = {}) {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false, scheduleTeam: opts.scheduleTeam });
  const sid = (who: keyof typeof seed.staff) =>
    createSession(t.models, seed.staff[who], tenantId, who === "kitchen" || who === "bar" ? "station" : "person", NOW);
  const manager = await sid("manager");
  const as = (cookie: string) => (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    t.inject({ method, url, cookies: { lodos_sid: cookie }, ...(payload ? { payload } : {}) });
  const call = as(manager);
  const week = async (w?: string) => {
    const res = await call("GET", w ? `/api/shifts?week=${w}` : "/api/shifts");
    expect(res.statusCode).toBe(200);
    return res.json() as Week;
  };
  const add = (body: object) => call("POST", "/api/shifts", body);
  return { tenantId, seed, sid, as, call, week, add };
}

describe("the seeded schedule", () => {
  it("this week: everyone but the stations, grouped, 4–5 shifts each, exactly one warning: Ece Demir at 47 h", async () => {
    const f = await fresh();
    const w = await f.week();
    expect(w.week).toBe(WEEK);
    expect(w.days).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w.people.map((p) => p.role)).not.toContain("kitchen");
    expect(w.people.map((p) => p.role)).not.toContain("bar");
    expect(w.people).toHaveLength(10);
    const groupOf = Object.fromEntries(w.people.map((p) => [p.name, p.group]));
    expect(groupOf).toMatchObject({ Deniz: "floor", "İpek Aydın": "floor", "Emre Yıldız": "kitchen", "Hasan Kılıç": "kitchen", "Ece Demir": "bar", Selin: "managers" });
    // Grouped in display order.
    const order = ["floor", "kitchen", "bar", "managers"];
    const idx = w.people.map((p) => order.indexOf(p.group));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    for (const p of w.people) {
      const n = w.shifts.filter((s) => s.staffId === p.id).length;
      expect(n, p.name).toBeGreaterThanOrEqual(4);
      expect(n, p.name).toBeLessThanOrEqual(5);
    }
    const ece = w.people.find((p) => p.name === "Ece Demir")!;
    expect(w.warnings).toEqual([
      { kind: "week_hours", staffId: ece.id, shiftIds: expect.any(Array), minutes: 47 * 60 },
    ]);
    expect(w.totals.byPerson[ece.id]).toBe(47 * 60);
  });

  it("next week has 4–5 shifts each and no warnings", async () => {
    const f = await fresh();
    const w = await f.week(NEXT);
    expect(w.warnings).toEqual([]);
    for (const p of w.people) expect(w.shifts.filter((s) => s.staffId === p.id).length, p.name).toBeGreaterThanOrEqual(4);
  });

  it("is the same for the same `now`", async () => {
    const strip = (w: Week) => w.shifts.map((s) => [w.people.find((p) => p.id === s.staffId)!.name, s.serviceDay, s.start, s.end, s.area, s.note]);
    const [a, b] = await Promise.all([fresh(), fresh()]);
    expect(strip(await a.week())).toEqual(strip(await b.week()));
  });

  it("a real install (no schedule team) gets templates but no shifts", async () => {
    const f = await fresh({ scheduleTeam: false });
    expect(await runWithTenant(f.tenantId, () => t.models.Shift.countDocuments({}))).toBe(0);
    expect(await runWithTenant(f.tenantId, () => t.models.ShiftTemplate.countDocuments({}))).toBe(4);
  });
});

describe("GET /api/shifts", () => {
  it("is manager only: a waiter gets 403, no session 401", async () => {
    const f = await fresh({ scheduleTeam: false });
    expect((await f.as(await f.sid("waiter"))("GET", "/api/shifts")).statusCode).toBe(403);
    expect((await t.inject({ method: "GET", url: "/api/shifts" })).statusCode).toBe(401);
  });

  it("a week that is not a Monday or is malformed → 400", async () => {
    const f = await fresh({ scheduleTeam: false });
    for (const w of ["2026-11-10", "2026-13-02", "nope"]) {
      const res = await f.call("GET", `/api/shifts?week=${w}`);
      expect(res.statusCode, w).toBe(400);
      expect(res.json().error.code).toBe("validation");
    }
  });

  it("cross-midnight shifts count on the day they start, in daily totals", async () => {
    const f = await fresh({ scheduleTeam: false });
    const deniz = f.seed.staff.waiter;
    expect((await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "17:00", end: "01:00", area: "salon" })).statusCode).toBe(201);
    const late = await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "02:00", end: "04:00", area: "salon" });
    expect(late.statusCode).toBe(201);
    expect(late.json().shift).toMatchObject({ serviceDay: "2026-11-10", start: "02:00", end: "04:00", minutes: 120, startAt: "2026-11-10T23:00:00.000Z" });
    const w = await f.week();
    expect(w.totals.byDay["2026-11-10"]).toBe(600);
    expect(w.totals.byDay["2026-11-11"]).toBe(0);
    expect(w.totals.byPerson[deniz]).toBe(600);
    expect(w.shifts).toHaveLength(2);
  });

  it("an inactive person with shifts that week is listed and flagged; without, they're left out", async () => {
    const f = await fresh({ scheduleTeam: false });
    const mert = f.seed.staff.waiter2;
    const created = (await f.add({ staffId: mert, serviceDay: "2026-11-11", start: "17:00", end: "23:00", area: "terrace" })).json().shift as Row;
    expect((await f.call("POST", `/api/staff/${mert}/deactivate`)).statusCode).toBe(200);
    const w = await f.week();
    expect(w.people.find((p) => p.id === mert)).toMatchObject({ active: false, group: "floor" });
    expect(w.warnings).toEqual([{ kind: "inactive", staffId: mert, shiftIds: [created.id] }]);
    expect((await f.week(NEXT)).people.find((p) => p.id === mert)).toBeUndefined();
  });
});

describe("writing shifts", () => {
  it("an overlap with the same person → 409 shift_overlap naming the other shift; touching is fine", async () => {
    const f = await fresh({ scheduleTeam: false });
    const deniz = f.seed.staff.waiter;
    const first = (await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "17:00", end: "01:00", area: "salon" })).json().shift as Row;
    const clash = await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "00:30", end: "03:00", area: "bar" });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatchObject({ code: "shift_overlap", details: { shiftId: first.id } });
    // The next service day's shift that starts at 01:00 touches the end: allowed. Another person: allowed.
    expect((await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "01:00", end: "03:00", area: "bar" })).statusCode).toBe(201);
    expect((await f.add({ staffId: f.seed.staff.waiter2, serviceDay: "2026-11-10", start: "17:00", end: "01:00", area: "salon" })).statusCode).toBe(201);
  });

  it("over 16 h → 400 shift_too_long; 16 h exactly is allowed", async () => {
    const f = await fresh({ scheduleTeam: false });
    const long = await f.add({ staffId: f.seed.staff.waiter, serviceDay: "2026-11-10", start: "08:00", end: "01:00", area: "salon" });
    expect(long.statusCode).toBe(400);
    expect(long.json().error.code).toBe("shift_too_long");
    expect((await f.add({ staffId: f.seed.staff.waiter, serviceDay: "2026-11-10", start: "08:00", end: "00:00", area: "salon" })).statusCode).toBe(201);
  });

  it("station accounts are never on the schedule (400); unknown people 404; bad bodies 400", async () => {
    const f = await fresh({ scheduleTeam: false });
    const base = { serviceDay: "2026-11-10", start: "17:00", end: "23:00", area: "salon" };
    const kitchen = await f.add({ ...base, staffId: f.seed.staff.kitchen });
    expect(kitchen.statusCode).toBe(400);
    expect(kitchen.json().error.code).toBe("station");
    expect((await f.add({ ...base, staffId: "0123456789abcdef01234567" })).statusCode).toBe(404);
    expect((await f.add({ ...base, staffId: f.seed.staff.waiter, area: "roof" })).statusCode).toBe(400);
    expect((await f.add({ ...base, staffId: f.seed.staff.waiter, start: "25:00" })).statusCode).toBe(400);
    expect((await f.add({ ...base, staffId: f.seed.staff.waiter, note: "x".repeat(141) })).statusCode).toBe(400);
  });

  it("PATCH moves a shift to another person or day, keeps its own slot, and refuses overlaps", async () => {
    const f = await fresh({ scheduleTeam: false });
    const { waiter: deniz, waiter2: mert } = f.seed.staff;
    const a = (await f.add({ staffId: deniz, serviceDay: "2026-11-10", start: "17:00", end: "01:00", area: "salon" })).json().shift as Row;
    const b = (await f.add({ staffId: mert, serviceDay: "2026-11-11", start: "17:00", end: "01:00", area: "salon", note: "Close" })).json().shift as Row;
    // A note-only change doesn't overlap the shift itself.
    const noted = await f.call("PATCH", `/api/shifts/${a.id}`, { note: "Opens the terrace" });
    expect(noted.statusCode).toBe(200);
    expect(noted.json().shift).toMatchObject({ id: a.id, note: "Opens the terrace", start: "17:00", end: "01:00" });
    // Moving onto Mert's Wednesday clashes with b.
    const clash = await f.call("PATCH", `/api/shifts/${a.id}`, { staffId: mert, serviceDay: "2026-11-11" });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.details).toEqual({ shiftId: b.id });
    const moved = await f.call("PATCH", `/api/shifts/${a.id}`, { staffId: mert, serviceDay: "2026-11-12", start: "18:00" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().shift).toMatchObject({ staffId: mert, serviceDay: "2026-11-12", start: "18:00", end: "01:00", minutes: 420 });
    expect((await f.call("PATCH", `/api/shifts/${a.id}`, { end: "11:00" })).json().error.code).toBe("shift_too_long");
    expect((await f.call("PATCH", `/api/shifts/${a.id}`, { staffId: f.seed.staff.bar })).statusCode).toBe(400);
    expect((await f.call("PATCH", `/api/shifts/${a.id}`, { note: null })).json().shift.note).toBeNull();
  });

  it("DELETE removes a shift; a second delete is 404", async () => {
    const f = await fresh({ scheduleTeam: false });
    const a = (await f.add({ staffId: f.seed.staff.waiter, serviceDay: "2026-11-10", start: "17:00", end: "23:00", area: "salon" })).json().shift as Row;
    expect((await f.call("DELETE", `/api/shifts/${a.id}`)).statusCode).toBe(200);
    expect((await f.call("DELETE", `/api/shifts/${a.id}`)).statusCode).toBe(404);
    expect((await f.week()).shifts).toEqual([]);
  });

  it("waiters can't write shifts", async () => {
    const f = await fresh({ scheduleTeam: false });
    const waiter = f.as(await f.sid("waiter"));
    expect((await waiter("POST", "/api/shifts", { staffId: f.seed.staff.waiter, serviceDay: "2026-11-10", start: "17:00", end: "23:00", area: "salon" })).statusCode).toBe(403);
  });
});

describe("copy last week", () => {
  it("copies the previous week's shifts +7 days, skipping one that clashes", async () => {
    const f = await fresh({ scheduleTeam: false });
    const { waiter: deniz, waiter2: mert, manager: selin } = f.seed.staff;
    for (const [staffId, serviceDay] of [[deniz, "2026-11-02"], [deniz, "2026-11-04"], [mert, "2026-11-03"], [selin, "2026-11-08"]] as const) {
      expect((await f.add({ staffId, serviceDay, start: "17:00", end: "01:00", area: "salon", note: "Copied" })).statusCode).toBe(201);
    }
    // Mert already works Tuesday afternoon this week: his copy would overlap.
    expect((await f.add({ staffId: mert, serviceDay: "2026-11-10", start: "12:00", end: "18:00", area: "terrace" })).statusCode).toBe(201);
    const res = await f.call("POST", "/api/shifts/copy-last-week", { week: WEEK });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ copied: 3, skipped: 1 });
    const w = await f.week();
    expect(w.shifts.filter((s) => s.note === "Copied").map((s) => [s.staffId, s.serviceDay, s.start, s.end]).sort()).toEqual(
      [[deniz, "2026-11-09", "17:00", "01:00"], [deniz, "2026-11-11", "17:00", "01:00"], [selin, "2026-11-15", "17:00", "01:00"]].sort(),
    );
    // Copying again clashes with every copy.
    expect((await f.call("POST", "/api/shifts/copy-last-week", { week: WEEK })).json()).toEqual({ copied: 0, skipped: 4 });
  });

  it("leaves out people who are no longer active", async () => {
    const f = await fresh({ scheduleTeam: false });
    const mert = f.seed.staff.waiter2;
    await f.add({ staffId: mert, serviceDay: "2026-11-03", start: "17:00", end: "01:00", area: "salon" });
    await f.call("POST", `/api/staff/${mert}/deactivate`);
    expect((await f.call("POST", "/api/shifts/copy-last-week", { week: WEEK })).json()).toEqual({ copied: 0, skipped: 0 });
    expect((await f.call("POST", "/api/shifts/copy-last-week", { week: "2026-11-10" })).statusCode).toBe(400);
  });
});

describe("templates", () => {
  it("are seeded, in order", async () => {
    const f = await fresh({ scheduleTeam: false });
    const res = await f.call("GET", "/api/shift-templates");
    expect(res.statusCode).toBe(200);
    expect((res.json().templates as { name: string; start: string; end: string; area: string }[]).map((x) => [x.name, x.start, x.end, x.area])).toEqual([
      ["Dinner", "17:00", "01:00", "salon"],
      ["Prep", "12:00", "17:00", "kitchen"],
      ["Double", "12:00", "01:00", "salon"],
      ["Bar", "18:00", "02:00", "bar"],
    ]);
  });

  it("CRUD, with the same validation as shifts", async () => {
    const f = await fresh({ scheduleTeam: false });
    const created = await f.call("POST", "/api/shift-templates", { name: "Brunch", start: "09:00", end: "15:00", area: "terrace" });
    expect(created.statusCode).toBe(201);
    const tpl = created.json().template as { id: string; sort: number; minutes: number };
    expect(tpl).toMatchObject({ name: "Brunch", sort: 4, minutes: 360 });
    expect((await f.call("PATCH", `/api/shift-templates/${tpl.id}`, { name: "Late brunch", sort: 0 })).json().template).toMatchObject({ name: "Late brunch", start: "09:00", sort: 0 });
    expect((await f.call("POST", "/api/shift-templates", { name: "x".repeat(41), start: "09:00", end: "15:00", area: "salon" })).statusCode).toBe(400);
    expect((await f.call("POST", "/api/shift-templates", { name: "Marathon", start: "06:00", end: "23:00", area: "salon" })).json().error.code).toBe("shift_too_long");
    expect((await f.call("DELETE", `/api/shift-templates/${tpl.id}`)).statusCode).toBe(200);
    expect((await f.call("DELETE", `/api/shift-templates/${tpl.id}`)).statusCode).toBe(404);
    const waiter = f.as(await f.sid("waiter"));
    expect((await waiter("GET", "/api/shift-templates")).statusCode).toBe(403);
  });
});

describe("GET /api/me/shifts", () => {
  it("Deniz sees only Deniz's shifts, this week and next, with hours", async () => {
    const f = await fresh();
    const res = await f.as(await f.sid("waiter"))("GET", "/api/me/shifts");
    expect(res.statusCode).toBe(200);
    const { weeks } = res.json() as { weeks: { week: string; shifts: Row[]; minutes: number }[] };
    expect(weeks.map((w) => w.week)).toEqual([WEEK, NEXT]);
    for (const w of weeks) {
      expect(w.shifts.length).toBeGreaterThanOrEqual(4);
      expect(w.shifts.every((s) => s.staffId === f.seed.staff.waiter)).toBe(true);
      expect(w.minutes).toBe(w.shifts.reduce((n, s) => n + s.minutes, 0));
      expect(w.shifts.map((s) => s.startAt)).toEqual(w.shifts.map((s) => s.startAt).sort());
    }
  });

  it("a station session gets empty weeks", async () => {
    const f = await fresh();
    const res = await f.as(await f.sid("kitchen"))("GET", "/api/me/shifts");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ weeks: [{ week: WEEK, shifts: [], minutes: 0 }, { week: NEXT, shifts: [], minutes: 0 }] });
  });
});
