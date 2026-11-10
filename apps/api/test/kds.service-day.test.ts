import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { serviceDayStart } from "../src/kds/service";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp } from "./helpers";

// 06:00 Istanbul on 2026-11-10 is 03:00Z.
const SIX = new Date("2026-11-10T03:00:00Z");
let t: Awaited<ReturnType<typeof makeTestApp>>;
let sid: string;

beforeAll(async () => {
  t = await makeTestApp({ now: SIX });
  const seed = await seedRestaurant(t.models, "main", SIX, { liveService: true });
  const res = await t.inject({ method: "POST", url: "/api/auth/pin", payload: { staffId: seed.staff.kitchen, pin: "3333" }, remoteAddress: "10.8.0.1" });
  sid = res.cookies.find((c) => c.name === "lodos_sid")!.value;
});
afterAll(() => t.close());

describe("service day boundaries", () => {
  it("serviceDayStart is 06:00 Istanbul", () => {
    expect(serviceDayStart(SIX).toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(serviceDayStart(new Date("2026-11-10T02:59:00Z")).toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(serviceDayStart(new Date("2026-11-10T20:00:00Z")).toISOString()).toBe("2026-11-10T03:00:00.000Z");
  });

  it("a ticket readied at 05:59 Istanbul is not in Done at 06:00, one readied at 06:00 is", async () => {
    await runWithTenant("main", async () => {
      await t.models.Ticket.deleteMany({});
      const base = { orderId: t.models.Order.base.Types.ObjectId.createFromTime(1), checkId: t.models.Order.base.Types.ObjectId.createFromTime(2), tableId: t.models.Order.base.Types.ObjectId.createFromTime(3), tableName: "T1", station: "kitchen" as const, status: "ready" as const, items: [] };
      await t.models.Ticket.create([
        { ...base, sentAt: new Date("2026-11-10T02:40:00Z"), readyAt: new Date("2026-11-10T02:59:00Z"), servedAt: new Date("2026-11-10T02:59:30Z") },
        { ...base, sentAt: new Date("2026-11-10T02:50:00Z"), readyAt: SIX },
      ]);
    });
    const res = await t.inject({ method: "GET", url: "/api/kds/kitchen?tab=done", cookies: { lodos_sid: sid } });
    const done = res.json().tickets as { readyAt: string }[];
    expect(done.map((x) => x.readyAt)).toEqual([SIX.toISOString()]);
  });

  it("N left set on the previous service day does not appear in eightySix after 06:00", async () => {
    await runWithTenant("main", async () => {
      await t.models.Availability.deleteMany({});
      const item = await t.models.MenuItem.findOne({ station: "kitchen" }).orFail();
      await t.models.Availability.create({ serviceDay: "2026-11-09", itemId: item._id, soldOut: false, remaining: 3 });
    });
    const res = await t.inject({ method: "GET", url: "/api/kds/kitchen", cookies: { lodos_sid: sid } });
    expect(res.json().eightySix).toEqual([]);
  });
});
