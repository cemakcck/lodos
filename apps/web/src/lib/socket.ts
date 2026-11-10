import { io, type Socket } from "socket.io-client";

export type LiveAudience = { audience: "staff" } | { audience: "guest"; tableToken: string };

export interface LiveEvent {
  type: string;
  ids: string[];
  tableId?: string;
  at?: string;
}

interface Entry { socket: Socket; refs: number }
const entries = new Map<string, Entry>();

const keyOf = (o: LiveAudience) => (o.audience === "staff" ? "staff" : `guest:${o.tableToken}`);

/** Ref-counted shared socket per audience. Call the returned release() when done. */
export function acquireSocket(o: LiveAudience): { socket: Socket; release: () => void } {
  const key = keyOf(o);
  let entry = entries.get(key);
  if (!entry) {
    const socket = io({
      path: "/socket.io",
      ...(o.audience === "staff" ? { withCredentials: true } : { auth: { tableToken: o.tableToken } }),
    });
    entry = { socket, refs: 0 };
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
        held.socket.close();
        if (entries.get(key) === held) entries.delete(key);
      }
    },
  };
}
