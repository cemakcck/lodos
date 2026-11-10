import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { StaffRole } from "@lodos/shared";
import type { Types } from "mongoose";
import { z } from "zod";
import { hashPin, PinSchema, verifyPin } from "../auth/pin";
import { connectDb } from "../db/connect";
import type { Models } from "../db/models";
import { runWithTenant } from "../db/tenancy";
import { STAFF } from "../seed/content";
import { seedRestaurant } from "../seed/seed";

const StaffSpec = z
  .string()
  .transform((s) => s.split(":"))
  .pipe(z.tuple([z.string().trim().min(1), StaffRole, PinSchema]));

export type SetupDeps = {
  /** Skips connecting (tests). */
  models?: Models;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  log?: (line: string) => void;
};

/**
 * Bootstraps a real restaurant: creates the tenant, optionally seeds the menu and tables (no live service,
 * no demo staff), and upserts the given staff by name.
 *   --tenant main --seed-menu --staff "Selin:manager:482910" --staff "Deniz:waiter:1234"
 */
export async function runSetup(args: string[], deps: SetupDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  if (env.DEMO_MODE === "1" || env.DEMO_MODE === "true") {
    throw new Error("Refusing to run setup with DEMO_MODE=1: demo instances use sandboxes, not real staff.");
  }
  const { values } = parseArgs({
    args,
    options: {
      tenant: { type: "string", default: "main" },
      "seed-menu": { type: "boolean", default: false },
      staff: { type: "string", multiple: true, default: [] },
    },
    strict: true,
  });
  const staff = (values.staff ?? []).map((spec) => {
    const parsed = StaffSpec.safeParse(spec);
    if (!parsed.success) throw new Error(`Invalid --staff "${spec.replace(/:[^:]*$/, ":***")}": expected Name:role:PIN (role waiter|kitchen|bar|manager, PIN 4-6 digits)`);
    return parsed.data;
  });
  const tenantId = values.tenant ?? "main";

  let close: (() => Promise<void>) | undefined;
  let models = deps.models;
  if (!models) {
    if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
    const db = await connectDb(env.MONGODB_URI);
    models = db.models;
    close = () => db.conn.close();
  }
  const m = models;
  const now = deps.now ?? new Date();

  try {
    const exists = await runWithTenant(tenantId, () => m.Tenant.exists({}));
    if (!exists) {
      if (values["seed-menu"]) {
        await seedRestaurant(m, tenantId, now, { liveService: false });
        log(`Seeded menu and tables for tenant "${tenantId}"`);
      } else {
        await runWithTenant(tenantId, () => m.Tenant.create({ name: "Lodos", createdAt: now }));
        log(`Created tenant "${tenantId}"`);
      }
    } else if (values["seed-menu"]) {
      log(`Tenant "${tenantId}" already exists; menu not re-seeded`);
    }
    await removeDemoStaff(m, tenantId, log);

    for (const [name, role, pin] of staff) {
      const pinHash = await hashPin(pin);
      await runWithTenant(tenantId, () =>
        m.Staff.updateOne({ name }, { $set: { role, pinHash, active: true } }, { upsert: true }),
      );
      log(`Staff ${name} (${role}) ready`);
    }
  } finally {
    await close?.();
  }
}

/**
 * The seed ships staff with public PINs. Runs on every setup (so a half-finished earlier run is repaired):
 * removes staff that still have a demo name, role and demo PIN, and detaches tables from them.
 */
async function removeDemoStaff(m: Models, tenantId: string, log: (line: string) => void): Promise<void> {
  await runWithTenant(tenantId, async () => {
    const current = await m.Staff.find({ name: { $in: STAFF.map((s) => s.name) } });
    const demoIds: Types.ObjectId[] = [];
    for (const s of current) {
      const demo = STAFF.find((d) => d.name === s.name && d.role === s.role);
      if (demo && (await verifyPin(s.pinHash, demo.pin))) demoIds.push(s._id);
    }
    if (demoIds.length === 0) return;
    await m.Staff.deleteMany({ _id: { $in: demoIds } });
    await m.Table.updateMany({ sectionStaffId: { $in: demoIds } }, { $set: { sectionStaffId: null } });
    log(`Removed ${demoIds.length} demo staff`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, "../../../../.env"));
  } catch {
    // no .env file: rely on the environment
  }
  runSetup(process.argv.slice(2)).then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
