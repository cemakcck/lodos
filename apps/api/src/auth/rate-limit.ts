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
 * Single-winner claim: exactly one of any set of parallel callers is allowed per window. Inserts an event, then the
 * caller wins iff its event is the earliest in the window (ties broken by `_id`), so a tie cannot refuse everyone
 * the way `claim`'s insert-then-count can. Refused events are removed, so refusals never extend the window.
 */
export async function claimFirst(models: Models, key: string, windowMs: number, now: Date): Promise<boolean> {
  const mine = await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.create({ key, at: now }));
  const first = await unscoped("rate limits are keyed, not tenant-scoped", () =>
    models.RateEvent.findOne({ key, at: { $gt: since(windowMs, now) } })
      .sort({ at: 1, _id: 1 })
      .lean(),
  );
  if (first && String(first._id) === String(mine._id)) return true;
  await unscoped("rate limits are keyed, not tenant-scoped", () => models.RateEvent.deleteOne({ _id: mine._id }));
  return false;
}
