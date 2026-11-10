import { room, tableRoom, type EventName } from "@lodos/shared";
import type { Server } from "socket.io";
import type { Clock } from "../clock";

/**
 * Who receives an event, as named in the plan's event table. `kitchen`/`bar`/`floor`/`manager` map to the tenant's
 * staff rooms (`room()` in @lodos/shared), `table` to `tableRoom(tenantId, payload.tableId)`, and `all` to every room
 * of the tenant, guests included (`availability.changed`, `menu.changed`).
 */
export type Audience = "kitchen" | "bar" | "floor" | "manager" | "table" | "all";

/** Events carry ids only; clients refetch. `tableId` is required whenever `table` is an audience. */
export type EventPayload = { ids: string[]; tableId?: string };

export type Realtime = {
  emit(tenantId: string, event: EventName, payload: EventPayload, audiences: readonly Audience[]): void;
};

/**
 * The default until Task 8 wires Socket.IO. A fresh object per app, so replacing `emit` (Task 8, test spies) never
 * leaks into another app in the same process. Callers emit only after their transaction has committed.
 */
export const noopRealtime = (): Realtime => ({ emit: () => {} });

/** Every socket of a tenant, staff or guest, also joins this room; the `all` audience emits here. */
export const allRoom = (tenantId: string): string => `${tenantId}:all`;

/**
 * What a client receives, on the single `"event"` channel: `socket.on("event", (e: WireEvent) => …)`.
 * `at` is the server clock's ISO time at emit. Events carry ids only; clients refetch (spec §8.4).
 */
export type WireEvent = { type: EventName; ids: string[]; tableId?: string; at: string };

/** Resolves audiences to this tenant's room names. `table` without `payload.tableId` resolves to no room. */
export function roomsFor(tenantId: string, payload: EventPayload, audiences: readonly Audience[]): string[] {
  const rooms = new Set<string>();
  for (const a of audiences) {
    if (a === "all") rooms.add(allRoom(tenantId));
    else if (a === "table") {
      if (payload.tableId) rooms.add(tableRoom(tenantId, payload.tableId));
    } else rooms.add(room(tenantId, a));
  }
  return [...rooms];
}

/**
 * Socket.IO fan-out. One `emit` to the union of rooms, so a socket in several of them (a manager) gets the event
 * once. Never throws: callers emit after their commit, and a delivery problem must not fail a committed request.
 */
export function socketRealtime(io: Server, clock: Clock, onError: (err: unknown) => void): Realtime {
  return {
    emit(tenantId, event, payload, audiences) {
      try {
        const rooms = roomsFor(tenantId, payload, audiences);
        if (rooms.length === 0) return;
        const wire: WireEvent = {
          type: event,
          ids: payload.ids,
          ...(payload.tableId ? { tableId: payload.tableId } : {}),
          at: clock.now().toISOString(),
        };
        io.to(rooms).emit("event", wire);
      } catch (err) {
        onError(err);
      }
    },
  };
}
