export const EVENTS = [
  "ticket.created", "ticket.updated", "check.updated", "call.opened",
  "call.answered", "availability.changed", "menu.changed", "tables.changed",
] as const;
export type EventName = (typeof EVENTS)[number];

export function room(tenantId: string, kind: "kitchen" | "bar" | "floor" | "manager"): string {
  return kind === "kitchen" || kind === "bar" ? `${tenantId}:station:${kind}` : `${tenantId}:${kind}`;
}

export function tableRoom(tenantId: string, tableId: string): string {
  return `${tenantId}:table:${tableId}`;
}
