import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../src/db/tenancy";
import { guest, itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

/** Review Focus 1: a tampered client's invalid option selections are rejected with 400, never accepted. */
let t: TestApp;
let tenantId: string;
let token: string;
let tableId: string;
let ribeye: { id: string };
let negroni: { id: string };

beforeAll(async () => {
  t = await makeTestApp({ now: new Date("2026-11-10T17:00:00Z") });
  const s = await seedTenant(t);
  tenantId = s.tenantId;
  token = s.seed.tables.T7!.token;
  tableId = s.seed.tables.T7!.id;
  ribeye = await itemNamed(t, tenantId, "Dry-aged ribeye");
  negroni = await itemNamed(t, tenantId, "Lodos Negroni");
});
afterAll(() => t.close());

async function expectRejected(items: Parameters<typeof orderBody>[0], mentions: string) {
  const res = await guest(t, token).post("/api/guest/orders", orderBody(items));
  expect(res.statusCode).toBe(400);
  const { error } = res.json();
  expect(error.code).toBe("validation");
  expect(JSON.stringify(error)).toContain(mentions);
  // Nothing was written: no check, no order, no decrement.
  await runWithTenant(tenantId, async () => {
    expect(await t.models.Check.countDocuments({ tableId })).toBe(0);
    expect(await t.models.Order.countDocuments({ tableId })).toBe(0);
  });
}

describe("invalid option selections → 400 validation naming the group", () => {
  it("a required single-choice group is missing", async () => {
    await expectRejected([{ itemId: ribeye.id, options: [] }], "doneness");
  });

  it("two options in a single-choice group", async () => {
    await expectRejected([{ itemId: ribeye.id, options: [{ groupId: "doneness", optionIds: ["rare", "medium"] }] }], "doneness");
  });

  it("an option id that belongs to another item", async () => {
    // "rare" is a ribeye doneness option, sent under the Negroni's gin group.
    await expectRejected([{ itemId: negroni.id, options: [{ groupId: "gin", optionIds: ["rare"] }] }], "gin");
  });

  it("a group id that belongs to another item", async () => {
    await expectRejected(
      [{ itemId: negroni.id, options: [{ groupId: "gin", optionIds: ["london-dry"] }, { groupId: "doneness", optionIds: ["rare"] }] }],
      "doneness",
    );
  });

  it("duplicate picks in a group", async () => {
    await expectRejected([{ itemId: ribeye.id, options: [{ groupId: "doneness", optionIds: ["rare"] }, { groupId: "doneness", optionIds: ["rare"] }] }], "doneness");
  });

  it.each([0, -1, 1.5, 21])("qty %s is rejected", async (qty) => {
    await expectRejected([{ itemId: ribeye.id, qty, options: [{ groupId: "doneness", optionIds: ["rare"] }] }], "qty");
  });

  it("the error names the offending item", async () => {
    const res = await guest(t, token).post("/api/guest/orders", orderBody([{ itemId: ribeye.id }]));
    expect(res.json().error.details).toMatchObject({ itemId: ribeye.id });
  });
});
