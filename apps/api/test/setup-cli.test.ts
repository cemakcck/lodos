import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRestaurant } from "../src/seed/seed";
import { runWithTenant } from "../src/db/tenancy";
import { runSetup } from "../src/scripts/setup";
import { makeTestApp, newTenant } from "./helpers";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

const env = { MONGODB_URI: "unused" };

describe("runSetup", () => {
  it("creates the tenant, menu and staff whose PINs verify, and is idempotent", async () => {
    const tenant = newTenant();
    const args = ["--tenant", tenant, "--seed-menu", "--staff", "Selin:manager:482910", "--staff", "Deniz:waiter:1234"];
    await runSetup(args, { models: t.models, env, log: () => {} });
    await runSetup([...args, "--staff", "Deniz:waiter:5678"], { models: t.models, env, log: () => {} });

    const [staff, tenants, tables, items] = await runWithTenant(tenant, () =>
      Promise.all([t.models.Staff.find(), t.models.Tenant.countDocuments(), t.models.Table.find(), t.models.MenuItem.countDocuments()]),
    );
    expect(staff.map((s) => s.name).sort()).toEqual(["Deniz", "Selin"]); // demo staff are gone
    expect(tenants).toBe(1);
    expect(items).toBeGreaterThan(0);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((x) => x.sectionStaffId === null)).toBe(true);
    const selin = staff.find((s) => s.name === "Selin")!;
    const deniz = staff.find((s) => s.name === "Deniz")!;
    expect(selin.role).toBe("manager");
    expect(await argon2.verify(selin.pinHash, "482910")).toBe(true);
    expect(await argon2.verify(deniz.pinHash, "5678")).toBe(true); // upserted
    expect(await argon2.verify(deniz.pinHash, "1234")).toBe(false);
  });

  it("repairs a half-finished run: demo staff left on a seeded tenant are removed", async () => {
    const tenant = newTenant();
    const now = new Date("2026-11-10T17:00:00Z");
    await seedRestaurant(t.models, tenant, now, { liveService: false }); // seeded, cleanup never ran
    await runSetup(["--tenant", tenant, "--staff", "Zeynep:manager:482910"], { models: t.models, env, log: () => {} });
    const [staff, tables] = await runWithTenant(tenant, () => Promise.all([t.models.Staff.find(), t.models.Table.find()]));
    expect(staff.map((s) => s.name)).toEqual(["Zeynep"]);
    expect(tables.every((x) => x.sectionStaffId === null)).toBe(true);
  });

  it("keeps a real staff member who merely shares a demo name", async () => {
    const tenant = newTenant();
    await runSetup(["--tenant", tenant, "--staff", "Selin:manager:482910"], { models: t.models, env, log: () => {} });
    await runSetup(["--tenant", tenant], { models: t.models, env, log: () => {} });
    const staff = await runWithTenant(tenant, () => t.models.Staff.find());
    expect(staff.map((s) => s.name)).toEqual(["Selin"]);
  });

  it("refuses when DEMO_MODE=1", async () => {
    await expect(runSetup(["--tenant", newTenant()], { models: t.models, env: { ...env, DEMO_MODE: "1" }, log: () => {} })).rejects.toThrow(/DEMO_MODE/);
  });

  it("rejects bad staff specs", async () => {
    const run = (spec: string) => runSetup(["--tenant", newTenant(), "--staff", spec], { models: t.models, env, log: () => {} });
    await expect(run("Selin:boss:1234")).rejects.toThrow();
    await expect(run("Selin:manager:12")).rejects.toThrow();
    await expect(run("Selin")).rejects.toThrow();
  });
});
