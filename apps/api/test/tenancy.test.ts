import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_SCOPED_MODELS } from "../src/db/models";
import { currentTenant, runWithTenant, unscoped } from "../src/db/tenancy";
import { makeTestApp, newTenant } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
const a = newTenant();
const b = newTenant();
const name = (en: string) => ({ en, tr: `${en} (tr)` });

beforeAll(async () => {
  t = await makeTestApp();
  const { Category } = t.models;
  await runWithTenant(a, () => Category.create({ name: name("A starters") }));
  await runWithTenant(b, () => Category.create({ name: name("B starters") }));
});
afterAll(() => t.close());

describe("tenant scoping", () => {
  it("find() under a tenant returns only that tenant's docs", async () => {
    const { Category } = t.models;
    const docs = await runWithTenant(a, () => Category.find());
    expect(docs.map((d) => d.name.en)).toEqual(["A starters"]);
    expect(docs[0]?.tenantId).toBe(a);
  });

  it("queries outside any context reject with 'tenant context missing'", async () => {
    const { Category } = t.models;
    await expect(Category.find()).rejects.toThrow("tenant context missing");
    await expect(Category.countDocuments()).rejects.toThrow("tenant context missing");
    await expect(Category.create({ name: name("x") })).rejects.toThrow("tenant context missing");
    await expect(Category.aggregate([{ $match: {} }])).rejects.toThrow("tenant context missing");
    expect(() => currentTenant()).toThrow("tenant context missing");
  });

  it("updateMany({}) under a never touches b's docs", async () => {
    const { Category } = t.models;
    const res = await runWithTenant(a, () => Category.updateMany({}, { $set: { sort: 7 } }));
    expect(res.modifiedCount).toBe(1);
    const bDoc = await runWithTenant(b, () => Category.findOne());
    expect(bDoc?.sort).toBe(0);
  });

  it("deleteMany({}) under a never touches b's docs", async () => {
    const { Category } = t.models;
    const c = newTenant();
    await runWithTenant(c, () => Category.create({ name: name("C only") }));
    await runWithTenant(c, () => Category.deleteMany({}));
    expect(await runWithTenant(b, () => Category.countDocuments())).toBe(1);
  });

  it("an aggregate under a returns only a's docs", async () => {
    const { Category } = t.models;
    const rows = await runWithTenant(a, () => Category.aggregate<{ en: string }>([{ $project: { en: "$name.en" } }]));
    expect(rows.map((r) => r.en)).toEqual(["A starters"]);
  });

  it("inserting with a different explicit tenantId throws", async () => {
    const { Category } = t.models;
    await expect(runWithTenant(a, () => Category.create({ name: name("evil"), tenantId: b }))).rejects.toThrow(
      "tenantId does not match tenant context",
    );
    await expect(runWithTenant(a, () => Category.insertMany([{ name: name("evil"), tenantId: b }]))).rejects.toThrow(
      "tenantId does not match tenant context",
    );
  });

  it("insertMany and bulkWrite are scoped", async () => {
    const { Category } = t.models;
    const d = newTenant();
    await runWithTenant(d, () => Category.insertMany([{ name: name("D1") }, { name: name("D2") }]));
    await runWithTenant(d, () =>
      Category.bulkWrite([
        { insertOne: { document: { name: name("D3") } } },
        { updateMany: { filter: {}, update: { $set: { sort: 3 } } } },
      ]),
    );
    const docs = await runWithTenant(d, () => Category.find().sort({ "name.en": 1 }));
    expect(docs.map((x) => [x.name.en, x.tenantId, x.sort])).toEqual([
      ["D1", d, 3],
      ["D2", d, 3],
      ["D3", d, 3],
    ]);
    expect((await runWithTenant(a, () => Category.findOne()))?.sort).toBe(7);
  });

  it("a doc loaded under one tenant can't be saved or found by id under another", async () => {
    const { Category } = t.models;
    const doc = await runWithTenant(a, () => Category.findOne());
    expect(doc).not.toBeNull();
    expect(await runWithTenant(b, () => Category.findById(doc!._id))).toBeNull();
    doc!.sort = 99;
    await expect(runWithTenant(b, () => doc!.save())).rejects.toThrow("tenantId does not match tenant context");
  });

  it("upserts and replaces stay in the tenant; updates can't move a doc to another tenant", async () => {
    const { Category } = t.models;
    const e = newTenant();
    await runWithTenant(e, () => Category.updateOne({ "name.en": "E1" }, { $set: { name: name("E1") } }, { upsert: true }));
    const doc = await runWithTenant(e, () => Category.findOne({ "name.en": "E1" }));
    expect(doc?.tenantId).toBe(e);
    await runWithTenant(e, () => Category.replaceOne({ _id: doc!._id }, { name: name("E2"), sort: 1, active: true }));
    expect((await runWithTenant(e, () => Category.findById(doc!._id)))?.tenantId).toBe(e);
    await expect(runWithTenant(e, () => Category.updateOne({ _id: doc!._id }, { $set: { tenantId: a } }))).rejects.toThrow(
      "tenantId does not match tenant context",
    );
    await expect(runWithTenant(a, () => doc!.deleteOne())).resolves.toMatchObject({ deletedCount: 0 });
    await expect(runWithTenant(e, () => Category.estimatedDocumentCount())).rejects.toThrow("cannot be tenant-scoped");
  });

  it("unscoped() runs without a context, e.g. a token lookup", async () => {
    const { Room, Table } = t.models;
    const token = `tok_${newTenant()}`;
    await runWithTenant(a, async () => {
      const room = await Room.create({ name: "Main" });
      await Table.create({ roomId: room._id, name: "T1", shape: "round", x: 0, y: 0, w: 1, h: 1, capacity: 2, token });
    });
    const table = await unscoped("token lookup", () => Table.findOne({ token }));
    expect(table?.tenantId).toBe(a);
    expect(table?.name).toBe("T1");
  });
});

describe("fails closed on what a filter can't scope", () => {
  const lookupMenu = { $lookup: { from: "menuitems", localField: "_id", foreignField: "categoryId", as: "items" } };

  it("a pipeline update setting tenantId throws, and b's data is unchanged", async () => {
    const { Category } = t.models;
    const before = await runWithTenant(b, () => Category.find().lean());
    const aDoc = await runWithTenant(a, () => Category.findOne());
    await expect(
      runWithTenant(a, () => Category.updateOne({ _id: aDoc!._id }, [{ $set: { tenantId: b } }], { updatePipeline: true })),
    ).rejects.toThrow("tenantId does not match tenant context");
    await expect(
      runWithTenant(a, () => Category.updateOne({ _id: aDoc!._id }, [{ $replaceWith: { tenantId: b } }], { updatePipeline: true })),
    ).rejects.toThrow("not allowed in a tenant context");
    expect(await runWithTenant(b, () => Category.find().lean())).toEqual(before);
    expect((await runWithTenant(a, () => Category.findById(aDoc!._id)))?.tenantId).toBe(a);
    // A pipeline update that leaves tenantId alone still works.
    const bump = [{ $set: { sort: { $add: ["$sort", 1] } } }];
    await runWithTenant(a, () => Category.updateOne({ _id: aDoc!._id }, bump, { updatePipeline: true }));
    expect((await runWithTenant(a, () => Category.findById(aDoc!._id)))?.sort).toBe(8);
  });

  it("an aggregate with $lookup throws", async () => {
    await expect(runWithTenant(a, () => t.models.Category.aggregate([lookupMenu]))).rejects.toThrow(
      "aggregate stage $lookup reads or writes another collection",
    );
  });

  it("an aggregate with $unionWith throws", async () => {
    await expect(runWithTenant(a, () => t.models.Category.aggregate([{ $unionWith: "menuitems" }]))).rejects.toThrow(
      "aggregate stage $unionWith",
    );
  });

  it("an aggregate with $out throws", async () => {
    await expect(runWithTenant(a, () => t.models.Category.aggregate([{ $out: "stolen" }]))).rejects.toThrow(
      "aggregate stage $out",
    );
  });

  it("a $lookup nested in $facet throws", async () => {
    await expect(
      runWithTenant(a, () => t.models.Category.aggregate([{ $facet: { withItems: [lookupMenu], n: [{ $count: "n" }] } }])),
    ).rejects.toThrow("aggregate stage $lookup");
  });

  it("a plain $match/$group aggregate still works and stays scoped", async () => {
    const rows = await runWithTenant(a, () =>
      t.models.Category.aggregate<{ _id: null; n: number }>([{ $match: { active: true } }, { $group: { _id: null, n: { $sum: 1 } } }]),
    );
    expect(rows).toEqual([{ _id: null, n: 1 }]);
  });
});

describe("open-check partial unique index", () => {
  it("rejects a second open check for a table, and allows it once the first is paid", async () => {
    const { Check } = t.models;
    const tableId = new Types.ObjectId();
    const openedAt = t.clock.now();
    await runWithTenant(a, async () => {
      const first = await Check.create({ tableId, status: "open", openedAt });
      await expect(Check.create({ tableId, status: "open", openedAt })).rejects.toMatchObject({ code: 11000 });
      first.status = "paid";
      first.closedAt = t.clock.now();
      await first.save();
      await expect(Check.create({ tableId, status: "open", openedAt })).resolves.toBeDefined();
    });
    // Same table id in another tenant is unaffected.
    await expect(runWithTenant(b, () => Check.create({ tableId, status: "open", openedAt }))).resolves.toBeDefined();
  });
});

describe("phase 3 models", () => {
  it("are tenant scoped and reject queries without a tenant context", async () => {
    for (const name of ["Rating", "ClockEntry", "Expense", "ExpenseCategory"] as const) {
      expect(TENANT_SCOPED_MODELS).toContain(name);
      await expect((t.models[name] as unknown as { find(): PromiseLike<unknown> }).find()).rejects.toThrow(
        "tenant context missing",
      );
    }
  });

  it("Rating: one per check, but any number without a check", async () => {
    const { Rating } = t.models;
    const tenant = newTenant();
    const base = { serviceDay: "2026-11-10", paidAt: t.clock.now(), submittedAt: t.clock.now() };
    await runWithTenant(tenant, async () => {
      const checkId = new Types.ObjectId();
      await Rating.create({ ...base, checkId, food: 4 });
      await Rating.init();
      await expect(Rating.create({ ...base, checkId, food: 5 })).rejects.toMatchObject({ code: 11000 });
      await expect(Rating.create({ ...base, checkId: null })).resolves.toBeDefined();
      await expect(Rating.create({ ...base, checkId: null })).resolves.toBeDefined();
    });
  });

  it("ClockEntry: a person can't have two open entries", async () => {
    const { ClockEntry } = t.models;
    const tenant = newTenant();
    const staffId = new Types.ObjectId();
    const entry = { staffId, serviceDay: "2026-11-10", in: t.clock.now(), rate: 15000 };
    await runWithTenant(tenant, async () => {
      await ClockEntry.init();
      const first = await ClockEntry.create(entry);
      await expect(ClockEntry.create(entry)).rejects.toMatchObject({ code: 11000 });
      first.out = t.clock.now();
      await first.save();
      await expect(ClockEntry.create(entry)).resolves.toBeDefined();
      await expect(ClockEntry.create({ ...entry, staffId: new Types.ObjectId() })).resolves.toBeDefined();
    });
  });
});
