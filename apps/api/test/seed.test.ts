import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serviceDayOf, serviceDayStartOf, splitByStation, TABLE_NAME_RE, ticketAgeState } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { billsOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { summarizeDay } from "../src/sales/summary";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { makeTestApp, newTenant } from "./helpers";

const NOW = new Date("2026-11-10T18:30:00Z"); // 21:30 in Istanbul
const PHOTOS = resolve(__dirname, "../../web/public");
const FOOD_CATS = ["To share", "Raw bar", "From the fire", "Sides", "Desserts"];
const DRINK_CATS = ["Cocktails", "Wine", "Zero-proof"];

let t: Awaited<ReturnType<typeof makeTestApp>>;
const live = newTenant();
const dry = newTenant();
const other = newTenant();
let liveRes: SeedResult;
let dryRes: SeedResult;
let otherRes: SeedResult;

const inTenant = <T>(id: string, fn: () => Promise<T>) => runWithTenant(id, fn);

beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  liveRes = await seedRestaurant(t.models, live, NOW, { liveService: true });
  dryRes = await seedRestaurant(t.models, dry, NOW, { liveService: false });
  otherRes = await seedRestaurant(t.models, other, NOW, { liveService: true });
});
afterAll(() => t.close());

describe("seedRestaurant content", () => {
  it("creates 21 tables with valid names, section staff and unique long tokens", async () => {
    const names = Object.keys(liveRes.tables);
    expect(names).toHaveLength(21);
    expect(names.every((n) => TABLE_NAME_RE.test(n))).toBe(true);
    const tokens = Object.values(liveRes.tables).map((x) => x.token);
    expect(new Set(tokens).size).toBe(21);
    expect(tokens.every((tk) => tk.length >= 43)).toBe(true);
    const tables = await inTenant(live, () => t.models.Table.find().lean());
    expect(tables.every((x) => x.sectionStaffId)).toBe(true);
    const deniz = tables.filter((x) => String(x.sectionStaffId) === liveRes.staff.waiter).map((x) => x.name);
    expect(deniz).toContain("T7");
    expect(deniz.length).toBeGreaterThanOrEqual(8);
    expect(deniz.length).toBeLessThanOrEqual(13);
  });

  it("has localized items in the right station and category, with photos on disk", async () => {
    const { Category, MenuItem } = t.models;
    const cats = await inTenant(live, () => Category.find().sort({ sort: 1 }).lean());
    expect(cats.map((c) => c.name.en)).toEqual([...FOOD_CATS, ...DRINK_CATS]);
    const items = await inTenant(live, () => MenuItem.find().lean());
    expect(items.length).toBeGreaterThanOrEqual(30);
    const catName = new Map(cats.map((c) => [String(c._id), c.name.en]));
    for (const it of items) {
      expect(it.name.en.length).toBeGreaterThan(0);
      expect(it.name.tr.length).toBeGreaterThan(0);
      expect(it.description.tr.length).toBeGreaterThan(0);
      expect(it.photo).toMatch(/^\/photos\/[a-z0-9-]+\.jpg$/);
      expect(existsSync(resolve(PHOTOS, `.${it.photo}`))).toBe(true);
      const c = catName.get(String(it.categoryId)) ?? "";
      expect(it.station).toBe(FOOD_CATS.includes(c) ? "kitchen" : "bar");
      expect(Number.isInteger(it.price)).toBe(true);
    }
    const groups = (en: string) => items.find((i) => i.name.en.startsWith(en))?.optionGroups ?? [];
    expect(groups("Dry-aged ribeye")[0]).toMatchObject({ id: "doneness", type: "single", required: true });
    expect(groups("Levrek")[0]).toMatchObject({ type: "multi", required: false });
    expect(groups("Levrek")[0]?.options.some((o) => o.priceDelta === 18_000)).toBe(true);
    expect(groups("Lodos Negroni")[0]).toMatchObject({ id: "gin", type: "single", required: true });
    expect(groups("Kalecik")[0]).toMatchObject({ id: "size", type: "single", required: true });
  });

  it("hashes PINs with argon2id and stores roles; the schedule-only team has no PIN", async () => {
    const staff = await inTenant(live, () => t.models.Staff.find().lean());
    const signIn = staff.filter((s) => s.pinHash);
    expect(signIn.map((s) => `${s.name}:${s.role}`).sort()).toEqual(
      ["Bar:bar", "Deniz:waiter", "Kitchen:kitchen", "Mert:waiter", "Selin:manager"].sort(),
    );
    expect(signIn.every((s) => s.pinHash!.startsWith("$argon2id$"))).toBe(true);
    expect(staff.filter((s) => !s.pinHash).map((s) => `${s.name}:${s.role}`).sort()).toEqual(
      [
        "Emre Yıldız:cook", "Zeynep Arslan:cook", "Burak Şahin:cook", "Ece Demir:bartender", "Can Özkan:bartender",
        "İpek Aydın:host", "Hasan Kılıç:dishwasher",
      ].sort(),
    );
    expect(staff.filter((s) => s.demoProtected).map((s) => s.name).sort()).toEqual(["Bar", "Deniz", "Kitchen", "Selin"]);
    expect(Object.keys(liveRes.staff).sort()).toEqual(["bar", "kitchen", "manager", "waiter", "waiter2"]);
  });

  it("stores the settings and keeps tenants isolated with disjoint tokens", async () => {
    const s = await inTenant(live, () => t.models.Setting.findOne().lean());
    expect(s).toMatchObject({ warnMin: 8, lateMin: 15 });
    const a = new Set(Object.values(liveRes.tables).map((x) => x.token));
    expect(Object.values(otherRes.tables).some((x) => a.has(x.token))).toBe(false);
    expect(await inTenant(live, () => t.models.Table.countDocuments())).toBe(21);
  });
});

describe("liveService: false", () => {
  it("creates no checks, orders, tickets or calls", async () => {
    const { Check, Order, Ticket, Call, Availability } = t.models;
    for (const M of [Check, Order, Ticket, Call, Availability]) {
      expect(await inTenant(dry, () => M.countDocuments())).toBe(0);
    }
    expect(Object.keys(dryRes.tables)).toHaveLength(21);
  });
});

describe("liveService: true", () => {
  it("seats 7 tables 10 to 95 minutes ago, leaving T7 free", async () => {
    const checks = await inTenant(live, () => t.models.Check.find({ status: "open" }).lean());
    expect(checks).toHaveLength(7);
    for (const c of checks) {
      const ago = (NOW.getTime() - c.openedAt.getTime()) / 60_000;
      expect(ago).toBeGreaterThanOrEqual(10);
      expect(ago).toBeLessThanOrEqual(95);
      expect(c.covers).toBeGreaterThan(0);
    }
    expect(checks.some((c) => String(c.tableId) === liveRes.tables.T7?.id)).toBe(false);
  });

  it("has exactly 2 late and 1 warn among active tickets, and one ready, unserved ticket", async () => {
    const tickets = await inTenant(live, () => t.models.Ticket.find().lean());
    const active = tickets.filter((x) => x.status === "new" || x.status === "started");
    expect(active).toHaveLength(6);
    const states = active.map((x) => ticketAgeState(x.sentAt, NOW));
    expect(states.filter((s) => s === "late")).toHaveLength(2);
    expect(states.filter((s) => s === "warn")).toHaveLength(1);
    const late = active.filter((x) => ticketAgeState(x.sentAt, NOW) === "late").map((x) => Math.round((NOW.getTime() - x.sentAt.getTime()) / 60_000));
    expect(late.sort()).toEqual([16, 18]);
    const readyUnserved = tickets.filter((x) => x.status === "ready" && x.servedAt === null);
    expect(readyUnserved).toHaveLength(1);
    expect(readyUnserved[0]?.readyAt).toBeInstanceOf(Date);
    expect(readyUnserved[0]?.tableName).toBe("B2");
    for (const x of tickets.filter((y) => y.servedAt)) {
      expect(x.status).toBe("ready");
      expect(x.readyAt && x.readyAt >= x.sentAt && x.servedAt && x.servedAt >= x.readyAt && x.servedAt < NOW).toBe(true);
    }
  });

  it("gives every order one ticket per station it uses", async () => {
    const [orders, tickets] = await inTenant(live, () => Promise.all([t.models.Order.find().lean(), t.models.Ticket.find().lean()]));
    for (const o of orders) {
      const mine = tickets.filter((x) => String(x.orderId) === String(o._id));
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.map((x) => x.station).sort()).toEqual([...new Set(o.items.map((l) => l.station))].sort());
      for (const tk of mine) {
        expect(tk.items.every((l) => o.items[l.orderItemIndex]?.station === tk.station)).toBe(true);
      }
      expect(mine.flatMap((x) => x.items.map((l) => l.orderItemIndex)).sort()).toEqual(o.items.map((_, i) => i));
    }
  });

  it("keeps tickets, orders and checks consistent", async () => {
    const { Ticket, Order, Check, MenuItem } = t.models;
    const [tickets, orders, checks, items] = await inTenant(live, () =>
      Promise.all([Ticket.find().lean(), Order.find().lean(), Check.find().lean(), MenuItem.find().lean()]),
    );
    const staff = await inTenant(live, () => t.models.Staff.find().lean());
    const staffName = new Map(staff.map((s) => [String(s._id), s.name]));
    const orderById = new Map(orders.map((o) => [String(o._id), o]));
    const checkById = new Map(checks.map((c) => [String(c._id), c]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    for (const tk of tickets) {
      const o = orderById.get(String(tk.orderId));
      expect(o).toBeDefined();
      expect(["open", "paid"]).toContain(checkById.get(String(o?.checkId))?.status); // paid: tonight's closed checks
      expect(String(tk.checkId)).toBe(String(o?.checkId));
      for (const [i, line] of tk.items.entries()) {
        const l = o?.items[line.orderItemIndex];
        expect(l?.station).toBe(tk.station);
        expect(tk.items[i]?.name.en).toBe(l?.name.en);
        expect(tk.items[i]?.options).toHaveLength(l?.options.length ?? -1);
      }
      const server = staffName.get(String(checkById.get(String(tk.checkId))?.serverStaffId));
      if (o?.source === "staff") {
        expect(tk.serverName).toBe(server);
        expect(staffName.get(String(o.placedBy))).toBe(server);
      } else {
        expect(tk.serverName).toBeNull();
        expect(o?.placedBy).toBeNull();
      }
    }
    for (const c of checks) {
      expect(c.orderCount).toBe(orders.filter((o) => String(o.checkId) === String(c._id)).length);
    }
    for (const o of orders) {
      const split = splitByStation(o.items);
      expect((split.kitchen?.length ?? 0) + (split.bar?.length ?? 0)).toBe(o.items.length);
      for (const l of o.items) {
        const it = itemById.get(String(l.itemId));
        expect(l.station).toBe(it?.station);
        expect(l.unitPrice).toBe(it?.price);
        expect(l.lineTotal).toBe((l.unitPrice + l.options.reduce((s, x) => s + x.priceDelta, 0)) * l.qty);
      }
    }
  });

  it("has a wine call, a bill request by card, and sold-out items for the service day", async () => {
    const { Call, Check, Availability } = t.models;
    const calls = await inTenant(live, () => Call.find({ answeredAt: null }).lean());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ reason: "wine" });
    expect((NOW.getTime() - (calls[0]?.openedAt.getTime() ?? 0)) / 60_000).toBe(1);
    const bills = await inTenant(live, () => Check.find({ billRequestedAt: { $ne: null } }).lean());
    expect(bills).toHaveLength(1);
    expect(bills[0]?.billMethod).toBe("card");
    const av = await inTenant(live, () => Availability.find().lean());
    expect(av.every((a) => a.serviceDay === serviceDayOf(NOW))).toBe(true);
    expect(av.filter((a) => a.soldOut)).toHaveLength(2);
    expect(av.filter((a) => a.remaining === 2)).toHaveLength(1);
  });

  it("has 60 days of generated history, and 3-5 paid checks closed earlier tonight that agree with the bill reader", async () => {
    expect(await inTenant(live, () => t.models.DailySummary.countDocuments({ generated: true }))).toBe(60);
    const paid = await inTenant(live, () => t.models.Check.find({ status: "paid" }).lean());
    expect(paid.length).toBeGreaterThanOrEqual(3);
    expect(paid.length).toBeLessThanOrEqual(5);
    const dayStart = serviceDayStartOf(serviceDayOf(NOW)).getTime();
    const open = new Set((await inTenant(live, () => t.models.Check.find({ status: "open" }).lean())).map((c) => String(c.tableId)));
    const bills = await inTenant(live, () => billsOf(t.models, paid.map((c) => c._id)));
    for (const c of paid) {
      expect(open.has(String(c.tableId))).toBe(false);
      expect(c.closedAt!.getTime()).toBeGreaterThanOrEqual(dayStart + 11.5 * 3_600_000);
      expect(c.closedAt!.getTime()).toBeLessThan(NOW.getTime());
      expect(c.openedAt.getTime()).toBeLessThan(c.closedAt!.getTime());
      expect(c.payment?.at).toEqual(c.closedAt);
      expect(c.payment?.amount).toBe(bills.get(String(c._id))?.total);
      expect(c.payment?.amount).toBeGreaterThan(0);
      const tk = await inTenant(live, () => t.models.Ticket.find({ checkId: c._id }).lean());
      expect(tk.length).toBeGreaterThan(0);
      expect(tk.every((x) => x.status === "ready" && x.servedAt && x.readyAt && x.readyAt >= x.sentAt)).toBe(true);
    }
    const comps = await inTenant(live, () => t.models.Adjustment.find({ checkId: { $ne: null }, kind: "comp" }).lean());
    expect(comps).toHaveLength(1);
    expect(bills.get(String(comps[0]!.checkId))?.compsAmount).toBe(comps[0]!.amount);
    const today = await inTenant(live, () => summarizeDay(t.models, serviceDayOf(NOW)));
    expect(today.revenue).toBe(paid.reduce((s, c) => s + (c.payment?.amount ?? 0), 0));
    expect(today.checks).toBe(paid.length);
    expect(today.comps.count).toBe(1);
  });

  it("seeds no paid checks before 18:00 Istanbul", async () => {
    const id = newTenant();
    await seedRestaurant(t.models, id, new Date("2026-11-10T14:30:00Z"), { liveService: true }); // 17:30
    expect(await inTenant(id, () => t.models.Check.countDocuments({ status: "paid" }))).toBe(0);
  });

  it("seeds quickly", async () => {
    const start = performance.now();
    await seedRestaurant(t.models, newTenant(), NOW, { liveService: true });
    // Guards against accidental N+1 inserts (hundreds of ms of sequential writes), not micro-performance: generous bound.
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
