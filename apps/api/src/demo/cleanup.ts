import type { Models } from "../db/models";
import { unscoped } from "../db/tenancy";
import { SANDBOX_TTL_MS, deleteSandbox } from "./sandboxes";

export const CLEANUP_INTERVAL_MS = 2 * 60_000;
export const DISCONNECT_GRACE_MS = 30 * 60_000;

/** Deletes sandboxes 30 min after their last window left, or 24 h after creation. Returns how many went. */
export async function runCleanup(
  models: Models,
  now: Date,
  isConnected: (tenantId: string) => boolean,
): Promise<number> {
  const all = await unscoped("sandbox registry is not tenant-scoped", () => models.Sandbox.find({}).lean());
  let deleted = 0;
  for (const s of all) {
    const expired = s.createdAt.getTime() < now.getTime() - SANDBOX_TTL_MS;
    const abandoned = !isConnected(s._id) && s.lastSeenAt.getTime() < now.getTime() - DISCONNECT_GRACE_MS;
    if (expired || abandoned) {
      await deleteSandbox(models, s._id);
      deleted++;
    }
  }
  return deleted;
}
