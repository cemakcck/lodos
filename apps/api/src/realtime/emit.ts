import type { EventName } from "@lodos/shared";

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
