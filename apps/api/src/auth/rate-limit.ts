import type { Models } from "../db/models";
import { unscoped } from "../db/tenancy";

const since = (windowMs: number, now: Date) => new Date(now.getTime() - windowMs);

/** Events recorded for `key` inside the window (events exactly `windowMs` old have expired). */
export function recentHits(models: Models, key: string, windowMs: number, now: Date): Promise<number> {
  return unscoped("rate limits are keyed, not tenant-scoped", () =>
    models.RateEvent.countDocuments({ key, at: { $gt: since(windowMs, now) } }),
  );
}

/**
 * Records one hit against `key` and returns whether it is allowed (true) or over `limit` within `windowMs` (false).
 * A refused hit is not recorded, so a client that keeps retrying cannot extend its own lockout.
 * Callers prefix keys with the tenant where relevant.
 */
export async function hit(models: Models, key: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
  if ((await recentHits(models, key, windowMs, now)) >= limit) return false;
  await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.create({ key, at: now }));
  return true;
}

export function clearHits(models: Models, key: string): Promise<unknown> {
  return unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.deleteMany({ key }));
}
