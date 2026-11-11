import { describe, expect, it } from "vitest";
import { unscoped } from "../src/db/tenancy";
import { DEFAULT_MAX_SANDBOXES, DEFAULT_SANDBOXES_PER_IP_HOUR } from "../src/demo/sandboxes";
import { makeTestApp } from "./helpers";
import { countAll, H, MIN, NOW, sandboxIds, signIn } from "./sandbox-helpers";

// These create up to 7 sandboxes each (seed + 60 days of history), so they get more than the default 5 s.
describe("cap and per-IP limit", { timeout: 20_000 }, () => {
  it("defaults are 200 sandboxes and 5 creations per IP per hour", () => {
    expect(DEFAULT_MAX_SANDBOXES).toBe(200);
    expect(DEFAULT_SANDBOXES_PER_IP_HOUR).toBe(5);
  });

  it("evicts the oldest idle sandbox at the cap, and answers 503 demo_busy when none is idle", async () => {
    const t = await makeTestApp({
      now: NOW,
      demoMode: true,
      sandboxesPerIpHour: 1000,
      maxSandboxes: 3,
    });
    try {
      await unscoped("test", () => t.models.Sandbox.deleteMany({}));
      for (let i = 0; i < 3; i++) await signIn(t, "guest");
      const ids = await sandboxIds(t);
      expect(ids).toHaveLength(3);
      const idle = ids[0]!;
      await unscoped("test", () =>
        t.models.Sandbox.updateOne({ _id: idle }, { lastSeenAt: new Date(NOW.getTime() - 3 * MIN) }),
      );

      const ok = await signIn(t, "guest");
      expect(ok.statusCode).toBe(200);
      const after = await sandboxIds(t);
      expect(after).toHaveLength(3);
      expect(after).not.toContain(idle);
      expect(await countAll(t, idle)).toBe(0);

      // Idle by lastSeenAt but connected: not evictable.
      await unscoped("test", () => t.models.Sandbox.updateMany({}, { lastSeenAt: new Date(NOW.getTime() - 3 * MIN) }));
      t.app.presence.isConnected = () => true;
      const busy = await signIn(t, "guest");
      expect(busy.statusCode).toBe(503);
      expect(busy.json().error.code).toBe("demo_busy");
      expect(await sandboxIds(t)).toHaveLength(3);

      // Recently seen and disconnected: not idle either.
      t.app.presence.isConnected = () => false;
      await unscoped("test", () => t.models.Sandbox.updateMany({}, { lastSeenAt: new Date(NOW.getTime() - MIN) }));
      expect((await signIn(t, "guest")).statusCode).toBe(503);
    } finally {
      await t.close();
    }
  });

  it("limits creation per IP: the 6th within the hour is 429, other IPs are unaffected", async () => {
    const t = await makeTestApp({ now: NOW, demoMode: true });
    try {
      for (let i = 0; i < 5; i++) expect((await signIn(t, "guest", {}, "10.0.0.1")).statusCode).toBe(200);
      const sixth = await signIn(t, "guest", {}, "10.0.0.1");
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error.code).toBe("rate_limited");
      expect((await signIn(t, "guest", {}, "10.0.0.2")).statusCode).toBe(200);
      t.clock.advance(H + 1000);
      expect((await signIn(t, "guest", {}, "10.0.0.1")).statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  it("honours a raised per-IP limit", async () => {
    const t = await makeTestApp({
      now: NOW,
      demoMode: true,
      sandboxesPerIpHour: 6,
    });
    try {
      for (let i = 0; i < 6; i++) expect((await signIn(t, "guest", {}, "10.0.9.9")).statusCode).toBe(200);
      expect((await signIn(t, "guest", {}, "10.0.9.9")).statusCode).toBe(429);
    } finally {
      await t.close();
    }
  });
});
