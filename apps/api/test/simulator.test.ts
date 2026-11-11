import { serviceDayOf } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant, unscoped } from "../src/db/tenancy";
import { runSimulatorDue, tickSimulator } from "../src/demo/simulator";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant } from "./helpers";

const NOW = new Date("2026-11-10T18:30:00Z");
let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW, demoMode: true });
});
afterAll(() => t.close());

const seq = () => {
  let i = 0;
  const xs = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.6];
  return () => xs[i++ % xs.length]!;
};
const mkSandbox = async (extra: object = {}) => {
  const id = newTenant();
  await seedRestaurant(t.models, id, NOW, { liveService: true, history: false });
  await unscoped("test", () => t.models.Sandbox.create({ _id: id, createdAt: NOW, lastSeenAt: NOW, ...extra }));
  return id;
};
const sandbox = (id: string) => unscoped("test", () => t.models.Sandbox.findById(id).lean());
const orders = (id: string) => runWithTenant(id, () => t.models.Order.find().lean());

describe("tickSimulator", () => {
  it("places one QR order away from T7, skips sold-out items, schedules next within 180-300 s", async () => {
    const id = await mkSandbox();
    const soldIds = await runWithTenant(id, async () => {
      const items = await t.models.MenuItem.find().lean();
      const half = items.slice(0, Math.floor(items.length / 2));
      for (const i of half)
        await t.models.Availability.updateOne(
          { serviceDay: serviceDayOf(NOW), itemId: i._id },
          { $set: { soldOut: true, remaining: null }, $setOnInsert: { tenantId: id } },
          { upsert: true },
        );
      return new Set(half.map((i) => String(i._id)));
    });
    const before = (await orders(id)).length;
    expect(await tickSimulator(t.models, t.app.realtime, id, NOW, seq())).toBe("placed");
    const after = await orders(id);
    expect(after).toHaveLength(before + 1);
    const newest = after[after.length - 1]!; // the seed's orders are older, insertion order is creation order
    const table = await runWithTenant(id, () => t.models.Table.findById(newest.tableId).lean());
    expect(table!.name).not.toBe("T7");
    expect(newest.placedBy ?? null).toBeNull();
    for (const line of newest.items) expect(soldIds.has(String(line.itemId))).toBe(false);
    const s = await sandbox(id);
    const gap = (s!.nextSimAt!.getTime() - NOW.getTime()) / 1000;
    expect(gap).toBeGreaterThanOrEqual(180);
    expect(gap).toBeLessThanOrEqual(300);
  });

  it("skips when no tables are seated and still schedules", async () => {
    const id = await mkSandbox();
    await runWithTenant(id, () => t.models.Check.deleteMany({}));
    expect(await tickSimulator(t.models, t.app.realtime, id, NOW, seq())).toBe("skipped");
    const before = (await orders(id)).length;
    expect(await tickSimulator(t.models, t.app.realtime, id, NOW, seq())).toBe("skipped");
    expect(await orders(id)).toHaveLength(before);
    expect((await sandbox(id))!.nextSimAt).toBeInstanceOf(Date);
  });
});

describe("runSimulatorDue", { timeout: 20_000 }, () => {
  it("ticks only connected, enabled, due sandboxes", async () => {
    const on = await mkSandbox();
    const off = await mkSandbox({ simulatorOn: false });
    const away = await mkSandbox();
    const later = await mkSandbox({ nextSimAt: new Date(NOW.getTime() + 60_000) });
    const base = async (id: string) => (await orders(id)).length;
    const b = await Promise.all([on, off, away, later].map(base));
    const connected = new Set([on, off, later]);
    const n = await runSimulatorDue(t.models, t.app.realtime, NOW, (id) => connected.has(id), seq());
    expect(n).toBeGreaterThanOrEqual(1);
    const a = await Promise.all([on, off, away, later].map(base));
    expect(a[0]).toBe(b[0]! + 1);
    expect(a[1]).toBe(b[1]);
    expect(a[2]).toBe(b[2]);
    expect(a[3]).toBe(b[3]);
  });
});
