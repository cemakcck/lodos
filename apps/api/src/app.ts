import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { registerAuthRoutes } from "./auth/routes";
import { registerCheckRoutes } from "./checks/routes";
import { CLEANUP_INTERVAL_MS, runCleanup } from "./demo/cleanup";
import { SIMULATOR_INTERVAL_MS, runSimulatorDue } from "./demo/simulator";
import { registerDemoRoutes } from "./demo/routes";
import { systemClock, type Clock } from "./clock";
import type { TrustProxy } from "./config";
import { connectDb } from "./db/connect";
import { bindModels, type Models } from "./db/models/index";
import { registerErrorHandling } from "./errors";
import { registerFloorRoutes } from "./floor/routes";
import { registerGuestRoutes } from "./guest/routes";
import { registerKdsRoutes } from "./kds/routes";
import { registerManagerRoutes } from "./manager/routes";
import { registerMenuRoutes } from "./menu/routes";
import { registerWeb } from "./web";
import { unscoped } from "./db/tenancy";
import { socketRealtime, type Realtime } from "./realtime/emit";
import { attachRealtime } from "./realtime/io";
import { createPresence, type Presence } from "./realtime/presence";

declare module "fastify" {
  interface FastifyInstance {
    clock: Clock;
    models: Models;
    io: Server;
    demoMode: boolean;
    /** Session and sandbox cookies are `Secure` (config COOKIE_SECURE). */
    cookieSecure: boolean;
    /** Open sockets per tenant (in memory); keeps `Sandbox.lastSeenAt` fresh while a sandbox has any. */
    presence: Presence;
    /** Post-commit event fan-out to the tenant's Socket.IO rooms (src/realtime/emit.ts). */
    realtime: Realtime;
  }
}

export type BuildAppOptions = {
  mongoUri: string;
  /** Overrides the database in the URI (tests use one database per file). */
  dbName?: string;
  clock?: Clock;
  demoMode?: boolean;
  sessionSecret: string;
  webOrigin: string;
  /** Background jobs (sandbox cleanup, simulator) arrive in later tasks. */
  startJobs?: boolean;
  /** Sandbox creations allowed per IP per hour (default 5). */
  sandboxesPerIpHour?: number;
  /** Maximum concurrent sandboxes (default 200). */
  maxSandboxes?: number;
  logger?: boolean;
  /** Fastify `trustProxy` (config TRUST_PROXY); default false. */
  trustProxy?: TrustProxy;
  /** Default false (config COOKIE_SECURE defaults it to NODE_ENV === "production"). */
  cookieSecure?: boolean;
  /** Built web app to serve on the same origin (config WEB_DIST); unset in dev, where Vite serves it. */
  webDist?: string;
};

/** A hop count becomes "trust the nearest n hops" (Fastify's types take no number). */
const fastifyTrustProxy = (v: TrustProxy) => (typeof v === "number" ? (_addr: string, hop: number) => hop < v : v);

export async function buildApp(opts: BuildAppOptions): Promise<{
  app: FastifyInstance;
  io: Server;
  clock: Clock;
  models: Models;
  close(): Promise<void>;
}> {
  const clock = opts.clock ?? systemClock;
  const { conn, models } = await connectDb(opts.mongoUri, { dbName: opts.dbName });
  const unbind = bindModels(models);

  const app = Fastify({ logger: opts.logger ?? false, trustProxy: fastifyTrustProxy(opts.trustProxy ?? false) });
  app.decorate("clock", clock);
  app.decorate("models", models);
  const demoMode = opts.demoMode ?? false;
  app.decorate("demoMode", demoMode);
  app.decorate("cookieSecure", opts.cookieSecure ?? false);
  const presence = createPresence({
    clock,
    // Only sandboxes are cleaned up, so only they record when they were last seen. `$max` never moves it back, and
    // a tenant without a Sandbox record (the real restaurant, a deleted sandbox) matches nothing.
    persist: (tenantId, at) =>
      demoMode
        ? unscoped("sandbox registry is not tenant-scoped", () =>
            models.Sandbox.updateOne({ _id: tenantId }, { $max: { lastSeenAt: at } }),
          )
        : Promise.resolve(),
    onError: (err) => app.log.error({ err }, "presence write failed"),
  });
  app.decorate("presence", presence);

  await app.register(helmet);
  await app.register(cors, { origin: opts.webOrigin, credentials: true });
  await app.register(cookie, { secret: opts.sessionSecret });
  registerErrorHandling(app, { appShell: opts.webDist !== undefined });
  if (opts.webDist) await registerWeb(app, opts.webDist);

  app.get("/api/health", async () => ({ ok: true }));
  registerAuthRoutes(app);
  registerKdsRoutes(app);
  registerFloorRoutes(app);
  registerCheckRoutes(app);
  registerManagerRoutes(app);
  registerMenuRoutes(app);
  registerGuestRoutes(app);
  if (app.demoMode) registerDemoRoutes(app, { perIpHour: opts.sandboxesPerIpHour, maxSandboxes: opts.maxSandboxes });

  const io = new Server(app.server, { cors: { origin: opts.webOrigin, credentials: true } });
  app.decorate("io", io);
  app.decorate("realtime", socketRealtime(io, clock, (err) => app.log.error({ err }, "realtime emit failed")));
  attachRealtime(io, { models, clock, presence, parseCookie: (h) => app.parseCookie(h), log: app.log });

  await app.ready();
  presence.start();

  let cleanupTimer: NodeJS.Timeout | undefined;
  let simulatorTimer: NodeJS.Timeout | undefined;
  if (opts.startJobs && app.demoMode) {
    cleanupTimer = setInterval(() => {
      runCleanup(models, clock.now(), (id) => app.presence.isConnected(id)).catch((err: unknown) =>
        app.log.error({ err }, "sandbox cleanup failed"),
      );
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
    let simulating = false;
    simulatorTimer = setInterval(() => {
      if (simulating) return;
      simulating = true;
      runSimulatorDue(
        models,
        app.realtime,
        clock.now(),
        (id) => app.presence.isConnected(id),
        Math.random,
        (err, id) => app.log.error({ err, tenantId: id }, "demo simulator tick failed"),
      )
        .catch((err: unknown) => app.log.error({ err }, "demo simulator failed"))
        .finally(() => {
          simulating = false;
        });
    }, SIMULATOR_INTERVAL_MS);
    simulatorTimer.unref();
  }

  let closed = false;
  return {
    app,
    io,
    clock,
    models,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(cleanupTimer);
      clearInterval(simulatorTimer);
      // Closing io disconnects every socket; their final lastSeenAt writes finish before the models go.
      await io.close();
      await presence.stop();
      unbind();
      await app.close();
      await conn.close();
    },
  };
}
