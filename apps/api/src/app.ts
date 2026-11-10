import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { registerAuthRoutes } from "./auth/routes";
import { CLEANUP_INTERVAL_MS, runCleanup } from "./demo/cleanup";
import { registerDemoRoutes } from "./demo/routes";
import { systemClock, type Clock } from "./clock";
import { connectDb } from "./db/connect";
import { bindModels, type Models } from "./db/models/index";
import { registerErrorHandling } from "./errors";
import { registerFloorRoutes } from "./floor/routes";
import { registerKdsRoutes } from "./kds/routes";
import { registerManagerRoutes } from "./manager/routes";

declare module "fastify" {
  interface FastifyInstance {
    clock: Clock;
    models: Models;
    io: Server;
    demoMode: boolean;
    /** Who is connected right now. Task 8 replaces `isConnected` with the real socket presence. */
    presence: { isConnected(tenantId: string): boolean };
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
};

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

  const app = Fastify({ logger: opts.logger ?? false });
  app.decorate("clock", clock);
  app.decorate("models", models);
  app.decorate("demoMode", opts.demoMode ?? false);
  app.decorate("presence", { isConnected: () => false });

  await app.register(helmet);
  await app.register(cors, { origin: opts.webOrigin, credentials: true });
  await app.register(cookie, { secret: opts.sessionSecret });
  registerErrorHandling(app);

  app.get("/api/health", async () => ({ ok: true }));
  registerAuthRoutes(app);
  registerKdsRoutes(app);
  registerFloorRoutes(app);
  registerManagerRoutes(app);
  if (app.demoMode) registerDemoRoutes(app, { perIpHour: opts.sandboxesPerIpHour, maxSandboxes: opts.maxSandboxes });

  // Rooms, auth and events are wired in Task 8.
  const io = new Server(app.server, { cors: { origin: opts.webOrigin, credentials: true } });
  app.decorate("io", io);

  await app.ready();

  let cleanupTimer: NodeJS.Timeout | undefined;
  if (opts.startJobs && app.demoMode) {
    cleanupTimer = setInterval(() => {
      runCleanup(models, clock.now(), (id) => app.presence.isConnected(id)).catch((err: unknown) =>
        app.log.error({ err }, "sandbox cleanup failed"),
      );
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
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
      unbind();
      await io.close();
      await app.close();
      await conn.close();
    },
  };
}
