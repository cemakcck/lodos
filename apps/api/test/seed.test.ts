import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { addDays, mondayOf, rateAt, serviceDayOf, serviceDayStartOf, splitByStation, TABLE_NAME_RE, ticketAgeState } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPin } from "../src/auth/pin";
import { createSession } from "../src/auth/sessions";
import { billsOf } from "../src/checks/bill";
import { runWithTenant } from "../src/db/tenancy";
import { opsForDays } from "../src/ops/daily";
import { summarizeDay } from "../src/sales/summary";
import { seedRestaurant, type SeedResult } from "../src/seed/seed";
import { labourForDays } from "../src/timeclock/service";
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

  it("has 120 days of generated history, and 3-5 paid checks closed earlier tonight that agree with the bill reader", async () => {
    expect(await inTenant(live, () => t.models.DailySummary.countDocuments({ generated: true }))).toBe(120);
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

  it("history: false (tests only) keeps the live service and paid checks but skips the generated history", async () => {
    const id = newTenant();
    await seedRestaurant(t.models, id, NOW, { liveService: true, history: false });
    expect(await inTenant(id, () => t.models.DailySummary.countDocuments({}))).toBe(0);
    expect(await inTenant(id, () => t.models.Adjustment.countDocuments({ checkId: null }))).toBe(0);
    const counts = async (tenant: string) => ({
      open: await inTenant(tenant, () => t.models.Check.countDocuments({ status: "open" })),
      paid: await inTenant(tenant, () => t.models.Check.countDocuments({ status: "paid" })),
      tickets: await inTenant(tenant, () => t.models.Ticket.countDocuments({})),
      staff: await inTenant(tenant, () => t.models.Staff.countDocuments({})),
      // The demo rewrites today's shifts and adds the past weeks' ones: compare the days after today.
      shifts: await inTenant(tenant, () => t.models.Shift.countDocuments({ serviceDay: { $gt: serviceDayOf(NOW) } })),
    });
    expect(await counts(id)).toEqual(await counts(live));
  });

  it("seeds quickly: a bounded number of batched writes, never one insert per document", async () => {
    // Counts database operations instead of timing the seed, so load on the machine cannot fail it.
    const ops: string[] = [];
    const conn = t.models.Tenant.db;
    conn.set("debug", (collection: string, method: string) => void ops.push(`${collection}.${method}`));
    try {
      await seedRestaurant(t.models, newTenant(), NOW, { liveService: true });
    } finally {
      conn.set("debug", false);
    }
    // A lower bound too: a debug hook that records nothing must fail this, not pass it vacuously.
    expect(ops.length).toBeGreaterThanOrEqual(10);
    expect(ops.every((op) => /\.insert(One|Many)$/.test(op))).toBe(true);
    expect(ops.length).toBeLessThanOrEqual(28); // 24 today: one or two batches per collection
    const perCollection = new Map<string, number>();
    for (const op of ops) perCollection.set(op.split(".")[0]!, (perCollection.get(op.split(".")[0]!) ?? 0) + 1);
    for (const c of [
      "tenants", "staffs", "rooms", "tables", "categories", "menuitems", "checks", "orders", "tickets", "shifts",
      "dailysummaries", "clockentries", "ratings", "expensecategories", "expenses",
    ]) {
      expect(perCollection.has(c), `${c} written`).toBe(true);
    }
    expect(Math.max(...perCollection.values())).toBeLessThanOrEqual(2);
  });
});

describe("demo ops seed (phase 3)", () => {
  const RAW_RATING_DAYS = 14;
  const RAW_CLOCK_DAYS = 35;
  const today = serviceDayOf(NOW);
  const dayMinus = (n: number) => addDays(today, -n);
  const A = newTenant();
  const B = newTenant();

  beforeAll(async () => {
    await seedRestaurant(t.models, A, NOW, { liveService: true });
    await seedRestaurant(t.models, B, NOW, { liveService: true });
  });

  const managerGet = async (tenantId: string, url: string) => {
    const manager = await inTenant(tenantId, () => t.models.Staff.findOne({ role: "manager" }).lean().orFail());
    const sid = await createSession(t.models, String(manager._id), tenantId, "person", t.clock.now());
    return t.inject({ method: "GET", url, cookies: { lodos_sid: sid } });
  };

  // 03:00 (the previous calendar day's service day), 11:00 and 21:00 Istanbul.
  for (const iso of ["2026-11-11T00:00:00Z", "2026-11-10T08:00:00Z", "2026-11-10T18:00:00Z"]) {
    it(`shows every "who's working" state at ${iso}`, async () => {
      const now = new Date(iso);
      const id = newTenant();
      await seedRestaurant(t.models, id, now, { liveService: true });
      t.clock.set(now);
      try {
        const res = await managerGet(id, "/api/business/overview");
        expect(res.statusCode, res.body).toBe(200);
        type W = { name: string; role: string; status: string; lateMin?: number; in?: string; shift?: { start: string; end: string } };
        const working = res.json().working as W[];
        const one = (role: string, status: string) => {
          const w = working.find((x) => x.role === role && x.status === status);
          expect(w, `${role} ${status} in ${JSON.stringify(working)}`).toBeDefined();
          return w!;
        };
        const minFromNow = (s: string) => Math.round((new Date(s).getTime() - now.getTime()) / 60_000);
        expect(minFromNow(one("waiter", "on_shift").in!)).toBe(-120);
        expect(one("cook", "late").lateMin).toBe(18);
        const due = one("bartender", "later");
        expect(minFromNow(due.shift!.start)).toBeGreaterThan(0);
        expect(minFromNow(due.shift!.start)).toBeLessThanOrEqual(180);
        expect(minFromNow(one("host", "missing").shift!.start)).toBe(-20);
        one("dishwasher", "finished");
        // Never before the service day's start.
        const dayStart = serviceDayStartOf(serviceDayOf(now)).getTime();
        for (const w of working) if (w.shift) expect(new Date(w.shift.start).getTime()).toBeGreaterThanOrEqual(dayStart);
        expect(working.some((w) => w.status === "forgot_out")).toBe(false);
        expect(working.filter((w) => w.status === "late")).toHaveLength(1);
        expect(working.filter((w) => w.status === "missing")).toHaveLength(1);
        // Today's anchored shifts push nobody past 45 h: Ece Demir's 47 h week stays the only hours warning. (A morning
        // `now` can put a shift under 11 h after last night's close: a rest warning is the honest result there.)
        const week = (await managerGet(id, "/api/shifts")).json() as { warnings: { kind: string; staffId: string }[]; people: { id: string; name: string }[] };
        const ece = week.people.find((p) => p.name === "Ece Demir")!.id;
        expect(week.warnings.filter((w) => w.kind !== "rest").map((w) => [w.kind, w.staffId])).toEqual([["week_hours", ece]]);
        // The week's timesheets read today's entries (open ones included) like any other.
        const sheets = await managerGet(id, `/api/timesheets?week=${mondayOf(serviceDayOf(now))}`);
        expect(sheets.statusCode, sheets.body).toBe(200);
        expect((sheets.json().people as { entries: unknown[] }[]).some((p) => p.entries.length > 0)).toBe(true);
      } finally {
        t.clock.set(NOW);
      }
    });
  }

  it("fills every section of last month's page, with stars, fix and hidden gems on the menu", async () => {
    const res = await managerGet(A, "/api/business/monthly?month=2026-10");
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    expect(v.current.days).toBe(31);
    for (const k of ["sales", "foodDrink", "labour", "other"]) expect(v.pnl.cur[k], k).toBeGreaterThan(0);
    expect(v.pnl.prev.sales).toBeGreaterThan(0);
    expect(v.pnl.cur.margin).toBeGreaterThan(0.05);
    expect(v.pnl.cur.margin).toBeLessThan(0.4);
    expect(v.sales.byDay.cur).toHaveLength(31);
    expect(v.sales.salesPerLabourHour.cur).toBeGreaterThan(0);
    const groups = new Set((v.menu as { group: string | null }[]).map((d) => d.group));
    for (const g of ["stars", "fix", "hidden_gems"]) expect(groups.has(g), g).toBe(true);
    const octopus = (v.menu as { name: { en: string }; group: string; ratingAvg: number }[]).find((d) => /octopus/i.test(d.name.en))!;
    expect(octopus.group).toBe("fix");
    expect(octopus.ratingAvg).toBeGreaterThan(3.1);
    expect(octopus.ratingAvg).toBeLessThan(3.7);
    for (const g of ["floor", "kitchen", "bar"]) {
      expect((v.staff as { group: string; score: number | null }[]).some((s) => s.group === g && s.score !== null), g).toBe(true);
    }
    for (const g of ["floor", "kitchen", "bar", "managers"]) expect(v.labourByGroup.cur[g], g).toBeGreaterThan(0);
    expect(v.overtimeMinutes.cur).toBeGreaterThan(0);
    expect(v.ratings.restaurant.cur).toBeGreaterThan(4.4);
    expect(v.ratings.restaurant.cur).toBeLessThan(4.8);
    expect(v.ratings.food.cur).toBeCloseTo(4.5, 0);
    expect(v.ratings.byWeek.cur.length).toBeGreaterThanOrEqual(5);
    expect(v.ratings.comments.length).toBeGreaterThan(0);
    for (const c of v.expenses.byCategory.cur as { spent: number; budget: number }[]) {
      expect(c.spent).toBeGreaterThan(0);
      expect(c.budget).toBeGreaterThan(0);
    }
    expect(v.expenses.biggest).toHaveLength(5);
  });

  it("is deterministic: the same now gives the same documents", async () => {
    const dump = async (tenantId: string) => {
      const m = t.models;
      const strip = { _id: 0, __v: 0, tenantId: 0 };
      const all = await inTenant(tenantId, () =>
        Promise.all([
          // Generated days only: reading a month stores the missing summaries before the history.
          m.DailySummary.find({ generated: true }, strip).sort({ serviceDay: 1 }).lean(),
          m.ClockEntry.find({}, strip).sort({ in: 1, staffId: 1 }).lean(),
          m.Rating.find({}, strip).sort({ submittedAt: 1 }).lean(),
          m.Expense.find({}, strip).sort({ date: 1, amount: 1 }).lean(),
          m.ExpenseCategory.find({}, strip).sort({ sort: 1 }).lean(),
          m.Shift.find({}, strip).sort({ start: 1, staffId: 1 }).lean(),
          m.Staff.find({}, { ...strip, pinHash: 0, clockPinHash: 0 }).sort({ name: 1 }).lean(),
        ]),
      );
      // Ids are random per tenant: number them by first appearance.
      const ids = new Map<string, number>();
      return JSON.stringify(all).replace(/[0-9a-f]{24}/g, (h) => `#${ids.get(h) ?? ids.set(h, ids.size).size - 1}`);
    };
    expect(await dump(A)).toEqual(await dump(B));
  });

  it("never counts a rating or a shift twice across raw documents and aggregates, and keeps the aggregates consistent with the day", async () => {
    const m = t.models;
    const [summaries, ratings, entries, shifts, staff] = await inTenant(A, () =>
      Promise.all([m.DailySummary.find({ generated: true }).lean(), m.Rating.find().lean(), m.ClockEntry.find().lean(), m.Shift.find().lean(), m.Staff.find().lean()]),
    );
    expect(summaries).toHaveLength(120);
    const rawRatingFrom = dayMinus(RAW_RATING_DAYS);
    const rawClockFrom = dayMinus(RAW_CLOCK_DAYS);
    expect(ratings.length).toBeGreaterThan(50);
    for (const r of ratings) {
      // Raw ratings: the last 14 days, plus each seeded comment on its own (older) day.
      expect(r.serviceDay < today, r.serviceDay).toBe(true);
      if (r.serviceDay < rawRatingFrom) expect(r.comment, r.serviceDay).toBeTruthy();
      expect(r).toMatchObject({ generated: true, checkId: null });
      expect(r.paidAt.getTime()).toBeLessThan(r.submittedAt.getTime());
      expect(serviceDayOf(r.paidAt)).toBe(r.serviceDay);
    }
    for (const e of entries) expect(e.serviceDay >= rawClockFrom && e.serviceDay <= today, e.serviceDay).toBe(true);
    // Every past shift is stored (planned hours), back to the start of the history.
    expect(shifts.some((s) => s.serviceDay <= dayMinus(114))).toBe(true);
    const roleOf = new Map(staff.map((s) => [String(s._id), s.role]));
    const rateOf = new Map(staff.map((s) => [String(s._id), s.rates]));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    let aggLate = 0;
    let aggShifts = 0;
    let aggOvertime = 0;
    for (const d of summaries) {
      const r = d.ratings!;
      const ratingCount = r.food.count + r.cleanliness.count + r.atmosphere.count + sum(r.waiter.map((w) => w.count)) + sum(r.dishes.map((x) => x.count));
      const open = d.checks > 0;
      if (d.serviceDay >= rawRatingFrom || !open) expect(ratingCount, d.serviceDay).toBe(0);
      else expect(ratingCount, d.serviceDay).toBeGreaterThan(0);
      // Waiter ratings never outnumber the server's checks, nor dish ratings the units sold.
      const dayRaw = ratings.filter((x) => x.serviceDay === d.serviceDay);
      for (const s of d.byServer) {
        const n = (r.waiter.find((w) => w.staffId === s.staffId)?.count ?? 0) + dayRaw.filter((x) => x.waiter && String(x.serverStaffId) === s.staffId).length;
        expect(n).toBeLessThanOrEqual(s.checks);
      }
      // Aggregate plus raw never double-counts: merged, the day has at most one rating per check.
      for (const c of ["food", "cleanliness", "atmosphere"] as const) expect(r[c].count + dayRaw.filter((x) => x[c] !== null).length).toBeLessThanOrEqual(d.checks);
      expect(dayRaw.length + Math.max(r.food.count, r.cleanliness.count, r.atmosphere.count)).toBeLessThanOrEqual(d.checks);
      if (d.serviceDay < rawRatingFrom) expect(dayRaw.length).toBeLessThanOrEqual(1);
      for (const x of r.dishes) expect(x.count).toBeLessThanOrEqual(d.items.find((i) => i.itemId === x.itemId)?.qty ?? 0);
      for (const x of r.dishes) expect(x.sum).toBe(sum(x.dist.map((n, i) => n * (i + 1))));
      // byServer splits the day exactly.
      expect(sum(d.byServer.map((s) => s.checks))).toBe(d.checks);
      expect(sum(d.byServer.map((s) => s.covers))).toBe(d.covers);
      expect(sum(d.byServer.map((s) => s.sales))).toBe(d.revenue);
      for (const s of d.byServer) expect(roleOf.get(s.staffId)).toBe("waiter");
      for (const st of ["kitchen", "bar"] as const) {
        for (const h of d.ticketTimes[st]) expect(h.onTime).toBeLessThanOrEqual(h.count);
        const people = d.people.filter((p) => (st === "kitchen" ? roleOf.get(p.staffId) === "cook" : roleOf.get(p.staffId) === "bartender"));
        const tickets = sum(d.ticketTimes[st].map((h) => h.count));
        expect(sum(people.map((p) => p.stationTickets))).toBeLessThanOrEqual(tickets + 1e-6);
        if (tickets > 0) expect(sum(people.map((p) => p.stationTickets))).toBeGreaterThan(0);
        for (const p of people) expect(p.stationOnTime).toBeLessThanOrEqual(p.stationTickets + 1e-9);
      }
      for (const p of d.people) {
        const role = roleOf.get(p.staffId);
        if (role !== "cook" && role !== "bartender") expect(p.stationTickets + p.dishRatingCount).toBe(0);
        if (d.serviceDay >= rawRatingFrom) expect(p.dishRatingCount).toBe(0);
        if (d.serviceDay >= rawClockFrom) {
          expect([p.minutes, p.overtimeMinutes, p.labourCost, p.shifts, p.lateShifts]).toEqual([0, 0, 0, 0, 0]);
        } else {
          // One shift a day at one rate (Mert's change is inside the raw window).
          const rate = rateOf.get(p.staffId)![0]!.kurusPerHour;
          expect(p.labourCost).toBe(Math.round((p.minutes * rate) / 60) + Math.round((p.overtimeMinutes * rate) / 120));
          aggShifts += p.shifts;
          aggLate += p.lateShifts;
          aggOvertime += p.overtimeMinutes;
          expect(shifts.filter((s) => String(s.staffId) === p.staffId && s.serviceDay === d.serviceDay)).toHaveLength(p.shifts);
        }
      }
    }
    expect(aggLate / aggShifts).toBeGreaterThan(0.03);
    expect(aggLate / aggShifts).toBeLessThan(0.14);
    // The one generated overtime week lies inside the raw clock window.
    expect(aggOvertime).toBe(0);
    // The ops reader counts each old shift once (from the aggregate), never again as a no-show from its Shift document.
    const oldDays = Array.from({ length: 120 - RAW_CLOCK_DAYS }, (_, i) => dayMinus(RAW_CLOCK_DAYS + 1 + i));
    const ops = await inTenant(A, () => opsForDays(t.models, oldDays, NOW));
    const opsShifts = sum([...ops.values()].flatMap((d) => d.people.map((p) => p.shifts)));
    const opsLate = sum([...ops.values()].flatMap((d) => d.people.map((p) => p.lateShifts)));
    expect(opsShifts).toBe(aggShifts);
    expect(opsLate).toBe(aggLate);
    expect(opsShifts).toBe(shifts.filter((s) => s.serviceDay < rawClockFrom).length);
    // A comment day's merged ratings are its aggregate plus its one raw comment.
    const old = ratings.find((x) => x.serviceDay < rawRatingFrom)!;
    const day = (await inTenant(A, () => opsForDays(t.models, [old.serviceDay], NOW))).get(old.serviceDay)!;
    const stored = summaries.find((x) => x.serviceDay === old.serviceDay)!.ratings!;
    expect(day.ratings.food.count).toBe(stored.food.count + (old.food !== null ? 1 : 0));
  });

  it("seeds rates, clock PINs, and raw clock entries with lateness, one fixed forgotten clock-out and overtime", async () => {
    const m = t.models;
    const [staff, entries, shifts] = await inTenant(A, () => Promise.all([m.Staff.find().lean(), m.ClockEntry.find().lean(), m.Shift.find().lean()]));
    const ranges: Record<string, [number, number]> = {
      waiter: [180, 220], cook: [200, 260], bartender: [190, 230], host: [150, 170], dishwasher: [150, 170], manager: [320, 320],
    };
    const changed = staff.filter((s) => s.rates.length > 1);
    expect(changed).toHaveLength(1);
    const changeAgo = (NOW.getTime() - changed[0]!.rates.at(-1)!.from.getTime()) / 86_400_000;
    expect(changeAgo).toBeGreaterThan(18);
    expect(changeAgo).toBeLessThan(22);
    for (const s of staff) {
      const range = ranges[s.role];
      if (!range) {
        expect(s.rates).toEqual([]); // station accounts
        continue;
      }
      expect(s.rates.length, s.name).toBeGreaterThan(0);
      for (const r of s.rates) {
        expect(r.kurusPerHour / 100).toBeGreaterThanOrEqual(range[0]);
        expect(r.kurusPerHour / 100).toBeLessThanOrEqual(range[1]);
      }
      if (!s.pinHash) expect(await verifyPin(s.clockPinHash, "1111"), s.name).toBe(true);
    }
    const past = entries.filter((e) => e.serviceDay < today);
    expect(past.length).toBeGreaterThan(150);
    expect(past.every((e) => e.out && e.out > e.in)).toBe(true);
    const rateOf = new Map(staff.map((s) => [String(s._id), s.rates]));
    for (const e of entries) expect(e.rate).toBe(rateAt(rateOf.get(String(e.staffId))!, e.in));
    // Late against the shift it belongs to: about 8 %, by 6–25 min.
    let late = 0;
    let judged = 0;
    for (const s of shifts.filter((x) => x.serviceDay >= dayMinus(RAW_CLOCK_DAYS) && x.serviceDay < today)) {
      const e = past.find((x) => String(x.staffId) === String(s.staffId) && x.serviceDay === s.serviceDay);
      expect(e, `${s.serviceDay} entry`).toBeDefined();
      judged += 1;
      const by = (e!.in.getTime() - s.start.getTime()) / 60_000;
      if (by > 5) {
        late += 1;
        expect(by).toBeGreaterThanOrEqual(6);
        expect(by).toBeLessThanOrEqual(25);
      }
    }
    expect(late / judged).toBeGreaterThan(0.03);
    expect(late / judged).toBeLessThan(0.14);
    const edited = entries.filter((e) => e.edits.length > 0);
    expect(edited).toHaveLength(1);
    expect(edited[0]!.edits[0]!.before).toMatchObject({ out: null });
    expect(edited[0]!.out).not.toBeNull();
    const labour = await inTenant(A, () => labourForDays(t.models, Array.from({ length: RAW_CLOCK_DAYS }, (_, i) => dayMinus(i + 1)), NOW));
    const overtime = [...labour.values()].flat().reduce((n, p) => n + p.overtimeMinutes, 0);
    expect(overtime).toBeGreaterThan(0);
  });

  it("seeds 15 comments in English and Turkish, one hidden, and the rating targets", async () => {
    const m = t.models;
    const [ratings, staff] = await inTenant(A, () => Promise.all([m.Rating.find().lean(), m.Staff.find().lean()]));
    const comments = ratings.filter((r) => r.comment);
    expect(comments.length).toBeGreaterThanOrEqual(13);
    expect(comments.length).toBeLessThanOrEqual(17);
    expect(comments.filter((r) => r.commentHidden)).toHaveLength(1);
    // Spread over the four months: at least 3 in every full past month.
    for (const month of ["2026-08", "2026-09", "2026-10"]) {
      expect(comments.filter((r) => r.serviceDay.startsWith(month)).length, month).toBeGreaterThanOrEqual(3);
    }
    expect(comments.some((r) => /[çğışöüİ]/.test(r.comment!))).toBe(true);
    expect(comments.some((r) => /\b(the|was|and)\b/.test(r.comment!))).toBe(true);
    // Waiter averages over all 120 days, aggregates and raw together.
    const ops = await inTenant(A, () => opsForDays(t.models, Array.from({ length: 120 }, (_, i) => dayMinus(i + 1)), NOW));
    const waiter = new Map<string, { sum: number; count: number }>();
    const cat = { food: { sum: 0, count: 0 }, cleanliness: { sum: 0, count: 0 }, atmosphere: { sum: 0, count: 0 } };
    for (const d of ops.values()) {
      for (const w of d.ratings.waiter) {
        const x = waiter.get(w.staffId) ?? { sum: 0, count: 0 };
        waiter.set(w.staffId, { sum: x.sum + w.sum, count: x.count + w.count });
      }
      for (const k of ["food", "cleanliness", "atmosphere"] as const) {
        cat[k].sum += d.ratings[k].sum;
        cat[k].count += d.ratings[k].count;
      }
    }
    const nameOf = new Map(staff.map((s) => [String(s._id), s.name]));
    const avgs = [...waiter].map(([id, x]) => ({ name: nameOf.get(id), avg: x.sum / x.count })).sort((a, b) => b.avg - a.avg);
    expect(avgs[0]!.name).toBe("Deniz");
    for (const a of avgs) {
      expect(a.avg).toBeGreaterThanOrEqual(4.3);
      expect(a.avg).toBeLessThanOrEqual(4.9);
    }
    expect(cat.food.sum / cat.food.count).toBeCloseTo(4.5, 1);
    expect(cat.cleanliness.sum / cat.cleanliness.count).toBeCloseTo(4.6, 1);
    expect(cat.atmosphere.sum / cat.atmosphere.count).toBeCloseTo(4.7, 1);
  });

  it("late in a month, last month's page still has comments (25 Nov, 21:00)", async () => {
    const now = new Date("2026-11-25T18:00:00Z");
    const id = newTenant();
    await seedRestaurant(t.models, id, now, { liveService: true });
    t.clock.set(now);
    try {
      const v = (await managerGet(id, "/api/business/monthly?month=2026-10")).json();
      expect(v.ratings.comments.length).toBeGreaterThan(0);
    } finally {
      t.clock.set(NOW);
    }
  });

  it("just after the service day starts (06:05), no seeded time is in the future and the overview still answers", async () => {
    const now = new Date("2026-11-10T03:05:00Z");
    const id = newTenant();
    await seedRestaurant(t.models, id, now, { liveService: true });
    const entries = await inTenant(id, () => t.models.ClockEntry.find().lean());
    for (const e of entries) {
      expect(e.in.getTime()).toBeLessThanOrEqual(now.getTime());
      if (e.out) expect(e.out.getTime()).toBeLessThanOrEqual(now.getTime());
    }
    t.clock.set(now);
    try {
      const res = await managerGet(id, "/api/business/overview");
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().working.length).toBeGreaterThan(0);
    } finally {
      t.clock.set(NOW);
    }
  });

  it("on a Monday the overview's top staff (the last 7 service days) has someone ranked in every group", async () => {
    const now = new Date("2026-11-09T18:00:00Z"); // Monday, 21:00 Istanbul
    const id = newTenant();
    await seedRestaurant(t.models, id, now, { liveService: true });
    t.clock.set(now);
    try {
      const top = (await managerGet(id, "/api/business/overview")).json().topStaff as Record<string, { score: number | null }[]>;
      for (const g of ["floor", "kitchen", "bar"]) {
        expect(top[g]!.length, g).toBeGreaterThan(0);
        expect(top[g]!.every((r) => r.score !== null)).toBe(true);
      }
    } finally {
      t.clock.set(NOW);
    }
  });

  it("seeds four months of expenses: budgets, rent on the 1st, utilities around the 10th, Repairs over budget this month, none in the future", async () => {
    const m = t.models;
    const [cats, expenses] = await inTenant(A, () => Promise.all([m.ExpenseCategory.find().sort({ sort: 1 }).lean(), m.Expense.find().lean()]));
    expect(cats.map((c) => [c.name.en, c.monthlyBudget / 100_000])).toEqual([
      ["Suppliers – food", 380], ["Suppliers – drinks", 190], ["Rent", 220], ["Utilities", 90],
      ["Repairs and maintenance", 60], ["Marketing", 40], ["Other", 30],
    ]);
    const catOf = new Map(cats.map((c) => [String(c._id), c.name.en]));
    expect(expenses.every((e) => e.date <= today)).toBe(true);
    const months = [...new Set(expenses.map((e) => e.date.slice(0, 7)))].sort();
    expect(months).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    for (const month of months) {
      const mine = expenses.filter((e) => e.date.startsWith(month));
      const rent = mine.filter((e) => catOf.get(String(e.categoryId)) === "Rent");
      expect(rent.map((e) => [e.date.slice(8), e.amount])).toEqual([["01", 220_000_00]]);
      const utilities = mine.filter((e) => catOf.get(String(e.categoryId)) === "Utilities");
      for (const u of utilities) expect(Math.abs(Number(u.date.slice(8)) - 10)).toBeLessThanOrEqual(3);
      const food = mine.filter((e) => catOf.get(String(e.categoryId)) === "Suppliers – food");
      expect(new Set(food.map((e) => e.date)).size).toBe(food.length);
    }
    const spent = (month: string, en: string) =>
      expenses.filter((e) => e.date.startsWith(month) && catOf.get(String(e.categoryId)) === en).reduce((n, e) => n + e.amount, 0);
    for (const c of cats) {
      for (const month of ["2026-08", "2026-09", "2026-10"]) {
        expect(spent(month, c.name.en), `${month} ${c.name.en}`).toBeLessThanOrEqual(c.monthlyBudget);
        expect(spent(month, c.name.en), `${month} ${c.name.en}`).toBeGreaterThan(c.monthlyBudget * 0.5);
      }
    }
    expect(spent("2026-11", "Repairs and maintenance")).toBeGreaterThan(60_000_00);
    // On the 1st of a month too, Repairs is already over budget and nothing is dated after today.
    const first = new Date("2026-12-01T09:00:00Z");
    const id = newTenant();
    await seedRestaurant(t.models, id, first, { liveService: true });
    const [c2, e2] = await inTenant(id, () => Promise.all([m.ExpenseCategory.find().lean(), m.Expense.find().lean()]));
    const repairs = String(c2.find((c) => c.name.en.startsWith("Repairs"))!._id);
    expect(e2.every((e) => e.date <= serviceDayOf(first))).toBe(true);
    expect(e2.filter((e) => e.date.startsWith("2026-12") && String(e.categoryId) === repairs).reduce((n, e) => n + e.amount, 0)).toBeGreaterThan(60_000_00);
  });
});
