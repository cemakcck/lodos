import { emptyAgg, type RatingAgg } from "@lodos/shared";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { attributeStations } from "../src/ops/attribution";
import { opsForDays, type PersonOps } from "../src/ops/daily";
import { createRating } from "../src/ratings/service";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

/** Service day 2026-11-10 runs 2026-11-10T03:00Z (06:00 Istanbul) to 2026-11-11T03:00Z. */
const DAY = "2026-11-10";
const at = (iso: string) => new Date(iso);
const MIN = 60_000;
const LATE = 15 * MIN;

describe("attributeStations (pure)", () => {
  const now = at("2026-11-10T23:00:00Z");
  const cook = (staffId: string, inIso: string, outIso: string | null) =>
    ({ staffId, station: "kitchen" as const, in: at(inIso), out: outIso ? at(outIso) : null });
  const ticket = (sentIso: string, readyMin: number, station: "kitchen" | "bar" = "kitchen") =>
    ({ station, sentAt: at(sentIso), readyAt: new Date(at(sentIso).getTime() + readyMin * MIN) });

  it("two cooks overlapping for an hour each get half of that hour's tickets; a cook alone gets all of them", () => {
    // A 18:00–20:00 Istanbul, B 19:00–21:00.
    const entries = [cook("A", "2026-11-10T15:00:00Z", "2026-11-10T17:00:00Z"), cook("B", "2026-11-10T16:00:00Z", "2026-11-10T18:00:00Z")];
    const tickets = [
      ticket("2026-11-10T15:30:00Z", 10), // A alone
      ticket("2026-11-10T15:40:00Z", 20), // A alone, late
      ticket("2026-11-10T16:20:00Z", 10), // both
      ticket("2026-11-10T16:40:00Z", 15), // both, exactly on the threshold: on time
      ticket("2026-11-10T17:30:00Z", 30), // B alone, late
    ];
    const out = attributeStations({ entries, tickets, dishes: [], lateMs: LATE, now });
    expect(out.get("A")).toEqual({ stationTickets: 3, stationOnTime: 2, dishRatingSum: 0, dishRatingCount: 0 });
    expect(out.get("B")).toEqual({ stationTickets: 2, stationOnTime: 1, dishRatingSum: 0, dishRatingCount: 0 });
  });

  it("credits nobody when the station has no one clocked in, and never another station's people", () => {
    const entries = [{ staffId: "E", station: "bar" as const, in: at("2026-11-10T15:00:00Z"), out: at("2026-11-10T20:00:00Z") }];
    const tickets = [ticket("2026-11-10T16:00:00Z", 5)]; // kitchen: no cook in
    const dishes = [{ station: "kitchen" as const, stars: 4, paidAt: at("2026-11-10T16:30:00Z") }];
    expect(attributeStations({ entries, tickets, dishes, lateMs: LATE, now }).size).toBe(0);
  });

  it("an open entry runs until now; clock-out is exclusive, clock-in inclusive", () => {
    const entries = [cook("A", "2026-11-10T15:00:00Z", "2026-11-10T16:00:00Z"), cook("B", "2026-11-10T16:00:00Z", null)];
    const tickets = [ticket("2026-11-10T16:00:00Z", 5), ticket("2026-11-10T22:00:00Z", 5), ticket("2026-11-10T23:30:00Z", 5)];
    const out = attributeStations({ entries, tickets, dishes: [], lateMs: LATE, now });
    expect(out.get("A")).toBeUndefined();
    expect(out.get("B")!.stationTickets).toBe(2); // 16:00Z and 22:00Z; 23:30Z is after now
  });

  it("splits a dish rating among the station's people clocked in at payment, a person in twice counted once", () => {
    const entries = [
      cook("A", "2026-11-10T15:00:00Z", "2026-11-10T16:30:00Z"),
      cook("A", "2026-11-10T16:00:00Z", "2026-11-10T18:00:00Z"), // overlapping duplicate punch window
      cook("B", "2026-11-10T16:00:00Z", "2026-11-10T18:00:00Z"),
      { staffId: "E", station: "bar" as const, in: at("2026-11-10T15:00:00Z"), out: at("2026-11-10T18:00:00Z") },
    ];
    const dishes = [
      { station: "kitchen" as const, stars: 4, paidAt: at("2026-11-10T16:15:00Z") },
      { station: "kitchen" as const, stars: 2, paidAt: at("2026-11-10T15:30:00Z") },
      { station: "bar" as const, stars: 5, paidAt: at("2026-11-10T16:15:00Z") },
    ];
    const out = attributeStations({ entries, tickets: [], dishes, lateMs: LATE, now });
    expect(out.get("A")).toEqual({ stationTickets: 0, stationOnTime: 0, dishRatingSum: 2 + 2, dishRatingCount: 1.5 });
    expect(out.get("B")).toEqual({ stationTickets: 0, stationOnTime: 0, dishRatingSum: 2, dishRatingCount: 0.5 });
    expect(out.get("E")).toEqual({ stationTickets: 0, stationOnTime: 0, dishRatingSum: 5, dishRatingCount: 1 });
  });
});

describe("opsForDays", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp({ now: at("2026-11-10T14:00:00Z") });
  });
  afterAll(() => t.close());

  async function fresh() {
    t.clock.set(at("2026-11-10T14:00:00Z"));
    const s = await seedTenant(t, { liveService: false });
    const inTenant = <T>(fn: () => PromiseLike<T>) => runWithTenant(s.tenantId, fn);
    const sid = await createSession(t.models, s.seed.staff.waiter, s.tenantId, "person", t.clock.now());
    const w = (method: "POST", url: string, payload?: object) =>
      t.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
    const person = (name: string) => inTenant(() => t.models.Staff.findOne({ name }).lean().orFail());
    const clock = (staffId: Types.ObjectId, inIso: string, outIso: string | null, serviceDay = DAY) =>
      inTenant(() => t.models.ClockEntry.create({ staffId, serviceDay, in: at(inIso), out: outIso ? at(outIso) : null, rate: 12_000 }));
    const ticket = (station: "kitchen" | "bar", sentIso: string, readyMin: number) =>
      inTenant(() =>
        t.models.Ticket.create({
          orderId: new Types.ObjectId(), checkId: new Types.ObjectId(), tableId: new Types.ObjectId(), tableName: "T1", station,
          status: "ready", sentAt: at(sentIso), readyAt: new Date(at(sentIso).getTime() + readyMin * MIN),
          items: [{ orderItemIndex: 0, name: { en: "x", tr: "x" }, qty: 1 }],
        }),
      );
    return { s, inTenant, w, person, clock, ticket };
  }

  it("a live day: labour plus station attribution from clock intervals, and the summary's ticket times", async () => {
    const c = await fresh();
    const emre = await c.person("Emre Yıldız");
    const zeynep = await c.person("Zeynep Arslan");
    const ece = await c.person("Ece Demir");
    const hasan = await c.person("Hasan Kılıç"); // dishwasher: not a station cook
    await c.clock(emre._id, "2026-11-10T15:00:00Z", "2026-11-10T17:00:00Z"); // 18–20 Istanbul
    await c.clock(zeynep._id, "2026-11-10T16:00:00Z", "2026-11-10T18:00:00Z"); // 19–21
    await c.clock(ece._id, "2026-11-10T15:00:00Z", null); // still in
    await c.clock(hasan._id, "2026-11-10T15:00:00Z", "2026-11-10T18:00:00Z");
    await c.ticket("kitchen", "2026-11-10T15:30:00Z", 10); // Emre alone
    await c.ticket("kitchen", "2026-11-10T15:45:00Z", 20); // Emre alone, late
    await c.ticket("kitchen", "2026-11-10T16:30:00Z", 10); // both
    await c.ticket("kitchen", "2026-11-10T16:40:00Z", 10); // both
    await c.ticket("bar", "2026-11-10T16:00:00Z", 4); // Ece
    await c.ticket("kitchen", "2026-11-10T19:00:00Z", 5); // nobody in: counted in totals only

    const now = at("2026-11-10T20:00:00Z");
    const ops = (await c.inTenant(() => opsForDays(t.models, [DAY], now))).get(DAY)!;
    const row = (id: Types.ObjectId) => ops.people.find((p) => p.staffId === String(id));
    expect(row(emre._id)).toMatchObject({ minutes: 120, stationTickets: 3, stationOnTime: 2 });
    expect(row(zeynep._id)).toMatchObject({ minutes: 120, stationTickets: 1, stationOnTime: 1 });
    expect(row(ece._id)).toMatchObject({ stationTickets: 1, stationOnTime: 1 });
    expect(row(hasan._id)).toMatchObject({ minutes: 180, stationTickets: 0 });
    expect(ops.ticketTimes.kitchen.reduce((n, h) => n + h.count, 0)).toBe(5);
    expect(ops.ticketTimes.bar).toEqual([{ hour: 19, count: 1, totalMs: 4 * MIN, onTime: 1 }]);
    expect(ops.generated).toBe(false);
    expect(ops.byServer).toEqual([]);
  });

  it("a rating submitted the day after payment counts on the payment's service day, credited at payment time; counts match the documents", async () => {
    const c = await fresh();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const spritz = await itemNamed(t, c.s.tenantId, "Bergamot spritz");
    const emre = await c.person("Emre Yıldız");
    const table = c.s.seed.tables.T7!.id;
    // Seated 22:00 Istanbul, paid 23:30 (service day DAY); Emre on until 23:45.
    t.clock.set(at("2026-11-10T19:00:00Z"));
    const seat = await c.w("POST", `/api/tables/${table}/seat`, { covers: 2 });
    const checkId = seat.json().checkId as string;
    expect((await c.w("POST", `/api/tables/${table}/orders`, orderBody([{ itemId: fries.id }, { itemId: spritz.id }]))).statusCode).toBe(201);
    t.clock.set(at("2026-11-10T20:30:00Z"));
    expect((await c.w("POST", `/api/checks/${checkId}/close`, { method: "card" })).statusCode).toBe(200);
    await c.clock(emre._id, "2026-11-10T17:00:00Z", "2026-11-10T20:45:00Z");
    // Submitted the next service day, 13:00 Istanbul on the 11th.
    const submitted = at("2026-11-11T10:00:00Z");
    await c.inTenant(() =>
      createRating(t.models, table, { checkId, waiter: 4, food: 5, dishes: [{ itemId: fries.id, stars: 4 }, { itemId: spritz.id, stars: 2 }] }, submitted),
    );

    const ops = await c.inTenant(() => opsForDays(t.models, [DAY, "2026-11-11"], submitted));
    const day = ops.get(DAY)!;
    const docs = await c.inTenant(() => t.models.Rating.find({ serviceDay: DAY }).lean());
    expect(docs).toHaveLength(1);
    expect(day.ratings.food.count).toBe(docs.filter((d) => d.food != null).length);
    expect(day.ratings.waiter.reduce((n, w) => n + w.count, 0)).toBe(docs.filter((d) => d.waiter != null).length);
    expect(day.ratings.dishes.reduce((n, d) => n + d.count, 0)).toBe(docs.reduce((n, d) => n + d.dishes.length, 0));
    // The kitchen dish goes to Emre; the bar dish to nobody (no bartender in).
    expect(day.people.find((p) => p.staffId === String(emre._id))).toMatchObject({ dishRatingSum: 4, dishRatingCount: 1 });
    expect(ops.get("2026-11-11")!.ratings.food.count).toBe(0);
  });

  it("a generated summary's aggregates come back unchanged", async () => {
    const c = await fresh();
    const g = "2026-08-01";
    const agg = (sum: number, count: number) => ({ ...emptyAgg(), sum, count });
    const ratings: RatingAgg = {
      waiter: [{ staffId: "w1", sum: 9, count: 2, dist: [0, 0, 0, 1, 1] }],
      dishes: [{ itemId: null, name: { en: "Burrata", tr: "Burrata" }, sum: 14, count: 3, dist: [0, 0, 0, 2, 1] }],
      food: agg(8, 2),
      cleanliness: agg(5, 1),
      atmosphere: agg(0, 0),
    };
    const people: PersonOps[] = [
      { staffId: "c1", minutes: 480, overtimeMinutes: 0, labourCost: 96_000, shifts: 1, lateShifts: 0, stationTickets: 40.5, stationOnTime: 38, dishRatingSum: 22, dishRatingCount: 5.5 },
    ];
    const byServer = [{ staffId: "w1", checks: 10, covers: 24, sales: 2_000_000 }];
    const ticketTimes = { kitchen: [{ hour: 19, count: 12, totalMs: 12 * 10 * MIN, onTime: 11 }], bar: [] };
    await c.inTenant(() =>
      t.models.DailySummary.create({
        serviceDay: g, revenue: 2_000_000, covers: 24, checks: 10, comps: { count: 0, amount: 0 }, voids: { count: 0, amount: 0 },
        byHour: [], ticketTimes, items: [], payments: { card: 2_000_000, cash: 0 }, byServer, ratings, people, generated: true,
      }),
    );
    const ops = (await c.inTenant(() => opsForDays(t.models, [g], at("2026-11-10T14:00:00Z")))).get(g)!;
    expect(ops).toEqual({ serviceDay: g, ratings, people, byServer, ticketTimes, generated: true });
  });
});
