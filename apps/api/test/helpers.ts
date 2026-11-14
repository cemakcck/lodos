import { randomBytes, randomUUID } from "node:crypto";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { fixedClock } from "../src/clock";
import type { TrustProxy } from "../src/config";
import { runWithTenant } from "../src/db/tenancy";
import { seedRestaurant } from "../src/seed/seed";

/** Every test file gets its own database (helpers is loaded once per file), so files never race on index builds. */
const DB_NAME = `lodos_test_${randomBytes(6).toString("hex")}`;

export const TEST_SECRET = "test-session-secret-0123456789abcdef";
export const TEST_WEB_ORIGIN = "http://localhost:5180";

export function newTenant(): string {
  return `t_${randomBytes(8).toString("hex")}`;
}

function mongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set: is test/global-setup.ts configured?");
  return uri;
}

export async function makeTestApp(
  opts: { now?: Date; demoMode?: boolean; sandboxesPerIpHour?: number; maxSandboxes?: number; trustProxy?: TrustProxy; cookieSecure?: boolean; webDist?: string } = {},
) {
  const clock = fixedClock(opts.now ?? new Date("2026-11-10T17:00:00Z"));
  const built = await buildApp({
    mongoUri: mongoUri(),
    dbName: DB_NAME,
    clock,
    demoMode: opts.demoMode ?? false,
    sessionSecret: TEST_SECRET,
    webOrigin: TEST_WEB_ORIGIN,
    startJobs: false,
    sandboxesPerIpHour: opts.sandboxesPerIpHour,
    maxSandboxes: opts.maxSandboxes,
    trustProxy: opts.trustProxy,
    cookieSecure: opts.cookieSecure,
    webDist: opts.webDist,
  });
  return {
    app: built.app,
    io: built.io,
    models: built.models,
    clock,
    inject: (o: InjectOptions | string): Promise<LightMyRequestResponse> => built.app.inject(o),
    close: built.close,
  };
}

export type TestApp = Awaited<ReturnType<typeof makeTestApp>>;

/**
 * Live service without the 120 days of generated history (and the phase 3 demo): for files that never read sales or the comp log,
 * where the history would only cost seeding time (about a second per tenant).
 */
export const LIVE_NO_HISTORY = { liveService: true, history: false } as const;

/** Seeds a fresh tenant with the Lodos restaurant at the app clock's `now` (live service and history by default). */
export async function seedTenant(t: TestApp, opts: { liveService: boolean; history?: boolean } = { liveService: true }) {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, t.clock.now(), opts);
  return { tenantId, seed };
}

/** A guest client for one table token. `ip` sets the remote address (per-IP rate limits). */
export function guest(t: TestApp, token: string, ip = "127.0.0.1") {
  const headers = { "x-table-token": token };
  return {
    get: (url: string) => t.inject({ method: "GET", url, headers, remoteAddress: ip }),
    post: (url: string, payload: unknown) =>
      t.inject({ method: "POST", url, headers, payload: payload as InjectOptions["payload"], remoteAddress: ip }),
  };
}

/** A seeded menu item by the start of its English name. */
export async function itemNamed(t: TestApp, tenantId: string, enPrefix: string) {
  const escaped = enPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const item = await runWithTenant(tenantId, () => t.models.MenuItem.findOne({ "name.en": new RegExp(`^${escaped}`) }));
  if (!item) throw new Error(`no item named ${enPrefix}`);
  return { id: String(item._id), price: item.price, station: item.station };
}

export const orderBody = (items: { itemId: string; qty?: number; options?: { groupId: string; optionIds: string[] }[]; note?: string }[]) => ({
  idempotencyKey: randomUUID(),
  items: items.map((i) => ({ qty: 1, options: [], ...i })),
});
