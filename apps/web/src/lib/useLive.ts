import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { acquireSocket, type LiveAudience, type LiveEvent } from "./socket";

export type { LiveAudience, LiveEvent };

/** Query keys to invalidate for a live event. Events carry ids only; clients refetch. */
export function invalidationsFor(e: LiveEvent): QueryKey[] {
  const check: QueryKey[] = e.tableId ? [["check", e.tableId]] : [];
  if (e.type.startsWith("ticket.")) return [["kds"], ["floor"], ...check, ["guest", "orders"]];
  if (e.type === "check.updated") return [["floor"], ...check, ["guest", "orders"], ["guest", "table"]];
  if (e.type.startsWith("call.")) return [["floor"], ...check];
  if (e.type === "availability.changed" || e.type === "menu.changed") return [["guest", "menu"], ["kds"], ["manager"]];
  if (e.type === "tables.changed") return [["floor"], ["manager"]];
  return [];
}

const LIVE_KEYS: Record<LiveAudience["audience"], QueryKey[]> = {
  staff: [["kds"], ["floor"], ["check"], ["manager"]],
  guest: [["guest"]],
};

export function useLive(
  opts: LiveAudience,
  onEvent?: (e: LiveEvent) => void,
): { connected: boolean; lastSyncAt: Date | null } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
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
    const onDisconnect = () => setConnected(false);
    const onLive = (e: LiveEvent) => {
      for (const queryKey of invalidationsFor(e)) void qc.invalidateQueries({ queryKey });
      handler.current?.(e);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("event", onLive);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("event", onLive);
      release();
    };
  }, [audience, token, qc]);

  return { connected, lastSyncAt };
}
