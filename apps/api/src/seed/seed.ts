import { randomBytes } from "node:crypto";
import { lineTotal, serviceDayOf } from "@lodos/shared";
import argon2 from "argon2";
import { Types } from "mongoose";
import type { Models } from "../db/models";
import { runWithTenant } from "../db/tenancy";
import { CATEGORIES, ITEMS, ROOMS, STAFF, TABLES, vatRateOf, type SeedItem, type Station } from "./content";

export type SeedResult = {
  /** Keyed by table name. `token` is the raw guest QR token. */
  tables: Record<string, { id: string; token: string }>;
  /** Staff ids. `kitchen` and `bar` are station accounts. */
  staff: Record<"waiter" | "waiter2" | "kitchen" | "bar" | "manager", string>;
};

const kurus = (lira: number) => Math.round(lira * 100);
const oid = () => new Types.ObjectId();

/** OWASP-minimum argon2id: the demo PINs are public, so the cost only has to keep seeding fast. */
const hashPin = (pin: string) => argon2.hash(pin, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

type LineSpec = { slug: string; qty?: number; opts?: string[]; note?: string };
type OrderSpec = {
  table: string;
  source: "qr" | "staff";
  minAgo: number;
  lines: LineSpec[];
  /** Present only for orders still being worked on. Without it, the order is a served round. */
  ticket?: { status: "new" | "started" | "ready"; startedMinAgo?: number; readyMinAgo?: number };
};

/** Tables that are seated at `now`, relative to it. T7 is deliberately absent: it is the guest's table. */
const SEATED = [
  { table: "B1", covers: 4, openedMinAgo: 52 },
  { table: "B2", covers: 2, openedMinAgo: 18 },
  { table: "B4", covers: 3, openedMinAgo: 95, billRequestedMinAgo: 4 },
  { table: "B5", covers: 2, openedMinAgo: 10 },
  { table: "T2", covers: 2, openedMinAgo: 24 },
  { table: "T3", covers: 2, openedMinAgo: 38 },
  { table: "T10", covers: 2, openedMinAgo: 14 },
];

/**
 * Tickets: 2 late (18 and 16 min), 1 warn (9 min), 3 ok, 1 ready and not yet served.
 * Orders without a `ticket` are earlier rounds, already served (ticketed as ready + served).
 */
const ORDERS: OrderSpec[] = [
  { table: "B4", source: "staff", minAgo: 90, lines: [{ slug: "sparkling", qty: 3, opts: ["size:12cl"] }, { slug: "burrata" }, { slug: "grilled-octopus" }] },
  { table: "B4", source: "staff", minAgo: 60, lines: [{ slug: "lamb-chops", qty: 2 }, { slug: "spatchcock-chicken" }, { slug: "truffle-fries" }, { slug: "red-wine-glass", qty: 3, opts: ["size:18cl"] }] },
  { table: "B4", source: "staff", minAgo: 25, lines: [{ slug: "basque-cheesecake", qty: 2 }, { slug: "pistachio-baklava" }, { slug: "cold-brew" }] },
  { table: "B1", source: "staff", minAgo: 50, lines: [{ slug: "lodos-negroni", qty: 2, opts: ["gin:london-dry"] }, { slug: "red-wine-glass", qty: 2, opts: ["size:12cl"] }, { slug: "burrata" }, { slug: "hummus" }] },
  { table: "T3", source: "staff", minAgo: 36, lines: [{ slug: "spritz", qty: 2 }] },
  { table: "T2", source: "staff", minAgo: 22, lines: [{ slug: "rose-wine", qty: 2, opts: ["size:12cl"] }] },
  { table: "B1", source: "staff", minAgo: 18, ticket: { status: "started", startedMinAgo: 15 }, lines: [{ slug: "dry-aged-ribeye", opts: ["doneness:medium-rare"] }, { slug: "lamb-chops", note: "Pink, please" }, { slug: "truffle-fries" }, { slug: "green-salad" }] },
  { table: "T3", source: "staff", minAgo: 16, ticket: { status: "started", startedMinAgo: 13 }, lines: [{ slug: "burrata" }, { slug: "levrek-crudo", opts: ["extras:burrata"] }, { slug: "sea-bream" }] },
  { table: "T10", source: "qr", minAgo: 9, ticket: { status: "new" }, lines: [{ slug: "fried-calamari" }, { slug: "baked-feta" }] },
  { table: "B2", source: "staff", minAgo: 5, ticket: { status: "ready", startedMinAgo: 4, readyMinAgo: 1 }, lines: [{ slug: "tuna-tartare" }, { slug: "grilled-octopus" }] },
  { table: "B1", source: "staff", minAgo: 4, ticket: { status: "new" }, lines: [{ slug: "lodos-negroni", qty: 2, opts: ["gin:barrel-aged"] }, { slug: "spritz" }] },
  { table: "T2", source: "staff", minAgo: 6, ticket: { status: "started", startedMinAgo: 5 }, lines: [{ slug: "old-fashioned" }, { slug: "margarita" }] },
  { table: "B5", source: "staff", minAgo: 3, ticket: { status: "new" }, lines: [{ slug: "oysters", qty: 2 }, { slug: "tuna-tartare" }] },
];

const SOLD_OUT = ["king-prawns", "olive-oil-gelato"];
const LOW_STOCK = { slug: "dry-aged-ribeye", remaining: 2 };

/**
 * Seeds one tenant with the Lodos restaurant: menu, floor, staff and settings, plus (with `liveService`) a
 * mid-service snapshot where tickets, orders and checks agree. Everything is relative to `now`.
 */
export async function seedRestaurant(
  models: Models,
  tenantId: string,
  now: Date,
  opts: { liveService: boolean },
): Promise<SeedResult> {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const pinHashes = await Promise.all(STAFF.map((s) => hashPin(s.pin)));

  const staffIds = Object.fromEntries(STAFF.map((s) => [s.key, oid()])) as Record<(typeof STAFF)[number]["key"], Types.ObjectId>;
  const roomIds = Object.fromEntries(ROOMS.map((r) => [r.key, oid()]));
  const catIds = Object.fromEntries(CATEGORIES.map((c) => [c.key, oid()]));
  const tableIds = Object.fromEntries(TABLES.map((t) => [t.name, oid()]));
  const tokens = Object.fromEntries(TABLES.map((t) => [t.name, randomBytes(32).toString("base64url")]));

  const stationOf = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.station])) as Record<string, Station>;
  const itemIds = Object.fromEntries(ITEMS.map((i) => [i.slug, oid()]));
  const itemBySlug = Object.fromEntries(ITEMS.map((i) => [i.slug, i])) as Record<string, SeedItem>;
  const sortIn: Record<string, number> = {};

  const menuItems = ITEMS.map((i) => ({
    _id: itemIds[i.slug],
    categoryId: catIds[i.category],
    name: i.name,
    description: i.description,
    story: i.story,
    price: kurus(i.price),
    station: stationOf[i.category],
    vatRate: vatRateOf(i.category),
    dietary: i.dietary,
    allergens: i.allergens,
    photo: `/photos/${i.slug}.jpg`,
    optionGroups: (i.groups ?? []).map((g) => ({
      ...g,
      options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: kurus(o.delta) })),
    })),
    sort: (sortIn[i.category] = (sortIn[i.category] ?? -1) + 1),
  }));

  const sectionOf = (name: string) => {
    const t = TABLES.find((x) => x.name === name);
    if (!t) throw new Error(`unknown table ${name}`);
    return staffIds[t.section];
  };

  await runWithTenant(tenantId, async () => {
    const m = models;
    await Promise.all([
      m.Tenant.create({ name: "Lodos", createdAt: now }),
      m.Setting.create({ warnMin: 8, lateMin: 15 }),
      m.Staff.insertMany(
        STAFF.map((s, i) => ({ _id: staffIds[s.key], name: s.name, role: s.role, pinHash: pinHashes[i] })),
      ),
      m.Room.insertMany(ROOMS.map((r) => ({ _id: roomIds[r.key], name: r.name, sort: r.sort }))),
      m.Category.insertMany(CATEGORIES.map((c, i) => ({ _id: catIds[c.key], name: c.name, sort: i, defaultVatRate: vatRateOf(c.key) }))),
      m.MenuItem.insertMany(menuItems),
      m.Table.insertMany(
        TABLES.map((t) => ({
          _id: tableIds[t.name],
          roomId: roomIds[t.room],
          name: t.name,
          shape: t.shape,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          capacity: t.capacity,
          token: tokens[t.name],
          sectionStaffId: staffIds[t.section],
        })),
      ),
    ]);
    if (opts.liveService) await seedLiveService();
  });

  async function seedLiveService() {
    const m = models;
    const checks = SEATED.map((s) => ({
      _id: oid(),
      tableId: tableIds[s.table],
      covers: s.covers,
      openedAt: ago(s.openedMinAgo),
      orderCount: 0,
      serverStaffId: sectionOf(s.table),
      billRequestedAt: s.billRequestedMinAgo ? ago(s.billRequestedMinAgo) : null,
      billMethod: s.billRequestedMinAgo ? ("card" as const) : null,
    }));
    const checkOf = (table: string) => {
      const i = SEATED.findIndex((s) => s.table === table);
      const check = checks[i];
      const seated = SEATED[i];
      if (!check || !seated) throw new Error(`table ${table} is not seated`);
      return { check, seated };
    };
    const staffName = (id: Types.ObjectId) => STAFF.find((s) => staffIds[s.key].equals(id))?.name ?? null;

    const orders: Record<string, unknown>[] = [];
    const tickets: Record<string, unknown>[] = [];
    ORDERS.forEach((spec, n) => {
      const { check, seated } = checkOf(spec.table);
      const placedAt = ago(spec.minAgo);
      const items = spec.lines.map((l) => {
        const item = itemBySlug[l.slug];
        if (!item) throw new Error(`unknown item ${l.slug}`);
        const chosen = (l.opts ?? []).map((ref) => {
          const [gid, oidStr] = ref.split(":");
          const o = item.groups?.find((g) => g.id === gid)?.options.find((x) => x.id === oidStr);
          if (!o) throw new Error(`unknown option ${ref} on ${l.slug}`);
          return { name: o.name, priceDelta: kurus(o.delta) };
        });
        const qty = l.qty ?? 1;
        const unitPrice = kurus(item.price);
        return {
          itemId: itemIds[l.slug],
          name: item.name,
          unitPrice,
          options: chosen,
          qty,
          note: l.note ?? null,
          seat: null,
          station: stationOf[item.category] as Station,
          vatRate: vatRateOf(item.category),
          allergens: item.allergens,
          lineTotal: lineTotal(unitPrice, chosen.map((c) => c.priceDelta), qty),
        };
      });
      const orderId = oid();
      orders.push({
        _id: orderId,
        checkId: check._id,
        tableId: check.tableId,
        source: spec.source,
        placedBy: spec.source === "staff" ? check.serverStaffId : null,
        placedAt,
        idempotencyKey: `seed-${n}`,
        items,
      });
      // One ticket per station the order uses. Orders without a `ticket` spec were served earlier:
      // ready, then served, with realistic cook times after `sentAt` (all before `now`).
      for (const station of ["kitchen", "bar"] as const) {
        const lines = items.map((l, i) => ({ l, i })).filter(({ l }) => l.station === station);
        if (lines.length === 0) continue;
        const cookMin = station === "kitchen" ? 12 : 5;
        const at = (min: number) => new Date(placedAt.getTime() + min * 60_000);
        const t = spec.ticket;
        tickets.push({
          orderId,
          checkId: check._id,
          tableId: check.tableId,
          tableName: spec.table,
          station,
          status: t ? t.status : "ready",
          serverName: spec.source === "staff" ? staffName(check.serverStaffId) : null,
          covers: seated.covers,
          sentAt: placedAt,
          startedAt: t ? (t.startedMinAgo ? ago(t.startedMinAgo) : null) : at(2),
          readyAt: t ? (t.readyMinAgo ? ago(t.readyMinAgo) : null) : at(cookMin),
          servedAt: t ? null : at(cookMin + 2),
          items: lines.map(({ l, i }) => ({
            orderItemIndex: i,
            name: l.name,
            qty: l.qty,
            options: l.options.map((o) => o.name),
            note: l.note,
            allergens: l.allergens,
            checked: !t || t.status === "ready" || (t.status === "started" && i === 0),
          })),
        });
      }
    });

    for (const c of checks) c.orderCount = orders.filter((o) => o.checkId === c._id).length;

    const t2 = checkOf("T2").check;
    const day = serviceDayOf(now);
    await Promise.all([
      m.Check.insertMany(checks),
      m.Order.insertMany(orders),
      m.Ticket.insertMany(tickets),
      m.Call.create({ tableId: t2.tableId, checkId: t2._id, reason: "wine", openedAt: ago(1) }),
      m.Availability.insertMany([
        ...SOLD_OUT.map((slug) => ({ serviceDay: day, itemId: itemIds[slug], soldOut: true })),
        { serviceDay: day, itemId: itemIds[LOW_STOCK.slug], soldOut: false, remaining: LOW_STOCK.remaining },
      ]),
    ]);
  }

  return {
    tables: Object.fromEntries(TABLES.map((t) => [t.name, { id: String(tableIds[t.name]), token: tokens[t.name] as string }])),
    staff: Object.fromEntries(STAFF.map((s) => [s.key, String(staffIds[s.key])])) as SeedResult["staff"],
  };
}
