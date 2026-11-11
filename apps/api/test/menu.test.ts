import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, seedTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Role = keyof Seeded["seed"]["staff"];

async function getMenu(s: Seeded, who: Role) {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
  return t.inject({ method: "GET", url: "/api/menu", cookies: { lodos_sid: sid } });
}

describe("GET /api/menu (staff)", () => {
  it("has the guest menu's shape: active categories, active items with availability", async () => {
    const s = await seedTenant(t);
    const burrata = await itemNamed(t, s.tenantId, "Burrata");
    const prawns = await itemNamed(t, s.tenantId, "King prawns");
    const ribeye = await itemNamed(t, s.tenantId, "Dry-aged ribeye");
    const fries = await itemNamed(t, s.tenantId, "Truffle fries");
    await runWithTenant(s.tenantId, () => t.models.MenuItem.updateOne({ _id: burrata.id }, { active: false }));

    const res = await getMenu(s, "waiter");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      categories: { id: string; name: { en: string; tr: string } }[];
      items: { id: string; categoryId: string; price: number; station: string; optionGroups: unknown[]; availability: { soldOut: boolean; remaining: number | null } }[];
    };
    expect(body.categories.map((c) => c.name.en)).toEqual(["To share", "Raw bar", "From the fire", "Sides", "Desserts", "Cocktails", "Wine", "Zero-proof"]);
    expect(body.items).toHaveLength(32);
    const byId = new Map(body.items.map((i) => [i.id, i]));
    expect(byId.has(burrata.id)).toBe(false);
    expect(byId.get(prawns.id)!.availability).toEqual({ soldOut: true, remaining: null });
    expect(byId.get(ribeye.id)!.availability).toEqual({ soldOut: false, remaining: 2 });
    expect(byId.get(fries.id)).toMatchObject({ price: fries.price, station: fries.station, availability: { soldOut: false, remaining: null } });

    // Identical to what a guest at a table of the same restaurant sees.
    const g = await guest(t, s.seed.tables.T7!.token).get("/api/guest/menu");
    expect(body).toEqual(g.json());
    expect(JSON.stringify(body)).not.toContain(s.tenantId);
  });

  it("hides items of an inactive category", async () => {
    const s = await seedTenant(t);
    const cat = await runWithTenant(s.tenantId, () => t.models.Category.findOne({ "name.en": "Wine" }).lean().orFail());
    await runWithTenant(s.tenantId, () => t.models.Category.updateOne({ _id: cat._id }, { active: false }));
    const body = (await getMenu(s, "waiter")).json() as { categories: { id: string }[]; items: { categoryId: string }[] };
    expect(body.categories.some((c) => c.id === String(cat._id))).toBe(false);
    expect(body.items.some((i) => i.categoryId === String(cat._id))).toBe(false);
  });

  it("role matrix: waiter and manager 200, kitchen and bar 403, no cookie 401", async () => {
    const s = await seedTenant(t);
    expect((await getMenu(s, "waiter")).statusCode).toBe(200);
    expect((await getMenu(s, "manager")).statusCode).toBe(200);
    const kitchen = await getMenu(s, "kitchen");
    expect(kitchen.statusCode).toBe(403);
    expect(kitchen.json().error.code).toBe("forbidden");
    expect((await getMenu(s, "bar")).statusCode).toBe(403);
    const anon = await t.inject({ method: "GET", url: "/api/menu" });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe("unauthorized");
  });

  it("cross-tenant: A's session only sees A's menu", async () => {
    const a = await seedTenant(t);
    const b = await seedTenant(t);
    // Make B's menu distinguishable: rename one of B's items.
    const bFries = await itemNamed(t, b.tenantId, "Truffle fries");
    await runWithTenant(b.tenantId, () => t.models.MenuItem.updateOne({ _id: bFries.id }, { "name.en": "B-only fries" }));
    const aIds = await runWithTenant(a.tenantId, async () => (await t.models.MenuItem.find({ active: true }).lean()).map((i) => String(i._id)));

    const res = await getMenu(a, "waiter");
    const items = (res.json() as { items: { id: string; name: { en: string } }[] }).items;
    expect(items.every((i) => aIds.includes(i.id))).toBe(true);
    expect(items.some((i) => i.id === bFries.id)).toBe(false);
    expect(JSON.stringify(res.json())).not.toContain("B-only fries");
    expect(JSON.stringify(res.json())).not.toContain(b.tenantId);
  });
});

describe("seeded VAT rates", () => {
  it("cocktails and wine carry 20, food and zero-proof drinks 10", async () => {
    const s = await seedTenant(t);
    const rate = (name: string) =>
      runWithTenant(s.tenantId, async () => (await t.models.MenuItem.findOne({ "name.en": new RegExp(`^${name}`) }).lean())?.vatRate);
    expect(await rate("Lodos Negroni")).toBe(20);
    expect(await rate("Burrata")).toBe(10);
    expect(await rate("Mint and salt")).toBe(10);
  });
});
