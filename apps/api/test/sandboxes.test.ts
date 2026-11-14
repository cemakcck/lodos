import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant, unscoped } from "../src/db/tenancy";
import { runCleanup } from "../src/demo/cleanup";
import { deleteSandbox } from "../src/demo/sandboxes";
import { makeTestApp } from "./helpers";
import { cookie, countAll, H, MIN, NOW, sandboxIds, signIn, type T } from "./sandbox-helpers";

// The cap and per-IP limit tests are in sandboxes.limits.test.ts, so the two files run in parallel.

describe("demo sign-in and sandbox creation", () => {
  let t: T;
  beforeAll(async () => {
    t = await makeTestApp({
      now: NOW,
      demoMode: true,
      sandboxesPerIpHour: 1000,
    });
  });
  afterAll(() => t.close());

  it("creates a sandbox, sets both cookies and redirects the kitchen to its screen", async () => {
    const res = await signIn(t, "kitchen");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirect: "/staff/kitchen" });
    const sb = res.cookies.find((c) => c.name === "lodos_sb")!;
    expect(sb).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 86_400,
    });
    expect(cookie(res, "lodos_sid")).toBeTruthy();
    const me = await t.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { lodos_sid: cookie(res, "lodos_sid")! },
    });
    expect(me.json().staff).toMatchObject({ name: "Kitchen", role: "kitchen" });
    expect((await sandboxIds(t)).some((id) => /^sb_[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it("maps every role to its seeded staff and redirect, and reuses the sandbox", async () => {
    const first = await signIn(t, "waiter");
    const sb = cookie(first, "lodos_sb")!;
    const before = (await sandboxIds(t)).length;
    const expected = {
      waiter: ["/staff/floor", "Deniz", "waiter"],
      kitchen: ["/staff/kitchen", "Kitchen", "kitchen"],
      bar: ["/staff/bar", "Bar", "bar"],
      manager: ["/staff/menu", "Selin", "manager"],
    } as const;
    for (const [role, [redirect, name]] of Object.entries(expected)) {
      const res = await signIn(t, role, { lodos_sb: sb });
      expect(res.json()).toEqual({ redirect });
      expect(cookie(res, "lodos_sb")).toBeUndefined();
      const me = await t.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { lodos_sid: cookie(res, "lodos_sid")! },
      });
      expect(me.json().staff.name).toBe(name);
    }
    expect((await sandboxIds(t)).length).toBe(before);
  });

  it("replaces an existing lodos_sid session", async () => {
    const a = await signIn(t, "waiter");
    const sb = cookie(a, "lodos_sb")!;
    const oldSid = cookie(a, "lodos_sid")!;
    const b = await signIn(t, "manager", { lodos_sb: sb, lodos_sid: oldSid });
    const old = await t.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { lodos_sid: oldSid },
    });
    expect(old.statusCode).toBe(401);
    expect(cookie(b, "lodos_sid")).not.toBe(oldSid);
  });

  it("gives a tampered sandbox cookie a fresh sandbox", async () => {
    const a = await signIn(t, "waiter");
    const sb = cookie(a, "lodos_sb")!;
    const b = await signIn(t, "waiter", { lodos_sb: sb.slice(0, -2) + "xx" });
    const fresh = cookie(b, "lodos_sb")!;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(sb);
  });

  it("guest gets the T7 redirect, creates no staff session, and the token resolves T7", async () => {
    const res = await signIn(t, "guest");
    const redirect = res.json().redirect as string;
    expect(redirect).toMatch(/^\/t\//);
    expect(cookie(res, "lodos_sid") ?? "").toBe("");
    const tenantId = (await unscoped("test", () => t.models.Sandbox.find({}).sort({ createdAt: -1 }).lean()))[0]!._id;
    const again = await signIn(t, "guest", {
      lodos_sb: cookie(res, "lodos_sb")!,
    });
    expect(again.json().redirect).toBe(redirect);
    const table = await unscoped("test", () => t.models.Table.findOne({ token: redirect.slice(3) }).lean());
    expect(table).toMatchObject({ name: "T7" });
    expect(await runWithTenant(table!.tenantId, () => t.models.Session.countDocuments({}))).toBe(0);
    expect(typeof tenantId).toBe("string");
  });

  it("serves info and simulator toggle for the visitor's sandbox", async () => {
    const res = await signIn(t, "guest");
    const cookies = { lodos_sb: cookie(res, "lodos_sb")! };
    const info = await t.inject({
      method: "GET",
      url: "/api/demo/info",
      cookies,
    });
    expect(info.json()).toEqual({
      guestUrl: res.json().redirect,
      simulatorOn: true,
    });
    const off = await t.inject({
      method: "POST",
      url: "/api/demo/simulator",
      cookies,
      payload: { on: false },
    });
    expect(off.json()).toEqual({ simulatorOn: false });
    expect((await t.inject({ method: "GET", url: "/api/demo/info", cookies })).json().simulatorOn).toBe(false);
    expect((await t.inject({ method: "GET", url: "/api/demo/info" })).statusCode).toBe(401);
  });

  it("keeps a fresh sandbox under 6,000 documents", async () => {
    const res = await signIn(t, "manager");
    const val = decodeURIComponent(cookie(res, "lodos_sb")!);
    const tenantId = val.slice(0, val.lastIndexOf(".")).replace(/^s:/, "");
    const n = await countAll(t, tenantId);
    expect(n).toBeGreaterThan(1_000); // four months of demo history
    expect(n).toBeLessThan(6_000);
  });

  it("rejects an unknown role", async () => {
    expect((await signIn(t, "chef")).statusCode).toBe(400);
  });
});

describe("cleanup", () => {
  let t: T;
  beforeAll(async () => {
    t = await makeTestApp({
      now: NOW,
      demoMode: true,
      sandboxesPerIpHour: 1000,
    });
  });
  afterAll(() => t.close());

  const make = async () => {
    const res = await signIn(t, "waiter");
    const id = (await unscoped("test", () => t.models.Sandbox.find({}).sort({ createdAt: -1, _id: 1 }).lean())).at(
      -1,
    )!._id;
    // find the sandbox that matches this cookie
    const val = decodeURIComponent(cookie(res, "lodos_sb")!);
    const tenantId = val.slice(0, val.lastIndexOf(".")).replace(/^s:/, "");
    expect(id).toBeTruthy();
    return tenantId;
  };

  it("keeps a sandbox idle for 29 min and deletes one idle for 31 min, emptying every collection", async () => {
    const id = await make();
    expect(await countAll(t, id)).toBeGreaterThan(0);
    await unscoped("test", () =>
      t.models.Sandbox.updateOne({ _id: id }, { lastSeenAt: new Date(NOW.getTime() - 29 * MIN) }),
    );
    expect(await runCleanup(t.models, NOW, () => false)).toBe(0);
    expect(await countAll(t, id)).toBeGreaterThan(0);
    await unscoped("test", () =>
      t.models.Sandbox.updateOne({ _id: id }, { lastSeenAt: new Date(NOW.getTime() - 31 * MIN) }),
    );
    expect(await runCleanup(t.models, NOW, () => true)).toBe(0);
    expect(await runCleanup(t.models, NOW, () => false)).toBe(1);
    expect(await countAll(t, id)).toBe(0);
    expect(await unscoped("test", () => t.models.Sandbox.countDocuments({ _id: id }))).toBe(0);
  });

  it("deletes a connected sandbox once it is older than 24 h", async () => {
    const id = await make();
    const set = (ms: number) =>
      unscoped("test", () => t.models.Sandbox.updateOne({ _id: id }, { createdAt: new Date(NOW.getTime() - ms) }));
    await set(24 * H);
    expect(await runCleanup(t.models, NOW, () => true)).toBe(0);
    await set(24 * H + 1000);
    expect(await runCleanup(t.models, NOW, () => true)).toBe(1);
    expect(await countAll(t, id)).toBe(0);
  });

  it("deleteSandbox leaves other sandboxes untouched", async () => {
    const a = await make();
    const b = await make();
    const before = await countAll(t, b);
    await deleteSandbox(t.models, a);
    expect(await countAll(t, a)).toBe(0);
    expect(await countAll(t, b)).toBe(before);
  });
});

describe("demo mode off", () => {
  it("/api/demo/* is 404", async () => {
    const t = await makeTestApp({ now: NOW });
    try {
      expect((await signIn(t, "guest")).statusCode).toBe(404);
      expect((await t.inject({ method: "GET", url: "/api/demo/info" })).statusCode).toBe(404);
      expect(
        (
          await t.inject({
            method: "POST",
            url: "/api/demo/simulator",
            payload: { on: true },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await t.close();
    }
  });
});
