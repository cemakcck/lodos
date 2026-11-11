import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approve, listApprovers } from "../src/auth/approval";
import { unscoped, runWithTenant } from "../src/db/tenancy";
import { ApiError } from "../src/errors";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
let t: Awaited<ReturnType<typeof makeTestApp>>;

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(async () => {
  await t.close();
});

async function fresh(tenantId = newTenant()) {
  await seedRestaurant(t.models, tenantId, NOW, { liveService: false });
  const byName = async (name: string) => {
    const s = await runWithTenant(tenantId, () => t.models.Staff.findOne({ name }));
    if (!s) throw new Error(name);
    return { id: String(s._id), name: s.name, role: s.role, tenantId };
  };
  const call = (requester: Awaited<ReturnType<typeof byName>>, approval: { managerId: string; pin: string } | undefined, ip = "10.9.0.1") =>
    runWithTenant(tenantId, () => approve(t.models, { tenantId, ip, approval, requester, now: NOW }));
  const events = () => unscoped("test", () => t.models.RateEvent.countDocuments({ key: new RegExp(tenantId) }));
  /** Every rate key a call from `ip` could write: the tenant's PIN keys and the IP's own key. */
  const allEvents = (ip: string) => unscoped("test", () => t.models.RateEvent.countDocuments({ $or: [{ key: new RegExp(tenantId) }, { key: `ip:${ip}` }] }));
  return { tenantId, byName, call, events, allEvents };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return `${e.status} ${e.code}`;
    throw e;
  }
  return "ok";
};

describe("approve", () => {
  it("a manager requester approves themselves with no PIN and no rate events", async () => {
    const f = await fresh();
    const selin = await f.byName("Selin");
    const ip = "10.9.42.1"; // used by no other test, so its IP key counts only this test's attempts
    expect(await f.call(selin, undefined, ip)).toEqual({ id: selin.id, name: "Selin" });
    expect(await f.allEvents(ip)).toBe(0);
    // The count does see the IP key: a waiter's PIN approval from the same IP records it.
    expect(await f.call(await f.byName("Deniz"), { managerId: selin.id, pin: "9999" }, ip)).toEqual({ id: selin.id, name: "Selin" });
    expect(await unscoped("test", () => t.models.RateEvent.countDocuments({ key: `ip:${ip}` }))).toBeGreaterThan(0);
  });

  it("a waiter needs an approval", async () => {
    const f = await fresh();
    expect(await code(f.call(await f.byName("Deniz"), undefined))).toBe("403 approval_required");
  });

  it("a manager's PIN approves for a waiter", async () => {
    const f = await fresh();
    const selin = await f.byName("Selin");
    expect(await f.call(await f.byName("Deniz"), { managerId: selin.id, pin: "9999" })).toEqual({ id: selin.id, name: "Selin" });
  });

  it("wrong PINs lock the manager, shared with login", async () => {
    const f = await fresh("main"); // login runs against the "main" tenant outside demo mode
    const selin = await f.byName("Selin");
    const deniz = await f.byName("Deniz");
    for (let i = 0; i < 5; i++) expect(await code(f.call(deniz, { managerId: selin.id, pin: "0000" }))).toBe("401 unauthorized");
    expect(await code(f.call(deniz, { managerId: selin.id, pin: "9999" }))).toBe("429 rate_limited");
    const login = await t.inject({
      method: "POST",
      url: "/api/auth/pin",
      payload: { staffId: selin.id, pin: "9999" },
      remoteAddress: "10.9.0.2",
    });
    expect(login.statusCode).toBe(429);
  });

  it("a waiter's own PIN cannot approve", async () => {
    const f = await fresh();
    const deniz = await f.byName("Deniz");
    const mert = await f.byName("Mert");
    expect(await code(f.call(mert, { managerId: deniz.id, pin: "1111" }))).toBe("403 not_a_manager");
  });

  it("a deactivated manager cannot approve", async () => {
    const f = await fresh();
    const selin = await f.byName("Selin");
    await runWithTenant(f.tenantId, () => t.models.Staff.updateOne({ _id: selin.id }, { active: false }));
    expect(await code(f.call(await f.byName("Deniz"), { managerId: selin.id, pin: "9999" }))).toBe("401 unauthorized");
  });
});

describe("listApprovers", () => {
  it("lists active managers by name", async () => {
    const f = await fresh();
    const selin = await f.byName("Selin");
    expect(await runWithTenant(f.tenantId, () => listApprovers(t.models))).toEqual([{ id: selin.id, name: "Selin" }]);
    await runWithTenant(f.tenantId, () => t.models.Staff.updateOne({ _id: selin.id }, { active: false }));
    expect(await runWithTenant(f.tenantId, () => listApprovers(t.models))).toEqual([]);
  });
});
