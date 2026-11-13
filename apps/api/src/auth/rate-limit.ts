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

/** Forgets every hit and any `claimFirst` window held for `key`. */
export function clearHits(models: Models, key: string): Promise<unknown> {
  return unscoped("rate limits are keyed, not tenant-scoped", () =>
    Promise.all([models.RateEvent.deleteMany({ key }), models.RateClaim.deleteOne({ key })]),
  );
}

/**
 * Like `hit`, but a refused hit is removed again, so refusals never extend the window: a cooldown ("once per 60 s")
 * reopens exactly `windowMs` after the last *allowed* hit. Parallel callers still see each other (insert, then count);
 * in a tie both may be refused, never both allowed.
 */
export async function claim(models: Models, key: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
  const event = await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.create({ key, at: now }));
  if ((await recentHits(models, key, windowMs, now)) <= limit) return true;
  await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.deleteOne({ _id: event._id }));
  return false;
}

/**
 * Single-winner claim: exactly one of any set of parallel callers is allowed per window. One document per key holds
 * the winning claim's time; a caller wins by moving that time forward when it is at least `windowMs` old, or by
 * inserting it when there is none. Both are one atomic upsert against the unique key, so a concurrent (or
 * clock-skewed) second caller hits the duplicate key and is refused. Refusals write nothing, so they never extend
 * the window.
 */
export async function claimFirst(models: Models, key: string, windowMs: number, now: Date): Promise<boolean> {
  try {
    await unscoped("rate limits are keyed, not tenant-scoped", () =>
      models.RateClaim.updateOne({ key, at: { $lte: since(windowMs, now) } }, { $set: { at: now } }, { upsert: true }),
    );
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}
