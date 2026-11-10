import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import type { TestApp } from "./helpers";

/** The single wire channel and its payload (see src/realtime/io.ts). */
export type WireEvent = { type: string; ids: string[]; tableId?: string; at: string };

export type Creds = { sid?: string; tableToken?: string; cookie?: string };

/** Starts the test app on an ephemeral port (never 3000/3100) and returns its base URL. */
export async function listen(t: TestApp): Promise<string> {
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = t.app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const open = new Set<Socket>();

function makeSocket(url: string, creds: Creds): Socket {
  const cookie = creds.cookie ?? (creds.sid ? `lodos_sid=${creds.sid}` : undefined);
  const socket = ioClient(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    timeout: 5_000,
    extraHeaders: cookie ? { cookie } : {},
    auth: creds.tableToken !== undefined ? { tableToken: creds.tableToken } : {},
  });
  open.add(socket);
  return socket;
}

/** Disconnects every socket the helpers opened (call in afterEach/afterAll). */
export function closeSockets(): void {
  for (const s of open) s.disconnect();
  open.clear();
}

export type Client = {
  socket: Socket;
  /** Every event received so far, in order. */
  events: WireEvent[];
  /** Resolves with the first received event (past or future) matching `pred`; rejects after `ms`. */
  next(pred: (e: WireEvent) => boolean, ms?: number): Promise<WireEvent>;
  close(): void;
};

/** Connects and resolves once the server accepted the handshake. */
export function connect(url: string, creds: Creds): Promise<Client> {
  const socket = makeSocket(url, creds);
  const events: WireEvent[] = [];
  const waiters: { pred: (e: WireEvent) => boolean; resolve: (e: WireEvent) => void }[] = [];
  socket.on("event", (e: WireEvent) => {
    events.push(e);
    for (const w of [...waiters]) {
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  });
  const client: Client = {
    socket,
    events,
    next(pred, ms = 2_000) {
      const seen = events.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const w = {
          pred,
          resolve: (e: WireEvent) => {
            clearTimeout(timer);
            resolve(e);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`no matching event within ${ms} ms; got ${JSON.stringify(events)}`));
        }, ms);
        waiters.push(w);
      });
    },
    close() {
      socket.disconnect();
      open.delete(socket);
    },
  };
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(client));
    socket.once("connect_error", (err) => {
      client.close();
      reject(err);
    });
  });
}

/** Resolves with the `connect_error` message; rejects if the handshake is accepted. */
export function connectError(url: string, creds: Creds): Promise<string> {
  const socket = makeSocket(url, creds);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => {
      socket.disconnect();
      reject(new Error("handshake was accepted"));
    });
    socket.once("connect_error", (err) => {
      socket.disconnect();
      open.delete(socket);
      resolve(err.message);
    });
  });
}

/** Polls `cond` until true (server-side effects of a client action); rejects after `ms`. */
export async function until(cond: () => boolean | Promise<boolean>, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
