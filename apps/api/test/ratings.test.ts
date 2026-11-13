import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import type { Realtime } from "../src/realtime/emit";
import { ratingAggForDays } from "../src/ratings/service";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

let emit: Mock<Realtime["emit"]>;
beforeEach(() => {
  t.clock.set(NOW);
  emit = vi.fn<Realtime["emit"]>();
  t.app.realtime.emit = emit;
});

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
const as = async (s: Seeded, who: "waiter" | "manager") => {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", t.clock.now());
  return (method: "GET" | "POST", url: string, payload?: object) =>
    t.inject({ method, url, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
};

/** A paid check at T7: burrata + fries ordered, one of three cheesecakes voided (a fully voided line: one cheesecake). */
async function paidCheck() {
  const s = await seedTenant(t, { liveService: false });
  const w = await as(s, "waiter");
  const m = await as(s, "manager");
  const burrata = await itemNamed(t, s.tenantId, "Burrata");
  const fries = await itemNamed(t, s.tenantId, "Truffle fries");
  const cake = await itemNamed(t, s.tenantId, "Basque cheesecake");
  const token = s.seed.tables.T7!.token;
  const seat = await w("POST", `/api/tables/${s.seed.tables.T7!.id}/seat`, { covers: 2 });
  const checkId = seat.json().checkId as string;
  const order = await w("POST", `/api/tables/${s.seed.tables.T7!.id}/orders`, orderBody([{ itemId: burrata.id }, { itemId: fries.id }, { itemId: cake.id }]));
  const orderId = order.json().orderId as string;
  const voided = await m("POST", `/api/checks/${checkId}/adjustments`, { lineRef: `${orderId}:2`, kind: "void", qty: 1, reason: "wrong_item" });
  expect(voided.statusCode, voided.body).toBe(201);
  const g = guest(t, token);
  const pay = async () => expect((await w("POST", `/api/checks/${checkId}/close`, { method: "card" })).statusCode).toBe(200);
  const stored = () => runWithTenant(s.tenantId, () => t.models.Rating.find({}).lean());
  return { s, w, m, g, token, checkId, burrata, fries, cake, pay, stored };
}

describe("GET /api/guest/rating", () => {
  it("is closed while the check is open; after payment it is open with the dishes still on the bill", async () => {
    const c = await paidCheck();
    expect((await c.g.get(`/api/guest/rating?checkId=${c.checkId}`)).json().state).toBe("closed");
    await c.pay();
    const res = await c.g.get(`/api/guest/rating?checkId=${c.checkId}`);
    expect(res.statusCode).toBe(200);
    const card = res.json();
    expect(card.state).toBe("open");
    const waiter = await runWithTenant(c.s.tenantId, () => t.models.Staff.findOne({ _id: c.s.seed.staff.waiter }).lean().orFail());
    expect(card.waiter).toEqual({ name: waiter.name });
    expect(card.dishes.map((d: { itemId: string }) => d.itemId).sort()).toEqual([c.burrata.id, c.fries.id].sort());
  });

  it("another table's token, an unknown id and a malformed id are closed", async () => {
    const c = await paidCheck();
    await c.pay();
    const other = guest(t, c.s.seed.tables.T9!.token);
    expect((await other.get(`/api/guest/rating?checkId=${c.checkId}`)).json().state).toBe("closed");
    expect((await c.g.get(`/api/guest/rating?checkId=${"0".repeat(24)}`)).json().state).toBe("closed");
    expect((await c.g.get("/api/guest/rating?checkId=nope")).json().state).toBe("closed");
  });

  it("is done once rated and closed after 24 h", async () => {
    const c = await paidCheck();
    await c.pay();
    expect((await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 4 })).statusCode).toBe(201);
    expect((await c.g.get(`/api/guest/rating?checkId=${c.checkId}`)).json().state).toBe("done");
    const c2 = await paidCheck();
    await c2.pay();
    t.clock.set(new Date(NOW.getTime() + DAY_MS + 60_000));
    expect((await c2.g.get(`/api/guest/rating?checkId=${c2.checkId}`)).json().state).toBe("closed");
  });
});

describe("POST /api/guest/ratings", () => {
  it("stores the rating with the server, service day, payment time and each dish's station, and tells the manager", async () => {
    const c = await paidCheck();
    await c.pay();
    const res = await c.g.post("/api/guest/ratings", {
      checkId: c.checkId,
      waiter: 5,
      dishes: [{ itemId: c.burrata.id, stars: 4 }, { itemId: c.fries.id, stars: 5 }],
      food: 5,
      cleanliness: 4,
      atmosphere: 5,
      comment: "Lovely",
    });
    expect(res.statusCode, res.body).toBe(201);
    const [r] = await c.stored();
    const check = await runWithTenant(c.s.tenantId, () => t.models.Check.findOne({ _id: c.checkId }).lean().orFail());
    expect(await c.stored()).toHaveLength(1);
    expect(r).toMatchObject({ waiter: 5, food: 5, cleanliness: 4, atmosphere: 5, comment: "Lovely", commentHidden: false, generated: false, serviceDay: "2026-11-10" });
    expect(String(r!.checkId)).toBe(c.checkId);
    expect(String(r!.serverStaffId)).toBe(String(check.serverStaffId));
    expect(r!.paidAt).toEqual(check.closedAt);
    expect(r!.dishes.map((d) => ({ id: String(d.itemId), stars: d.stars, station: d.station }))).toEqual([
      { id: c.burrata.id, stars: 4, station: "kitchen" },
      { id: c.fries.id, stars: 5, station: "kitchen" },
    ]);
    expect(emit).toHaveBeenCalledWith(c.s.tenantId, "rating.created", { ids: [res.json().id] }, ["manager"]);
  });

  it("parallel submissions store one: one 201, one 409 already_rated", async () => {
    const c = await paidCheck();
    await c.pay();
    const body = { checkId: c.checkId, waiter: 5, food: 4 };
    const results = await Promise.all([c.g.post("/api/guest/ratings", body), c.g.post("/api/guest/ratings", body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("already_rated");
    expect(await c.stored()).toHaveLength(1);
    expect(emit.mock.calls.filter((x) => x[1] === "rating.created")).toHaveLength(1);
  });

  it("a second rating later is 409 already_rated", async () => {
    const c = await paidCheck();
    await c.pay();
    await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 4 });
    const again = await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 1 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("already_rated");
  });

  it("is refused 24 h and a minute after payment, for an open check and for another table", async () => {
    const c = await paidCheck();
    await c.pay();
    const other = guest(t, c.s.seed.tables.T9!.token);
    const otherRes = await other.post("/api/guest/ratings", { checkId: c.checkId, food: 4 });
    expect(otherRes.statusCode).toBe(409);
    expect(otherRes.json().error.code).toBe("rating_closed");
    t.clock.set(new Date(NOW.getTime() + DAY_MS + 60_000));
    const late = await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 4 });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("rating_closed");
    expect(await c.stored()).toHaveLength(0);

    t.clock.set(NOW);
    const open = await paidCheck();
    expect((await open.g.post("/api/guest/ratings", { checkId: open.checkId, food: 4 })).json().error.code).toBe("rating_closed");
  });

  it("accepts a rating at exactly 24 h", async () => {
    const c = await paidCheck();
    await c.pay();
    t.clock.set(new Date(NOW.getTime() + DAY_MS));
    expect((await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 4 })).statusCode).toBe(201);
  });

  it("an empty body, no stars, out-of-range, fractional or too-long input are 400", async () => {
    const c = await paidCheck();
    await c.pay();
    const bad = [
      {},
      { checkId: c.checkId },
      { checkId: c.checkId, comment: "just words" },
      { checkId: c.checkId, dishes: [] },
      { checkId: c.checkId, waiter: 0 },
      { checkId: c.checkId, waiter: 6 },
      { checkId: c.checkId, food: 4.5 },
      { checkId: c.checkId, food: 4, comment: "x".repeat(501) },
      { checkId: c.checkId, dishes: [{ itemId: c.fries.id, stars: 3 }, { itemId: c.fries.id, stars: 4 }] },
    ];
    for (const payload of bad) expect((await c.g.post("/api/guest/ratings", payload)).statusCode, JSON.stringify(payload)).toBe(400);
    expect(await c.stored()).toHaveLength(0);
  });

  it("a dish not on the bill, including the fully voided one, is 400 invalid_dish", async () => {
    const c = await paidCheck();
    await c.pay();
    for (const itemId of [c.cake.id, "0".repeat(24), "nope"]) {
      const res = await c.g.post("/api/guest/ratings", { checkId: c.checkId, dishes: [{ itemId, stars: 5 }] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_dish");
    }
    expect(await c.stored()).toHaveLength(0);
  });

  it("is rate limited per IP: the 21st in ten minutes is 429", async () => {
    const c = await paidCheck();
    const g = guest(t, c.token, "10.9.9.9");
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await g.post("/api/guest/ratings", { checkId: c.checkId, food: 4 })).statusCode;
    expect(last).toBe(429);
  });
});

describe("comment moderation", () => {
  it("a manager hides and unhides; a waiter gets 403; unknown ids are 404", async () => {
    const c = await paidCheck();
    await c.pay();
    const id = (await c.g.post("/api/guest/ratings", { checkId: c.checkId, food: 2, comment: "rude" })).json().id as string;
    const denied = await c.w("POST", `/api/ratings/${id}/hide`);
    expect(denied.statusCode).toBe(403);
    expect((await c.stored())[0]!.commentHidden).toBe(false);
    expect((await c.m("POST", `/api/ratings/${id}/hide`)).json()).toEqual({ id, commentHidden: true });
    expect((await c.stored())[0]!.commentHidden).toBe(true);
    expect((await c.m("POST", `/api/ratings/${id}/unhide`)).json()).toEqual({ id, commentHidden: false });
    expect((await c.m("POST", `/api/ratings/${"0".repeat(24)}/hide`)).statusCode).toBe(404);
    expect((await c.m("POST", "/api/ratings/nope/hide")).statusCode).toBe(404);
  });
});

describe("ratingAggForDays", () => {
  it("aggregates raw ratings per service day with string item ids", async () => {
    const c = await paidCheck();
    await c.pay();
    await c.g.post("/api/guest/ratings", { checkId: c.checkId, waiter: 5, dishes: [{ itemId: c.fries.id, stars: 4 }], food: 5, atmosphere: 3 });
    const check = await runWithTenant(c.s.tenantId, () => t.models.Check.findOne({ _id: c.checkId }).lean().orFail());
    const map = await runWithTenant(c.s.tenantId, () => ratingAggForDays(t.models, ["2026-11-10", "2026-11-09"]));
    expect([...map.keys()]).toEqual(["2026-11-10"]);
    const agg = map.get("2026-11-10")!;
    expect(agg.waiter).toEqual([{ staffId: String(check.serverStaffId), sum: 5, count: 1, dist: [0, 0, 0, 0, 1] }]);
    expect(agg.dishes).toEqual([{ itemId: c.fries.id, name: expect.objectContaining({ en: expect.stringContaining("Truffle fries") }), sum: 4, count: 1, dist: [0, 0, 0, 1, 0] }]);
    expect(agg.food).toEqual({ sum: 5, count: 1, dist: [0, 0, 0, 0, 1] });
    expect(agg.cleanliness).toEqual({ sum: 0, count: 0, dist: [0, 0, 0, 0, 0] });
    expect(agg.atmosphere.sum).toBe(3);
  });
});
