import type { Clock } from "../clock";

export const PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * In-memory socket presence, per tenant. One API instance in phase 1 (spec §8.3), so a process-local count is the
 * truth. Sandbox cleanup (Task 6) reads `isConnected` live and also needs `Sandbox.lastSeenAt` fresh, so `persist`
 * is called on every connect, every disconnect, and every `heartbeatMs` for each tenant with an open socket.
 */
export type Presence = {
  connect(tenantId: string): void;
  disconnect(tenantId: string): void;
  isConnected(tenantId: string): boolean;
  /** Open sockets of the tenant. */
  count(tenantId: string): number;
  /** Persists `lastSeenAt = clock.now()` for every connected tenant (what the interval runs). */
  heartbeat(): Promise<void>;
  /** Resolves once every persist started so far has finished (tests, shutdown). */
  settled(): Promise<void>;
  /** Starts the unref'd heartbeat interval. */
  start(): void;
  /** Clears the interval and waits for in-flight writes. */
  stop(): Promise<void>;
};

export type PresenceOptions = {
  clock: Clock;
  /** Records that `tenantId` was seen at `at`. A no-op for tenants that are not sandboxes. */
  persist: (tenantId: string, at: Date) => Promise<unknown>;
  onError: (err: unknown) => void;
  heartbeatMs?: number;
};

export function createPresence(opts: PresenceOptions): Presence {
  const counts = new Map<string, number>();
  const inflight = new Set<Promise<unknown>>();
  let timer: NodeJS.Timeout | undefined;

  const write = (tenantId: string): Promise<unknown> => {
    const p = Promise.resolve()
      .then(() => opts.persist(tenantId, opts.clock.now()))
      .catch(opts.onError)
      .finally(() => inflight.delete(p));
    inflight.add(p);
    return p;
  };

  const presence: Presence = {
    connect(tenantId) {
      counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
      void write(tenantId);
    },
    disconnect(tenantId) {
      const n = (counts.get(tenantId) ?? 0) - 1;
      if (n > 0) counts.set(tenantId, n);
      else counts.delete(tenantId);
      void write(tenantId);
    },
    isConnected: (tenantId) => (counts.get(tenantId) ?? 0) > 0,
    count: (tenantId) => counts.get(tenantId) ?? 0,
    async heartbeat() {
      await Promise.all([...counts.keys()].map(write));
    },
    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
    start() {
      if (timer) return;
      timer = setInterval(() => void presence.heartbeat(), opts.heartbeatMs ?? PRESENCE_HEARTBEAT_MS);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await presence.settled();
    },
  };
  return presence;
}
