import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

/** Deploy readiness (F5): behind a reverse proxy, per-IP limits must see the client's address, not the proxy's. */
const NOW = new Date("2026-11-10T17:00:00Z");
let proxied: TestApp;
let direct: TestApp;
let seed: SeedResult;
beforeAll(async () => {
  proxied = await makeTestApp({ now: NOW, trustProxy: true, cookieSecure: true });
  direct = await makeTestApp({ now: NOW });
  seed = await seedRestaurant(direct.models, "main", NOW, { liveService: true }); // one database: both apps see it
});
afterAll(async () => {
  await proxied.close();
  await direct.close();
});

async function orderFromBehindProxy(t: TestApp) {
  await t.models.RateEvent.deleteMany({ key: /^order-ip:/ }); // both apps share this file's database
  const { tenantId, seed } = await seedTenant(t);
  const fries = await itemNamed(t, tenantId, "Truffle fries");
  const res = await t.inject({
    method: "POST",
    url: "/api/guest/orders",
    headers: { "x-table-token": seed.tables.T7!.token, "x-forwarded-for": "203.0.113.9" },
    remoteAddress: "10.0.0.2",
    payload: orderBody([{ itemId: fries.id }]),
  });
  expect(res.statusCode).toBe(201);
  const keys = await t.models.RateEvent.find({ key: /^order-ip:/ }).lean();
  return keys.map((k) => k.key);
}

describe("TRUST_PROXY", () => {
  it("enabled: req.ip honours X-Forwarded-For", async () => {
    expect(await orderFromBehindProxy(proxied)).toContain("order-ip:203.0.113.9");
  });

  it("disabled (default): X-Forwarded-For is ignored, so a client cannot spoof its address", async () => {
    const keys = await orderFromBehindProxy(direct);
    expect(keys).toContain("order-ip:10.0.0.2");
    expect(keys).not.toContain("order-ip:203.0.113.9");
  });
});

describe("COOKIE_SECURE", () => {
  it("the session cookie is Secure when configured, and not otherwise", async () => {
    for (const [t, secure] of [[proxied, true], [direct, false]] as const) {
      const res = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: seed.staff.waiter, pin: "1111" }, remoteAddress: "10.5.0.1" });
      expect(res.statusCode).toBe(200);
      expect(res.cookies.find((c) => c.name === "lodos_sid")!.secure ?? false).toBe(secure);
    }
  });
});
