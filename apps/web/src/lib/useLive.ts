import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { acquireSocket, type LiveAudience, type LiveEvent } from "./socket";

export type { LiveAudience, LiveEvent };

/** Query keys to invalidate for a live event. Events carry ids only; clients refetch. */
export function invalidationsFor(e: LiveEvent): QueryKey[] {
  const check: QueryKey[] = e.tableId ? [["check", e.tableId]] : [];
  if (e.type.startsWith("ticket.")) return [["kds"], ["floor"], ...check, ["guest", "orders"], ["split"]];
  if (e.type === "check.updated") return [["floor"], ...check, ["guest", "orders"], ["guest", "table"], ["split"]];
  if (e.type === "split.updated" || e.type === "adjustment.changed") return [["split"], ["floor"], ...check];
  if (e.type.startsWith("call.")) return [["floor"], ...check];
  if (e.type === "availability.changed" || e.type === "menu.changed") return [["guest", "menu"], ["menu"], ["kds"], ["manager"]];
  // A saved floor plan moves, adds and removes tables: waiter floors refetch it.
  if (e.type === "tables.changed" || e.type === "layout.saved") return [["floor"], ["manager"]];
  if (e.type === "clock.changed") return [["timesheets"]];
  return [];
}

const LIVE_KEYS: Record<LiveAudience["audience"], QueryKey[]> = {
  staff: [["kds"], ["floor"], ["check"], ["split"], ["menu"], ["manager"], ["timesheets"]],
  guest: [["guest"]],
};

export interface LiveState {
  connected: boolean;
  lastSyncAt: Date | null;
  /**
   * The server refused or dropped this socket for good: a `connect_error` "unauthorized", or a second
   * server-initiated disconnect (the first is retried once). Staff screens send the user to the login.
   */
  authFailed: boolean;
}

export function useLive(opts: LiveAudience, onEvent?: (e: LiveEvent) => void): LiveState {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const token = opts.audience === "guest" ? opts.tableToken : "";
  const audience = opts.audience;

  useEffect(() => {
    const { socket, release } = acquireSocket(audience === "staff" ? { audience } : { audience, tableToken: token });
    const onConnect = () => {
      setConnected(true);
      // Snapshot on every connect and reconnect: never miss an order.
      for (const queryKey of LIVE_KEYS[audience]) void qc.invalidateQueries({ queryKey });
      setLastSyncAt(new Date());
    };
    let serverKicks = 0;
    const onDisconnect = (reason?: string) => {
      setConnected(false);
      // socket.io does not reconnect after the server closes the socket. Try once; a second kick is final.
      if (reason === "io server disconnect") {
        serverKicks += 1;
        if (serverKicks === 1) socket.connect();
        else setAuthFailed(true);
      }
    };
    const onConnectError = (err: Error) => {
      if (err?.message === "unauthorized") setAuthFailed(true);
    };
    const onLive = (e: LiveEvent) => {
      for (const queryKey of invalidationsFor(e)) void qc.invalidateQueries({ queryKey });
      handler.current?.(e);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("event", onLive);
    if (socket.connected) onConnect();
    // "Last updated" also moves on every successful snapshot refetch of a query this screen follows (an event, the
    // KDS backstop poll), not only on reconnect. A manual cache write is not a snapshot.
    const roots = new Set(LIVE_KEYS[audience].map((k) => k[0]));
    const unwatch = qc.getQueryCache().subscribe((ev) => {
      if (ev.type !== "updated" || ev.action.type !== "success" || ev.action.manual) return;
      if (roots.has(ev.query.queryKey[0])) setLastSyncAt(new Date());
    });
    return () => {
      unwatch();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("event", onLive);
      release();
    };
  }, [audience, token, qc]);

  return { connected, lastSyncAt, authFailed };
}
