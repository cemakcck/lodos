export const EVENTS = [
  "ticket.created", "ticket.updated", "check.updated", "call.opened",
  "call.answered", "availability.changed", "menu.changed", "tables.changed",
  "split.updated", "adjustment.changed", "session.ended", "layout.saved",
  "clock.changed", "rating.created", "expense.changed",
] as const;
export type EventName = (typeof EVENTS)[number];

export function room(tenantId: string, kind: "kitchen" | "bar" | "floor" | "manager"): string {
  return kind === "kitchen" || kind === "bar" ? `${tenantId}:station:${kind}` : `${tenantId}:${kind}`;
}

export function tableRoom(tenantId: string, tableId: string): string {
  return `${tenantId}:table:${tableId}`;
}

/** Every staff socket also joins its person's room, so a deactivation can reach (and disconnect) just them. */
export function personRoom(tenantId: string, staffId: string): string {
  return `${tenantId}:person:${staffId}`;
}
