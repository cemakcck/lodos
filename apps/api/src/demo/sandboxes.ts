import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hit } from "../auth/rate-limit";
import { SANDBOX_COOKIE } from "../auth/login-tenant";
import { sessionCookieOptions } from "../auth/guard";
import { TENANT_SCOPED_MODELS, type Models } from "../db/models";
import { runWithTenant, unscoped } from "../db/tenancy";
import { ApiError } from "../errors";
import { seedRestaurant } from "../seed/seed";

export const SANDBOX_TTL_MS = 24 * 3_600_000;
export const IDLE_MS = 2 * 60_000;
export const DEFAULT_MAX_SANDBOXES = 200;
export const DEFAULT_SANDBOXES_PER_IP_HOUR = 5;

export type SandboxOpts = {
  isConnected: (tenantId: string) => boolean;
  maxSandboxes?: number;
  perIpHour?: number;
};

const newSandboxId = (): string => `sb_${randomBytes(16).toString("hex")}`;

/** Removes every tenant-scoped document of the sandbox (sessions included), then the Sandbox record. */
/** The model union has no common filter type; every scoped model accepts `{}`. */
type Deletable = { deleteMany(filter: object): PromiseLike<unknown> };

export async function deleteSandbox(models: Models, tenantId: string): Promise<void> {
  await runWithTenant(tenantId, async () => {
    await Promise.all(TENANT_SCOPED_MODELS.map((name) => (models[name] as unknown as Deletable).deleteMany({})));
  });
  await unscoped("sandbox registry is not tenant-scoped", () => models.Sandbox.deleteOne({ _id: tenantId }));
}

/** Frees one slot by deleting the oldest idle sandbox (not connected, unseen for 2 minutes); false when none is idle. */
async function evictIdle(models: Models, now: Date, isConnected: (id: string) => boolean): Promise<boolean> {
  const idle = await unscoped("sandbox registry is not tenant-scoped", () =>
    models.Sandbox.find({
      lastSeenAt: { $lt: new Date(now.getTime() - IDLE_MS) },
    })
      .sort({ lastSeenAt: 1 })
      .lean(),
  );
  const victim = idle.find((s) => !isConnected(s._id));
  if (!victim) return false;
  await deleteSandbox(models, victim._id);
  return true;
}

/**
 * The visitor's sandbox: from the signed `lodos_sb` cookie when it names a live sandbox, otherwise a freshly
 * seeded one (rate-limited per IP, capped overall) whose cookie is set on `reply`.
 */
export async function ensureSandbox(
  models: Models,
  req: FastifyRequest,
  reply: FastifyReply,
  now: Date,
  opts: SandboxOpts,
): Promise<{ tenantId: string; created: boolean }> {
  const raw = req.cookies[SANDBOX_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (unsigned?.valid && unsigned.value) {
    const existing = await unscoped("sandbox registry is not tenant-scoped", () =>
      models.Sandbox.findOneAndUpdate({ _id: unsigned.value }, { $set: { lastSeenAt: now } }),
    );
    if (existing) return { tenantId: existing._id, created: false };
  }

  if (
    !(await hit(models, `sandbox-create:${req.ip}`, opts.perIpHour ?? DEFAULT_SANDBOXES_PER_IP_HOUR, 3_600_000, now))
  ) {
    throw new ApiError(429, "rate_limited", "Too many demo sessions from this address, try again later");
  }
  const max = opts.maxSandboxes ?? DEFAULT_MAX_SANDBOXES;
  const count = await unscoped("sandbox registry is not tenant-scoped", () => models.Sandbox.countDocuments({}));
  if (count >= max && !(await evictIdle(models, now, opts.isConnected))) {
    throw new ApiError(503, "demo_busy", "The demo is full right now, please try again in a few minutes");
  }

  const tenantId = newSandboxId();
  await unscoped("sandbox registry is not tenant-scoped", () =>
    models.Sandbox.create({ _id: tenantId, createdAt: now, lastSeenAt: now }),
  );
  await seedRestaurant(models, tenantId, now, { liveService: true });
  void reply.setCookie(SANDBOX_COOKIE, tenantId, {
    ...sessionCookieOptions(SANDBOX_TTL_MS, req.server.cookieSecure),
    signed: true,
  });
  return { tenantId, created: true };
}
