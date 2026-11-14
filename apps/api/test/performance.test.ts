import { shiftSpan } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { makeTestApp, newTenant, type TestApp } from "./helpers";
import { seedRestaurant } from "../src/seed/seed";

const NOW = new Date("2026-11-10T17:00:00Z"); // Tuesday, service day 2026-11-10 (Monday 2026-11-09), 20:00 Istanbul
const at = (iso: string) => new Date(iso);

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

/** Deniz: 5 waiter ratings and 2 shifts (ranked). Mert: 4 ratings (not enough). The manager is unranked. */
async function fresh() {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false, history: false });
  const inT = <T>(fn: () => PromiseLike<T>) => runWithTenant(tenantId, fn);
  const { Shift, Rating, ClockEntry } = t.models;
  await inT(async () => {
    await Promise.all([Shift.deleteMany({}), Rating.deleteMany({}), ClockEntry.deleteMany({})]);
    const deniz = seed.staff.waiter;
    for (const day of ["2026-11-09", "2026-11-10"]) {
      const span = shiftSpan(day, "17:00", "01:00");
      await Shift.create({ staffId: deniz, serviceDay: day, start: span.start, end: span.end, area: "salon" });
    }
    await ClockEntry.create({ staffId: deniz, serviceDay: "2026-11-09", in: at("2026-11-09T14:00:00Z"), out: at("2026-11-09T22:00:00Z"), rate: 10_000 });
    await ClockEntry.create({ staffId: deniz, serviceDay: "2026-11-10", in: at("2026-11-10T14:00:00Z"), out: at("2026-11-10T16:30:00Z"), rate: 10_000 });
    const rate = (staff: string, stars: number, i: number, extra: object = {}) =>
      Rating.create({
        serviceDay: "2026-11-09", paidAt: at("2026-11-09T15:00:00Z"), submittedAt: new Date(at("2026-11-09T16:00:00Z").getTime() + i * 60_000),
        serverStaffId: staff, waiter: stars, ...extra,
      });
    const stars = [5, 5, 4, 5, 5];
    for (const [i, s] of stars.entries()) await rate(deniz, s, i, i === 0 ? { comment: "Lovely service" } : i === 1 ? { comment: "Rude remark", commentHidden: true } : {});
    for (let i = 0; i < 4; i++) await rate(seed.staff.waiter2, 3, i);
  });
  const sid = (id: string) => createSession(t.models, id, tenantId, "person", NOW);
  const call = async (who: string, url: string) => t.inject({ method: "GET", url, cookies: { lodos_sid: await sid(who) } });
  return { tenantId, seed, call };
}

const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  return out;
};

describe("performance API", () => {
  it("ranking: waiters ranked with a breakdown, under-minimum last with a null score, only ranked roles listed", async () => {
    const f = await fresh();
    const res = await f.call(f.seed.staff.manager, "/api/performance/ranking");
    expect(res.statusCode, res.body).toBe(200);
    const { groups } = res.json();
    expect(Object.keys(groups)).toEqual(["floor", "kitchen", "bar"]);
    expect(groups.floor.map((r: { name: string }) => r.name)).toEqual(["Deniz", "Mert"]);
    const [deniz, mert] = groups.floor;
    expect(deniz).toMatchObject({ staffId: f.seed.staff.waiter, role: "waiter", ratingCount: 5, ratingAvg: 4.8, plannedMinutes: 960, lateShifts: 0 });
    expect(deniz.minutes).toBe(8 * 60 + 150);
    expect(deniz.breakdown.map((b: { key: string }) => b.key)).toEqual(["rating", "workload", "reliability"]);
    expect(deniz.score).toBe(deniz.breakdown.reduce((s: number, b: { points: number }) => s + b.points, 0));
    expect(mert).toMatchObject({ score: null, breakdown: [], ratingCount: 4 });
    const roles = Object.values(groups).flat().map((r) => (r as { role: string }).role);
    expect(roles.every((r) => ["waiter", "cook", "bartender"].includes(r))).toBe(true);
    expect(groups.kitchen.length).toBeGreaterThan(0);
  });

  it("person page: history of 8 weeks, rating trend, visible and hidden comments; 404 unknown; 400 bad keys", async () => {
    const f = await fresh();
    const res = await f.call(f.seed.staff.manager, `/api/performance/${f.seed.staff.waiter}`);
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json();
    expect(p.history).toHaveLength(8);
    expect(p.history[7]).toEqual({ week: "2026-11-09", score: p.score });
    expect(p.history.slice(0, 7).every((h: { score: number | null }) => h.score === null)).toBe(true);
    expect(p.trend[7]).toEqual({ week: "2026-11-09", avg: 4.8, count: 5 });
    expect(p.comments.map((c: { comment: string; hidden: boolean }) => [c.comment, c.hidden]).sort()).toEqual([["Lovely service", false], ["Rude remark", true]]);
    expect((await f.call(f.seed.staff.manager, `/api/performance/${f.seed.staff.manager}`)).statusCode).toBe(404);
    for (const q of ["period=year", "key=2026-11-10", "period=month&key=2026-13", "period=week&key=2026-11"]) {
      expect((await f.call(f.seed.staff.manager, `/api/performance/ranking?${q}`)).statusCode, q).toBe(400);
    }
    const month = await f.call(f.seed.staff.manager, "/api/performance/ranking?period=month&key=2026-11");
    expect(month.statusCode).toBe(200);
    expect(month.json().groups.floor[0].ratingCount).toBe(5);
    const earlier = await f.call(f.seed.staff.manager, "/api/performance/ranking?period=week&key=2026-11-02");
    expect(earlier.json().groups.floor.every((r: { score: number | null }) => r.score === null)).toBe(true);
  });

  it("bounds the period to the data range (400 outside, nothing stored) and carries the range", async () => {
    const f = await fresh();
    const m = f.seed.staff.manager;
    const count = () => runWithTenant(f.tenantId, () => t.models.DailySummary.countDocuments({}));
    const before = await count();
    // The tenant was created on 10 Nov with no history: November only, weeks from 2026-10-26 to 2026-11-09.
    for (const q of ["period=month&key=0001-01", "period=month&key=2026-10", "period=month&key=2026-12", "period=week&key=2026-10-19", "period=week&key=2026-11-16"]) {
      for (const url of [`/api/performance/ranking?${q}`, `/api/performance/${f.seed.staff.waiter}?${q}`]) expect((await f.call(m, url)).statusCode, url).toBe(400);
      expect((await f.call(f.seed.staff.waiter, `/api/me/performance?${q}`)).statusCode, q).toBe(400);
    }
    expect(await count()).toBe(before);
    const range = { first: "2026-11", last: "2026-11" };
    const week = await f.call(m, "/api/performance/ranking?period=week&key=2026-10-26");
    expect(week.statusCode, week.body).toBe(200);
    expect(week.json().range).toEqual(range);
    expect((await f.call(m, `/api/performance/${f.seed.staff.waiter}`)).json().range).toEqual(range);
    expect((await f.call(f.seed.staff.waiter, "/api/me/performance?period=month&key=2026-11")).json().range).toEqual(range);
  });

  it("Review Focus 4: a waiter's /api/me/performance holds only their own data; the ranking is forbidden", async () => {
    const f = await fresh();
    const res = await f.call(f.seed.staff.waiter, "/api/me/performance");
    expect(res.statusCode, res.body).toBe(200);
    const me = res.json();
    expect(me).toMatchObject({ ratingCount: 5, rank: { position: 1, of: 1 } });
    expect(me.score).not.toBeNull();
    expect(Object.keys(me).sort()).toEqual(["breakdown", "comments", "lateShifts", "minutes", "plannedMinutes", "range", "ratingAvg", "ratingCount", "rank", "score"].sort());
    for (const b of me.breakdown as { key: string }[]) expect("value" in b, b.key).toBe(b.key !== "workload");
    expect(me.comments.map((c: { comment: string }) => c.comment)).toEqual(["Lovely service"]);
    const names = await runWithTenant(f.tenantId, () => t.models.Staff.find({ _id: { $ne: f.seed.staff.waiter } }).lean());
    for (const s of names) {
      expect(res.body).not.toContain(String(s._id));
      expect(res.body).not.toContain(s.name);
    }
    const keys = keysDeep(me).map((k) => k.toLowerCase());
    expect(keys.filter((k) => k.includes("kurusperhour") || k.includes("hourlyrate") || k.includes("labour") || k === "rate")).toEqual([]);
    expect((await f.call(f.seed.staff.waiter, "/api/performance/ranking")).statusCode).toBe(403);
    expect((await f.call(f.seed.staff.waiter, `/api/performance/${f.seed.staff.waiter2}`)).statusCode).toBe(403);
    expect((await f.call(f.seed.staff.waiter, "/api/me/performance?period=month&key=bad")).statusCode).toBe(400);
  });

  it("a manager's /api/me/performance is their own: unranked, rank null", async () => {
    const f = await fresh();
    const res = await f.call(f.seed.staff.manager, "/api/me/performance");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ score: null, rank: null, comments: [], ratingCount: 0 });
  });
});
