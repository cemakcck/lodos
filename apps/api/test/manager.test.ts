import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody, LIVE_NO_HISTORY, seedTenant, type TestApp } from "./helpers";
import { closeSockets, connect, listen, until } from "./sockets";

const NOW = new Date("2026-11-10T17:00:00Z");

let t: TestApp;
let url: string;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
  url = await listen(t);
});
afterEach(() => closeSockets());
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Loc = { en: string; tr: string };

async function sidOf(s: Seeded, who: keyof Seeded["seed"]["staff"]) {
  return createSession(t.models, s.seed.staff[who], s.tenantId, "person", NOW);
}
async function mgr(s: Seeded, who: keyof Seeded["seed"]["staff"] = "manager") {
  const sid = await sidOf(s, who);
  return (method: "GET" | "POST" | "PATCH" | "DELETE", u: string, payload?: object) =>
    t.inject({ method, url: u, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}
const validItem = (categoryId: string, over: Record<string, unknown> = {}) => ({
  categoryId,
  name: { en: "Test dish", tr: "Deneme yemek" },
  description: { en: "Tasty", tr: "Lezzetli" },
  price: 12500,
  station: "kitchen",
  dietary: ["vegetarian"],
  allergens: ["milk"],
  ...over,
});
const anyCategory = (s: Seeded) => runWithTenant(s.tenantId, () => t.models.Category.findOne({}).lean().orFail());

function multipart(filename: string, contentType: string, data: Buffer) {
  const boundary = "----lodos" + randomBytes(6).toString("hex");
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const upload = async (s: Seeded, itemId: string, filename: string, ct: string, data: Buffer) => {
  const sid = await sidOf(s, "manager");
  const m = multipart(filename, ct, data);
  return t.inject({ method: "POST", url: `/api/manager/items/${itemId}/photo`, cookies: { lodos_sid: sid }, headers: m.headers, payload: m.payload });
};

describe("auth", () => {
  it("non-managers get 403, anonymous 401", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    expect((await (await mgr(s, "waiter"))("GET", "/api/manager/menu")).statusCode).toBe(403);
    expect((await t.inject({ method: "GET", url: "/api/manager/menu" })).statusCode).toBe(401);
  });
});

describe("menu editor", () => {
  it("GET /menu lists categories and items including inactive ones", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    await runWithTenant(s.tenantId, () => t.models.MenuItem.updateOne({ _id: item.id }, { active: false }));
    const body = (await m("GET", "/api/manager/menu")).json() as { categories: { id: string }[]; items: { id: string; active: boolean; name: Loc }[] };
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.items.find((i) => i.id === item.id)?.active).toBe(false);
  });

  it("creating an item with a missing TR name -> 400; price/allergen/station validation", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const cat = await anyCategory(s);
    const c = String(cat._id);
    expect((await m("POST", "/api/manager/items", validItem(c, { name: { en: "x" } }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem(c, { price: 0 }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem(c, { price: 10.5 }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem(c, { allergens: ["pollen"] }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem(c, { station: "grill" }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem("nope"))).statusCode).toBe(404);
    const ok = await m("POST", "/api/manager/items", validItem(c));
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ id: expect.any(String), price: 12500, active: true });
  });

  it("a price edit appears on /guest/menu and the guest socket gets menu.changed", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const g = await connect(url, { tableToken: s.seed.tables.T7!.token });
    const res = await m("PATCH", `/api/manager/items/${item.id}`, { price: 99900 });
    expect(res.statusCode).toBe(200);
    await g.next((e) => e.type === "menu.changed");
    const menu = (await guest(t, s.seed.tables.T7!.token).get("/api/guest/menu")).json() as { items: { id: string; price: number }[] };
    expect(menu.items.find((i) => i.id === item.id)!.price).toBe(99900);
  });

  it("PATCH is partial, keeps option ids; invalid patch -> 400; bad id -> 404", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const before = await runWithTenant(s.tenantId, () => t.models.MenuItem.findById(item.id).lean().orFail());
    const r = await m("PATCH", `/api/manager/items/${item.id}`, { name: { en: "Fries", tr: "Patates" } });
    expect(r.statusCode).toBe(200);
    const after = await runWithTenant(s.tenantId, () => t.models.MenuItem.findById(item.id).lean().orFail());
    expect(after.name.en).toBe("Fries");
    expect(after.price).toBe(before.price);
    expect(after.optionGroups).toEqual(before.optionGroups);
    expect((await m("PATCH", `/api/manager/items/${item.id}`, { price: -3 })).statusCode).toBe(400);
    expect((await m("PATCH", "/api/manager/items/xyz", { price: 3 })).statusCode).toBe(404);
  });

  it("DELETE item is a soft delete and emits menu.changed", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const g = await connect(url, { tableToken: s.seed.tables.T7!.token });
    expect((await m("DELETE", `/api/manager/items/${item.id}`)).statusCode).toBe(200);
    await g.next((e) => e.type === "menu.changed");
    const doc = await runWithTenant(s.tenantId, () => t.models.MenuItem.findById(item.id).lean());
    expect(doc?.active).toBe(false);
    const menu = (await guest(t, s.seed.tables.T7!.token).get("/api/guest/menu")).json() as { items: { id: string }[] };
    expect(menu.items.some((i) => i.id === item.id)).toBe(false);
  });

  it("category CRUD; deleting a category with active items -> 409, empty -> 200", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const created = await m("POST", "/api/manager/categories", { name: { en: "Desserts 2", tr: "Tatlilar 2" } });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await m("POST", "/api/manager/categories", { name: { en: "x" } })).statusCode).toBe(400);
    const p = await m("PATCH", `/api/manager/categories/${id}`, { name: { en: "Sweet", tr: "Tatli" }, sort: 99 });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: { en: "Sweet" }, sort: 99 });
    const item = await m("POST", "/api/manager/items", validItem(id));
    expect(item.statusCode).toBe(201);
    expect((await m("DELETE", `/api/manager/categories/${id}`)).statusCode).toBe(409);
    await m("DELETE", `/api/manager/items/${(item.json() as { id: string }).id}`);
    expect((await m("DELETE", `/api/manager/categories/${id}`)).statusCode).toBe(200);
    expect((await m("DELETE", `/api/manager/categories/${id}`)).statusCode).toBe(404);
    expect((await m("DELETE", "/api/manager/categories/zzz")).statusCode).toBe(404);
  });
});

describe("option groups", () => {
  const grp = (id: string | undefined, opts: (string | undefined)[]) => ({
    ...(id ? { id } : {}),
    name: { en: "G", tr: "G" },
    type: "single",
    required: false,
    options: opts.map((o) => ({ ...(o ? { id: o } : {}), name: { en: "o", tr: "o" }, priceDelta: 0 })),
  });
  it("duplicate group ids and duplicate option ids -> 400", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const c = String((await anyCategory(s))._id);
    expect((await m("POST", "/api/manager/items", validItem(c, { optionGroups: [grp("a", ["x"]), grp("a", ["y"])] }))).statusCode).toBe(400);
    expect((await m("POST", "/api/manager/items", validItem(c, { optionGroups: [grp("a", ["x", "x"])] }))).statusCode).toBe(400);
  });
  it("new groups and options get ids; a PATCH echoing ids keeps them", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const c = String((await anyCategory(s))._id);
    const made = (await m("POST", "/api/manager/items", validItem(c, { optionGroups: [grp("keep", ["k1", undefined]), grp(undefined, [undefined])] }))).json() as { id: string; optionGroups: { id: string; options: { id: string }[] }[] };
    expect(made.optionGroups[0]!.id).toBe("keep");
    expect(made.optionGroups[0]!.options[0]!.id).toBe("k1");
    expect(made.optionGroups[0]!.options[1]!.id).toMatch(/^[0-9a-f]{10}$/);
    expect(made.optionGroups[1]!.id).toMatch(/^[0-9a-f]{10}$/);
    const patched = (await m("PATCH", `/api/manager/items/${made.id}`, { optionGroups: made.optionGroups })).json() as typeof made;
    expect(patched.optionGroups).toEqual(made.optionGroups);
  });
});

describe("86 and N left", () => {
  it("86 -> the guest menu shows soldOut; availability.changed reaches guests", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const g = await connect(url, { tableToken: s.seed.tables.T7!.token });
    const r = await m("POST", `/api/manager/availability/${item.id}`, { soldOut: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ itemId: item.id, soldOut: true, remaining: null });
    await g.next((e) => e.type === "availability.changed");
    const menu = (await guest(t, s.seed.tables.T7!.token).get("/api/guest/menu")).json() as { items: { id: string; availability: { soldOut: boolean } }[] };
    expect(menu.items.find((i) => i.id === item.id)!.availability.soldOut).toBe(true);
    // un-86 with no remaining clears it
    const back = await m("POST", `/api/manager/availability/${item.id}`, { soldOut: false });
    expect(back.json()).toMatchObject({ soldOut: false, remaining: null });
  });

  it("remaining 0 implies soldOut; unknown/bad item -> 404; invalid body -> 400", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const r = await m("POST", `/api/manager/availability/${item.id}`, { remaining: 0 });
    expect(r.json()).toMatchObject({ soldOut: true, remaining: 0 });
    const r2 = await m("POST", `/api/manager/availability/${item.id}`, { soldOut: false, remaining: 5 });
    expect(r2.json()).toMatchObject({ soldOut: false, remaining: 5 });
    expect((await m("POST", `/api/manager/availability/${item.id}`, { remaining: -1 })).statusCode).toBe(400);
    expect((await m("POST", `/api/manager/availability/${"0".repeat(24)}`, { soldOut: true })).statusCode).toBe(404);
    expect((await m("POST", "/api/manager/availability/bad", { soldOut: true })).statusCode).toBe(404);
  });

  it("concurrent availability posts for one item never 500", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => m("POST", `/api/manager/availability/${item.id}`, { remaining: i + 1 })));
    for (const r of rs) expect([200, 409]).toContain(r.statusCode);
    expect(rs.some((r) => r.statusCode === 200)).toBe(true);
  });

  it("remaining 1 plus one order -> soldOut", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    await m("POST", `/api/manager/availability/${item.id}`, { remaining: 1 });
    const g = guest(t, s.seed.tables.T7!.token);
    expect((await g.post("/api/guest/orders", orderBody([{ itemId: item.id }]))).statusCode).toBe(201);
    const menu = (await g.get("/api/guest/menu")).json() as { items: { id: string; availability: { soldOut: boolean; remaining: number | null } }[] };
    expect(menu.items.find((i) => i.id === item.id)!.availability).toMatchObject({ soldOut: true, remaining: 0 });
  });
});

describe("tables", () => {
  it("GET lists tables with raw tokens (manager only)", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const rows = (await (await mgr(s))("GET", "/api/manager/tables")).json() as { id: string; name: string; token: string; capacity: number }[];
    expect(rows.find((r) => r.name === "T7")).toMatchObject({ id: s.seed.tables.T7!.id, token: s.seed.tables.T7!.token });
  });

  it("rename: '12' -> 400; 'T99' -> 200; existing name -> 409; capacity edit; tables.changed", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const id = s.seed.tables.T7!.id;
    expect((await m("PATCH", `/api/manager/tables/${id}`, { name: "12" })).statusCode).toBe(400);
    const ok = await m("PATCH", `/api/manager/tables/${id}`, { name: "T99", capacity: 6 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: "T99", capacity: 6 });
    expect((await m("PATCH", `/api/manager/tables/${id}`, { name: "T3" })).statusCode).toBe(409);
    expect((await m("PATCH", `/api/manager/tables/${id}`, { capacity: 0 })).statusCode).toBe(400);
    expect((await m("PATCH", "/api/manager/tables/nope", { capacity: 2 })).statusCode).toBe(404);
  });

  it("token regeneration: new token works, old -> 404, guest sockets in the room are disconnected", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const T7 = s.seed.tables.T7!;
    const other = await connect(url, { tableToken: s.seed.tables.T3!.token });
    const g = await connect(url, { tableToken: T7.token });
    const res = await m("POST", `/api/manager/tables/${T7.id}/token`);
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(token).not.toBe(T7.token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await until(() => g.socket.disconnected);
    expect(other.socket.connected).toBe(true);
    expect((await guest(t, T7.token).get("/api/guest/table")).statusCode).toBe(404);
    expect((await guest(t, token).get("/api/guest/table")).statusCode).toBe(200);
    expect((await m("POST", "/api/manager/tables/nope/token")).statusCode).toBe(404);
  });
});

describe("photos", () => {
  it("a 3 MB upload -> 400; wrong type or bad magic bytes -> 400", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const r = await upload(s, item.id, "big.png", "image/png", big);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: { code: "validation" } });
    expect((await upload(s, item.id, "x.gif", "image/gif", Buffer.from("GIF89a....."))).statusCode).toBe(400);
    expect((await upload(s, item.id, "x.png", "image/png", Buffer.from("not an image at all"))).statusCode).toBe(400);
  });

  it("a valid upload is served publicly with the right type and cache headers; replacing deletes the old one", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    const up = await upload(s, item.id, "a.png", "image/png", PNG);
    expect(up.statusCode).toBe(200);
    const { photo } = up.json() as { photo: string };
    expect(photo).toMatch(/^\/api\/photos\/[0-9a-f]{24}$/);
    const got = await t.inject({ method: "GET", url: photo });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(got.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(got.rawPayload.equals(PNG)).toBe(true);

    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), randomBytes(50)]);
    const up2 = await upload(s, item.id, "b.webp", "image/webp", webp);
    expect(up2.statusCode).toBe(200);
    expect((await t.inject({ method: "GET", url: photo })).statusCode).toBe(404);
    const second = await t.inject({ method: "GET", url: (up2.json() as { photo: string }).photo });
    expect(second.headers["content-type"]).toBe("image/webp");
    expect((await t.inject({ method: "GET", url: "/api/photos/zzz" })).statusCode).toBe(404);
    expect((await t.inject({ method: "GET", url: `/api/photos/${"0".repeat(24)}` })).statusCode).toBe(404);
  });

  it("a seeded static photo path is left alone on replace", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const item = await itemNamed(t, s.tenantId, "Truffle fries");
    await runWithTenant(s.tenantId, () => t.models.MenuItem.updateOne({ _id: item.id }, { photo: "/photos/x.jpg" }));
    expect((await upload(s, item.id, "a.png", "image/png", PNG)).statusCode).toBe(200);
  });
});

describe("demo storage caps (always on)", () => {
  it("a tenant holds at most 120 menu items: the 121st create → 409 limit_exceeded", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const cat = await anyCategory(s);
    const have = await runWithTenant(s.tenantId, () => t.models.MenuItem.countDocuments({}));
    const base = await runWithTenant(s.tenantId, () => t.models.MenuItem.findOne({}).lean().orFail());
    const { _id: _drop, ...rest } = base;
    void _drop;
    await runWithTenant(s.tenantId, () =>
      t.models.MenuItem.insertMany(Array.from({ length: 119 - have }, (_, i) => ({ ...rest, name: { en: `Filler ${i}`, tr: `Dolgu ${i}` } }))),
    );
    const last = await m("POST", "/api/manager/items", validItem(String(cat._id)));
    expect(last.statusCode).toBe(201);
    const over = await m("POST", "/api/manager/items", validItem(String(cat._id), { name: { en: "One too many", tr: "Fazla" } }));
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("limit_exceeded");
    expect(await runWithTenant(s.tenantId, () => t.models.MenuItem.countDocuments({}))).toBe(120);
  });

  it("uploaded photos total at most 20 MB per tenant; replacing a photo frees the old one first", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const fries = await itemNamed(t, s.tenantId, "Truffle fries");
    const burrata = await itemNamed(t, s.tenantId, "Burrata");
    const tenMb = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 - PNG.length)]);
    const [a] = await runWithTenant(s.tenantId, () =>
      t.models.Photo.create([{ data: tenMb, contentType: "image/png" }, { data: tenMb, contentType: "image/png" }]),
    );
    await runWithTenant(s.tenantId, () => t.models.MenuItem.updateOne({ _id: fries.id }, { photo: `/api/photos/${String(a!._id)}` }));
    const full = await upload(s, burrata.id, "b.png", "image/png", PNG);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe("limit_exceeded");
    // Fries' 10 MB photo is freed by its replacement, so this fits.
    const replaced = await upload(s, fries.id, "f.png", "image/png", PNG);
    expect(replaced.statusCode).toBe(200);
    expect(await runWithTenant(s.tenantId, () => t.models.Photo.countDocuments({ _id: a!._id }))).toBe(0);
  });
});

describe("item vatRate", () => {
  it("defaults to 10, round-trips 20, and rejects other rates with 400 validation", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const c = String((await anyCategory(s))._id);
    const made = await m("POST", "/api/manager/items", validItem(c));
    expect(made.statusCode).toBe(201);
    expect(made.json().vatRate).toBe(10);
    const id = made.json().id as string;
    const up = await m("PATCH", `/api/manager/items/${id}`, { vatRate: 20 });
    expect(up.json().vatRate).toBe(20);
    const bad = await m("PATCH", `/api/manager/items/${id}`, { vatRate: 18 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("validation");
    const menu = (await m("GET", "/api/manager/menu")).json() as { items: { id: string; vatRate: number }[] };
    expect(menu.items.find((i) => i.id === id)!.vatRate).toBe(20);
  });

  it("a partial PATCH that does not mention vatRate leaves it alone", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const negroni = await itemNamed(t, s.tenantId, "Lodos Negroni");
    const r = await m("PATCH", `/api/manager/items/${negroni.id}`, { price: negroni.price + 100 });
    expect(r.statusCode).toBe(200);
    expect(r.json().vatRate).toBe(20);
    const doc = await runWithTenant(s.tenantId, () => t.models.MenuItem.findById(negroni.id).lean().orFail());
    expect(doc.vatRate).toBe(20);
  });
});

describe("category defaultVatRate", () => {
  it("is seeded 20 for cocktails and wine and shown in the manager menu", async () => {
    const s = await seedTenant(t, LIVE_NO_HISTORY);
    const m = await mgr(s);
    const menu = (await m("GET", "/api/manager/menu")).json() as { categories: { name: { en: string }; defaultVatRate: number }[] };
    const rate = (n: string) => menu.categories.find((c) => c.name.en === n)!.defaultVatRate;
    expect([rate("Cocktails"), rate("Wine"), rate("To share"), rate("Zero-proof")]).toEqual([20, 20, 10, 10]);
  });
});
