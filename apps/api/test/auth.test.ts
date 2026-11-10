import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, registerErrorHandling } from "../src/errors";
import { staffRoute } from "../src/auth/guard";
import { registerAuthRoutes } from "../src/auth/routes";
import { hit } from "../src/auth/rate-limit";
import * as pin from "../src/auth/pin";
import { SANDBOX_COOKIE } from "../src/auth/login-tenant";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { makeTestApp, newTenant, TEST_SECRET } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
const H = 3_600_000;
const MIN = 60_000;

let t: Awaited<ReturnType<typeof makeTestApp>>;
let demo: Awaited<ReturnType<typeof makeTestApp>>;
const tenantA = newTenant();
const tenantB = newTenant();
let seedMain: SeedResult;
let seedA: SeedResult;
let seedB: SeedResult;

beforeAll(async () => {
  // Not demo mode: login tenant is "main".
  t = await makeTestApp({ now: NOW });
  demo = await makeTestApp({ now: NOW, demoMode: true });
  // Each test file has its own database, so seeding "main" here cannot collide with another file.
  seedMain = await seedRestaurant(t.models, "main", NOW, { liveService: false });
  seedA = await seedRestaurant(t.models, tenantA, NOW, { liveService: false });
  seedB = await seedRestaurant(t.models, tenantB, NOW, { liveService: false });
});
afterAll(async () => {
  await t.close();
  await demo.close();
});

const sid = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === "lodos_sid")?.value;

let ipSeq = 0;
async function login(
  app: typeof t,
  staffId: string,
  pin: string,
  remoteAddress = `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, // each login its own IP unless a test says otherwise
) {
  return app.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId, pin }, remoteAddress });
}

describe("PIN login", () => {
  it("a correct PIN sets the cookie and /me returns the role", async () => {
    const res = await login(t, seedMain.staff.waiter, "1111");
    expect(res.statusCode).toBe(200);
    expect(res.json().staff).toMatchObject({ id: seedMain.staff.waiter, name: "Deniz", role: "waiter" });
    const c = res.cookies.find((x) => x.name === "lodos_sid")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");
    expect(c.secure).toBeFalsy();
    const me = await t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: c.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().staff).toMatchObject({ role: "waiter", name: "Deniz" });
  });

  it("stores only the hash of the token", async () => {
    const res = await login(t, seedMain.staff.manager, "9999");
    const raw = sid(res)!;
    const find = (tokenHash: string) => t.models.Session.collection.countDocuments({ tokenHash });
    expect(await find(raw)).toBe(0);
    expect(await find(createHash("sha256").update(raw).digest("hex"))).toBe(1);
  });

  it("a wrong PIN gives 401", async () => {
    const res = await login(t, seedMain.staff.waiter2, "0000");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
    expect(sid(res)).toBeUndefined();
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await login(t, seedMain.staff.waiter, "12");
    expect(res.statusCode).toBe(400);
  });

  it("locks after 5 wrong PINs for 5 minutes, even for the correct one", async () => {
    const id = seedMain.staff.bar;
    for (let i = 0; i < 5; i++) expect((await login(t, id, "0000")).statusCode).toBe(401);
    const locked = await login(t, id, "4444");
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("rate_limited");
    t.clock.advance(5 * MIN);
    expect((await login(t, id, "4444")).statusCode).toBe(200);
    t.clock.set(NOW);
  });

  it("parallel wrong guesses cannot beat the lock: at most 5 reach verifyPin", async () => {
    const spy = vi.spyOn(pin, "verifyPin");
    try {
      const id = seedMain.staff.manager;
      const results = await Promise.all(Array.from({ length: 20 }, () => login(t, id, "0000")));
      const codes = results.map((r) => r.statusCode);
      expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
      expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(15);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
      expect((await login(t, id, "9999")).statusCode).toBe(429);
    } finally {
      spy.mockRestore();
      t.clock.advance(5 * MIN);
      expect((await login(t, seedMain.staff.manager, "9999")).statusCode).toBe(200);
      t.clock.set(NOW);
    }
  });

  it("a burst from one IP is capped at 30 per 10 minutes", async () => {
    const staff = await t.models.Staff.collection.find({ tenantId: "main" }).toArray();
    const results = await Promise.all(
      Array.from({ length: 45 }, (_, i) => login(t, String(staff[i % staff.length]!._id), "0000", "192.0.2.7")),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(30);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(15);
  });

  it("GET /api/auth/staff lists the main tenant's staff without hashes", async () => {
    const res = await t.inject("/api/auth/staff");
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list.map((s) => s.name).sort()).toEqual(["Bar", "Deniz", "Kitchen", "Mert", "Selin"]);
    expect(Object.keys(list[0]!).sort()).toEqual(["id", "name", "role"]);
  });

  it("logout deletes the session", async () => {
    const res = await login(t, seedMain.staff.waiter, "1111");
    const c = sid(res)!;
    const out = await t.inject({ method: "POST", url: "/api/auth/logout", cookies: { lodos_sid: c } });
    expect(out.statusCode).toBe(200);
    const me = await t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: c } });
    expect(me.statusCode).toBe(401);
  });
});

describe("login tenant in demo mode", () => {
  it("is 401 without a valid signed sandbox cookie", async () => {
    expect((await demo.inject("/api/auth/staff")).statusCode).toBe(401);
    const forged = await demo.inject({ method: "GET", url: "/api/auth/staff", cookies: { [SANDBOX_COOKIE]: tenantB } });
    expect(forged.statusCode).toBe(401);
    const login401 = await login(demo, seedB.staff.waiter, "1111");
    expect(login401.statusCode).toBe(401);
  });

  it("uses the sandbox in the signed cookie", async () => {
    const signed = demo.app.signCookie(tenantB);
    const res = await demo.inject({ method: "GET", url: "/api/auth/staff", cookies: { [SANDBOX_COOKIE]: signed } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(5);
    const ok = await demo.inject({
      method: "POST",
      url: "/api/auth/pin",
      payload: { staffId: seedB.staff.manager, pin: "9999" },
      cookies: { [SANDBOX_COOKIE]: signed },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("sessions", () => {
  it("a person session is rejected after 12 h + 1 s", async () => {
    const c = sid(await login(t, seedMain.staff.waiter, "1111"))!;
    const get = () => t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: c } });
    t.clock.advance(12 * H);
    expect((await get()).statusCode).toBe(200);
    t.clock.advance(1000);
    expect((await get()).statusCode).toBe(401);
    t.clock.set(NOW);
  });

  it("a person session does not slide", async () => {
    const c = sid(await login(t, seedMain.staff.waiter, "1111"))!;
    const get = () => t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: c } });
    t.clock.advance(11 * H);
    expect((await get()).statusCode).toBe(200);
    t.clock.advance(H + 1000);
    expect((await get()).statusCode).toBe(401);
    t.clock.set(NOW);
  });

  it("a station session used every hour is still valid after 30 h", async () => {
    const c = sid(await login(t, seedMain.staff.kitchen, "3333"))!;
    const get = () => t.inject({ method: "GET", url: "/api/kds/kitchen", cookies: { lodos_sid: c } });
    for (let i = 0; i < 30; i++) {
      t.clock.advance(H);
      expect((await get()).statusCode).toBe(200);
    }
    // ... and idle for 12 h + 1 s it dies.
    t.clock.advance(12 * H + 1000);
    expect((await get()).statusCode).toBe(401);
    t.clock.set(NOW);
  });

  it("a deactivated staff member's session stops working", async () => {
    const c = sid(await login(t, seedMain.staff.waiter2, "2222"))!;
    await t.models.Staff.collection.updateOne({ _id: new Types.ObjectId(seedMain.staff.waiter2) }, { $set: { active: false } });
    const me = await t.inject({ method: "GET", url: "/api/auth/me", cookies: { lodos_sid: c } });
    expect(me.statusCode).toBe(401);
    expect((await login(t, seedMain.staff.waiter2, "2222")).statusCode).toBe(401);
  });
});

describe("role matrix", () => {
  const logins = { waiter: "1111", kitchen: "3333", bar: "4444", manager: "9999" } as const;
  const matrix: Record<string, Record<string, number>> = {
    "/api/kds/kitchen": { waiter: 403, kitchen: 200, bar: 403, manager: 200 },
    "/api/kds/bar": { waiter: 403, kitchen: 403, bar: 200, manager: 200 },
    "/api/floor": { waiter: 200, kitchen: 403, bar: 403, manager: 200 },
    "/api/manager/menu": { waiter: 403, kitchen: 403, bar: 403, manager: 200 },
  };

  const cookies: Record<string, string> = {};
  beforeAll(async () => {
    for (const [role, pin] of Object.entries(logins)) {
      cookies[role] = sid(await login(t, seedMain.staff[role as keyof typeof logins], pin))!;
    }
  });

  for (const [url, expected] of Object.entries(matrix)) {
    it(`${url}`, async () => {
      const none = await t.inject(url);
      expect(none.statusCode).toBe(401);
      expect(none.json().error.code).toBe("unauthorized");
      for (const [role, status] of Object.entries(expected)) {
        const res = await t.inject({ method: "GET", url, cookies: { lodos_sid: cookies[role]! } });
        expect([url, role, res.statusCode]).toEqual([url, role, status]);
        if (status === 200) expect(res.json()).toEqual({ ok: true });
        else expect(res.json().error.code).toBe("forbidden");
      }
    });
  }

  it("unknown KDS station is 404 for a manager", async () => {
    const res = await t.inject({ method: "GET", url: "/api/kds/grill", cookies: { lodos_sid: cookies.manager! } });
    expect(res.statusCode).toBe(404);
  });
});

describe("tenant isolation through the guard", () => {
  it("a session from tenant A asking for a tenant-B resource id gets 404", async () => {
    const app = Fastify();
    app.decorate("clock", t.clock);
    app.decorate("models", t.models);
    app.decorate("demoMode", true);
    await app.register(cookie, { secret: TEST_SECRET });
    registerErrorHandling(app);
    registerAuthRoutes(app);
    app.get<{ Params: { id: string } }>(
      "/t/:id",
      staffRoute(["waiter"], async (req) => {
        const table = await req.server.models.Table.findById(req.params.id);
        if (!table) throw new ApiError(404, "not_found");
        return { name: table.name, tenant: req.staff.tenantId };
      }),
    );
    await app.ready();

    const mine = await t.models.Table.collection.findOne({ name: "B1", tenantId: tenantA });
    const sandbox = app.signCookie(tenantA);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/pin",
      payload: { staffId: seedA.staff.waiter, pin: "1111" },
      cookies: { [SANDBOX_COOKIE]: sandbox },
    });
    const c = sid(res)!;
    const own = await app.inject({ method: "GET", url: `/t/${String(mine!._id)}`, cookies: { lodos_sid: c } });
    expect(own.statusCode).toBe(200);
    expect(own.json().tenant).toBe(tenantA);
    const theirs = await t.models.Table.collection.findOne({ name: "B1", tenantId: tenantB });
    const cross = await app.inject({ method: "GET", url: `/t/${String(theirs!._id)}`, cookies: { lodos_sid: c } });
    expect(cross.statusCode).toBe(404);
    await app.close();
  });
});

describe("hit()", () => {
  it("allows up to the limit inside the window, then refuses, then recovers", async () => {
    const key = `test:${newTenant()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await hit(t.models, key, 3, 10 * MIN, NOW));
    expect(results).toEqual([true, true, true, false]);
    expect(await hit(t.models, key, 3, 10 * MIN, new Date(NOW.getTime() + 10 * MIN))).toBe(true);
  });
});
