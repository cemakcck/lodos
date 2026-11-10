import { io, type Socket } from "socket.io-client";

export type LiveAudience = { audience: "staff" } | { audience: "guest"; tableToken: string };

export interface LiveEvent {
  type: string;
  ids: string[];
  tableId?: string;
  at?: string;
}

interface Entry { socket: Socket; refs: number; unfollow: () => void }
const entries = new Map<string, Entry>();

const keyOf = (o: LiveAudience) => (o.audience === "staff" ? "staff" : `guest:${o.tableToken}`);

/**
 * Follows the browser's network state, so a screen that loses its network says so at once and catches up the
 * moment it is back. Without this a dead connection is only noticed by the heartbeat (up to ~45 s; socket.io
 * skips its own offline handling on localhost), and the first attempt after the network returns waits for the
 * reconnection backoff (up to ~7 s). On "offline" the socket is closed (the screen shows Reconnecting…); on
 * "online" it reconnects straight away, and the connect handler fetches a fresh snapshot.
 */
export function followNetwork(socket: Socket): () => void {
  if (typeof window === "undefined") return () => {};
  let pausedForOffline = false;
  const onOffline = () => {
    if (!socket.active) return;
    pausedForOffline = true;
    socket.disconnect();
  };
  const onOnline = () => {
    if (!pausedForOffline) return;
    pausedForOffline = false;
    socket.connect();
  };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}

/** Ref-counted shared socket per audience. Call the returned release() when done. */
export function acquireSocket(o: LiveAudience): { socket: Socket; release: () => void } {
  const key = keyOf(o);
  let entry = entries.get(key);
  if (!entry) {
    const socket = io({
      path: "/socket.io",
      ...(o.audience === "staff" ? { withCredentials: true } : { auth: { tableToken: o.tableToken } }),
    });
    entry = { socket, refs: 0, unfollow: followNetwork(socket) };
    entries.set(key, entry);
  }
  entry.refs += 1;
  const held = entry;
  let released = false;
  return {
    socket: held.socket,
    release: () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs <= 0) {
        held.unfollow();
        held.socket.close();
        if (entries.get(key) === held) entries.delete(key);
      }
    },
  };
}

/** After the staff cookie changes (PIN login, demo role switch), make the open staff socket re-handshake. */
export function reconnectStaffSocket(): void {
  const entry = entries.get("staff");
  if (entry) entry.socket.disconnect().connect();
}
