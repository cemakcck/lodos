export const TICKET_THRESHOLDS = { warnMin: 8, lateMin: 15 };

export type AgeState = "ok" | "warn" | "late";
export type TicketStatus = "new" | "started" | "held" | "ready";
export type GuestItemStatus = "sent" | "preparing" | "ready" | "served";

export function ticketAgeState(sentAt: Date, now: Date, t = TICKET_THRESHOLDS): AgeState {
  const min = (now.getTime() - sentAt.getTime()) / 60_000;
  if (min > t.lateMin) return "late";
  if (min >= t.warnMin) return "warn";
  return "ok";
}

export function guestItemStatus(t: { status: TicketStatus; servedAt?: Date | null; anyChecked: boolean }): GuestItemStatus {
  if (t.servedAt) return "served";
  if (t.status === "ready") return "ready";
  if (t.status === "started" || t.anyChecked) return "preparing";
  return "sent";
}
