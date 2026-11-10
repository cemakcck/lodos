import { randomBytes } from "node:crypto";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { fixedClock } from "../src/clock";

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

export async function makeTestApp(opts: { now?: Date; demoMode?: boolean; sandboxesPerIpHour?: number; maxSandboxes?: number } = {}) {
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
