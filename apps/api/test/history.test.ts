import { COMP_REASONS, serviceDayOf, serviceDayStartOf, VOID_REASONS } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { generateHistory } from "../src/sales/history";
import { ensureSummaries } from "../src/sales/summary";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant } from "./helpers";

const NOW = new Date("2026-11-10T18:30:00Z"); // 21:30 in Istanbul, a Tuesday

let t: Awaited<ReturnType<typeof makeTestApp>>;
const a = newTenant();
const b = newTenant();
const c = newTenant();

async function generate(tenantId: string, now: Date) {
  await seedRestaurant(t.models, tenantId, now, { liveService: false });
  await runWithTenant(tenantId, async () => {
    const [menu, tables, staff] = await Promise.all([
      t.models.MenuItem.find().lean(),
      t.models.Table.find().lean(),
      t.models.Staff.find().lean(),
    ]);
    const slugOf = (photo: string) => photo.replace("/photos/", "").replace(".jpg", "");
    await generateHistory(t.models, {
      tenantId,
      now,
      items: menu.map((m) => ({ id: m._id, slug: slugOf(m.photo ?? ""), name: m.name, price: m.price, station: m.station })),
      tables: tables.map((x) => x.name),
      staff: staff.map((s) => ({ id: s._id, name: s.name })),
    });
  });
}

const summaries = (id: string) =>
  runWithTenant(id, () => t.models.DailySummary.find({}, { _id: 0, __v: 0, tenantId: 0 }).sort({ serviceDay: 1 }).lean());
const adjustments = (id: string) =>
  runWithTenant(id, () => t.models.Adjustment.find({}, { _id: 0, __v: 0, tenantId: 0, requestedBy: 0, approvedBy: 0, itemId: 0 }).sort({ at: 1 }).lean());

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  await generate(a, NOW);
  await generate(b, NOW);
  await generate(c, new Date(NOW.getTime() + 3_600_000));
});
afterAll(() => t.close());

describe("generateHistory", () => {
  it("stores 60 generated summaries for the 60 service days before today", async () => {
    const docs = await summaries(a);
    expect(docs).toHaveLength(60);
    expect(docs.every((d) => d.generated)).toBe(true);
    const today = serviceDayOf(NOW);
    expect(docs[59]?.serviceDay).toBe(serviceDayOf(new Date(serviceDayStartOf(today).getTime() - 1)));
    expect(docs.some((d) => d.serviceDay >= today)).toBe(false);
  });

  it("is deterministic for the same now and differs for another", async () => {
    // Item ids are random per tenant; everything else must match.
    const plain = async (id: string) => JSON.parse(JSON.stringify(await summaries(id)).replace(/"itemId":"[0-9a-f]+"/g, '"itemId":"x"'));
    expect(await plain(a)).toEqual(await plain(b));
    expect(await adjustments(a)).toEqual(await adjustments(b));
    expect(await plain(a)).not.toEqual(await plain(c));
  });

  it("reconciles every day exactly", async () => {
    for (const d of await summaries(a)) {
      const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
      expect(sum(d.byHour.map((h) => h.revenue))).toBe(d.revenue);
      expect(sum(d.items.map((i) => i.revenue))).toBe(d.revenue);
      expect(d.payments.card + d.payments.cash).toBe(d.revenue);
      expect(sum(d.byHour.map((h) => h.covers))).toBe(d.covers);
      expect(sum(d.byHour.map((h) => h.checks))).toBe(d.checks);
      expect(sum(d.byHour.map((h) => h.comps))).toBe(d.comps.amount + d.voids.amount);
      expect(Number.isInteger(d.revenue)).toBe(true);
    }
  });

  it("keeps per-cover spend, covers, hours, ticket times and card share in range", async () => {
    for (const d of await summaries(a)) {
      if (d.revenue === 0) continue;
      const perCover = d.revenue / d.covers / 100;
      expect(perCover).toBeGreaterThanOrEqual(700);
      expect(perCover).toBeLessThanOrEqual(1000);
      expect(d.covers).toBeGreaterThanOrEqual(45);
      expect(d.covers).toBeLessThanOrEqual(110);
      expect(d.byHour.every((h) => h.hour >= 17 && h.hour <= 23)).toBe(true);
      const peak = [...d.byHour].sort((x, y) => y.revenue - x.revenue)[0]?.hour;
      expect([20, 21]).toContain(peak);
      for (const k of d.ticketTimes.kitchen) expect(k.totalMs / k.count / 60_000).toBeLessThanOrEqual(15);
      for (const k of d.ticketTimes.kitchen) expect(k.totalMs / k.count / 60_000).toBeGreaterThanOrEqual(9);
      for (const k of d.ticketTimes.bar) {
        expect(k.totalMs / k.count / 60_000).toBeGreaterThanOrEqual(4);
        expect(k.totalMs / k.count / 60_000).toBeLessThanOrEqual(7);
      }
      expect(d.payments.card / d.revenue).toBeGreaterThan(0.7);
      expect(d.payments.card / d.revenue).toBeLessThan(0.9);
    }
  });

  it("closes Mondays and sells about 1.6x more on Fri/Sat than Tue/Wed", async () => {
    const docs = await summaries(a);
    const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
    const mondays = docs.filter((d) => dow(d.serviceDay) === 1);
    expect(mondays.length).toBeGreaterThanOrEqual(8);
    expect(mondays.every((d) => d.revenue === 0 && d.covers === 0 && d.byHour.length === 0)).toBe(true);
    const avg = (days: number[]) => {
      const xs = docs.filter((d) => days.includes(dow(d.serviceDay)));
      return xs.reduce((s, d) => s + d.revenue, 0) / xs.length;
    };
    const ratio = avg([5, 6]) / avg([2, 3]);
    expect(ratio).toBeGreaterThan(1.45);
    expect(ratio).toBeLessThan(1.75);
  });

  it("weights items toward the signatures and uses menu items only", async () => {
    const docs = await summaries(a);
    const qty = new Map<string, number>();
    for (const d of docs) for (const i of d.items) qty.set(i.name.en, (qty.get(i.name.en) ?? 0) + i.qty);
    const top3 = [...qty.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n]) => n);
    expect(top3.join("|")).toMatch(/ribeye/i);
    expect(top3.join("|")).toMatch(/burrata/i);
    expect(top3.join("|")).toMatch(/negroni/i);
  });

  it("logs 10-16 entries over the last 30 days with real prices, and each day's comps equal its entries", async () => {
    const entries = await runWithTenant(a, () => t.models.Adjustment.find().lean());
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.length).toBeLessThanOrEqual(16);
    const prices = await runWithTenant(a, async () => new Set((await t.models.MenuItem.find().lean()).map((m) => m.price)));
    const cutoff = serviceDayStartOf(serviceDayOf(NOW)).getTime() - 30 * 24 * 3_600_000;
    for (const e of entries) {
      expect(e.checkId).toBeNull();
      expect(e.orderId).toBeNull();
      expect(e.itemIndex).toBeNull();
      expect(e.units).toEqual([]);
      expect(e.reversedAt).toBeNull();
      expect(e.at.getTime()).toBeGreaterThanOrEqual(cutoff);
      expect(e.serviceDay).toBe(serviceDayOf(e.at));
      expect(["Deniz", "Mert"]).toContain(e.requestedByName);
      expect(e.approvedByName).toBe("Selin");
      expect((e.kind === "comp" ? COMP_REASONS : VOID_REASONS) as readonly string[]).toContain(e.reason);
      const unit = e.amount / e.qty;
      expect(prices.has(unit)).toBe(true);
    }
    for (const d of await summaries(a)) {
      for (const kind of ["comp", "void"] as const) {
        const mine = entries.filter((e) => e.serviceDay === d.serviceDay && e.kind === kind);
        const sum = kind === "comp" ? d.comps : d.voids;
        expect(sum).toEqual({ count: mine.length, amount: mine.reduce((s, e) => s + e.amount, 0) });
      }
    }
  });

  it("is served as stored by ensureSummaries", async () => {
    const days = (await summaries(a)).map((d) => d.serviceDay);
    const out = await runWithTenant(a, () => ensureSummaries(t.models, days, serviceDayOf(NOW)));
    expect([...out.values()].every((d) => d.generated)).toBe(true);
  });
});
