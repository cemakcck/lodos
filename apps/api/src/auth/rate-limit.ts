import type { Models } from "../db/models";
import { unscoped } from "../db/tenancy";

const since = (windowMs: number, now: Date) => new Date(now.getTime() - windowMs);

/** Events recorded for `key` inside the window (events exactly `windowMs` old have expired). */
function recentHits(models: Models, key: string, windowMs: number, now: Date): Promise<number> {
  return unscoped("rate limits are keyed, not tenant-scoped", () =>
    models.RateEvent.countDocuments({ key, at: { $gt: since(windowMs, now) } }),
  );
}

/**
 * Records one hit against `key`, then counts the window including it: allowed (true) while the count is within
 * `limit`. Recording first means parallel callers see each other, so a burst cannot slip past the limit.
 * Refused hits stay recorded, so the lock is deterministic under bursts (and retrying while locked extends it).
 * Callers prefix keys with the tenant where relevant.
 */
export async function hit(models: Models, key: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
  await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.create({ key, at: now }));
  return (await recentHits(models, key, windowMs, now)) <= limit;
}

export function clearHits(models: Models, key: string): Promise<unknown> {
  return unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.deleteMany({ key }));
}
