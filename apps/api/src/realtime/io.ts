import { room, tableRoom, type StaffRole } from "@lodos/shared";
import type { Server, Socket } from "socket.io";
import { SESSION_COOKIE, resolveSession } from "../auth/sessions";
import type { Clock } from "../clock";
import type { Models } from "../db/models";
import { resolveTable } from "../guest/guard";
import { allRoom } from "./emit";
import type { Presence } from "./presence";

/** Who a socket is, settled once at the handshake. Stored on `socket.data`. */
export type SocketIdentity =
  | { kind: "staff"; tenantId: string; staffId: string; role: StaffRole }
  | { kind: "guest"; tenantId: string; tableId: string };

export type RealtimeDeps = {
  models: Models;
  clock: Clock;
  presence: Presence;
  parseCookie: (header: string) => Record<string, string | undefined>;
  log: { error(obj: unknown, msg: string): void };
};

const STAFF_ROOMS: Record<StaffRole, readonly ("kitchen" | "bar" | "floor" | "manager")[]> = {
  kitchen: ["kitchen"],
  bar: ["bar"],
  waiter: ["floor"],
  manager: ["floor", "manager", "kitchen", "bar"],
};

/** Every room the identity belongs to: its role or table room(s), plus the tenant's `all` room. */
export function roomsOf(id: SocketIdentity): string[] {
  const own = id.kind === "guest" ? [tableRoom(id.tenantId, id.tableId)] : STAFF_ROOMS[id.role].map((k) => room(id.tenantId, k));
  return [...own, allRoom(id.tenantId)];
}

/**
 * Handshake rule:
 * - `auth.tableToken` present (any value) → guest. The token alone decides: unknown token or inactive table →
 *   `unauthorized`, and the staff cookie is ignored even if valid. A guest page in a browser that also holds a staff
 *   session must join its table room, never the staff rooms.
 * - otherwise the `lodos_sid` cookie (raw session token) → staff, joined to its session's tenant. The sandbox cookie
 *   (`lodos_sb`) plays no part: the session alone names the tenant.
 * - neither → `unauthorized`.
 */
export async function authenticate(socket: Socket, deps: RealtimeDeps): Promise<SocketIdentity | null> {
  const auth: unknown = socket.handshake.auth;
  if (auth && typeof auth === "object" && "tableToken" in auth) {
    const token = (auth as { tableToken: unknown }).tableToken;
    if (typeof token !== "string" || token.length === 0 || token.length > 128) return null;
    const table = await resolveTable(deps.models, token);
    return table ? { kind: "guest", tenantId: table.tenantId, tableId: table.id } : null;
  }
  const header = socket.handshake.headers.cookie;
  const raw = header ? deps.parseCookie(header)[SESSION_COOKIE] : undefined;
  if (!raw) return null;
  const session = await resolveSession(deps.models, raw, deps.clock.now());
  if (!session) return null;
  return { kind: "staff", tenantId: session.staff.tenantId, staffId: session.staff.id, role: session.staff.role };
}

/** Wires handshake auth, room joins and presence into `io`. */
export function attachRealtime(io: Server, deps: RealtimeDeps): void {
  io.use((socket, next) => {
    authenticate(socket, deps).then(
      (id) => {
        if (!id) return next(new Error("unauthorized"));
        socket.data.identity = id;
        next();
      },
      (err: unknown) => {
        deps.log.error({ err }, "socket handshake failed");
        next(new Error("unavailable"));
      },
    );
  });

  io.on("connection", (socket) => {
    const id = socket.data.identity as SocketIdentity;
    // Synchronous with the CONNECT packet, so a client's `connect` implies its rooms and presence are in place.
    void socket.join(roomsOf(id));
    deps.presence.connect(id.tenantId);
    socket.once("disconnect", () => deps.presence.disconnect(id.tenantId));
  });
}
