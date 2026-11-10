import type { AgeState, TicketStatus } from "@lodos/shared";

export type Loc = { en: string; tr: string };
export type Station = "kitchen" | "bar";
export type KdsTab = "active" | "held" | "done";
export type Thresholds = { warnMin: number; lateMin: number };

export interface KdsItem {
  index: number;
  name: Loc;
  qty: number;
  options: Loc[];
  /** Already profanity-masked by the API, or null. */
  note: string | null;
  allergens: string[];
  allergyFlag: boolean;
  checked: boolean;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  tableId: string;
  /** Always prefixed: "T12", "B2". */
  tableName: string;
  station: Station;
  status: TicketStatus;
  /** null = a QR order. */
  serverName: string | null;
  covers: number | null;
  sentAt: string;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  ageState: AgeState;
  items: KdsItem[];
}

export interface KdsSnapshot {
  tickets: KdsTicket[];
  allDay: { itemName: Loc; qty: number }[];
  eightySix: { itemId: string; name: Loc; soldOut: boolean; remaining: number | null }[];
  stats: { open: number; items: number; avgTicketMs: number; late: number };
  /** Server time of the snapshot (ISO). */
  now: string;
  thresholds: Thresholds;
}

/** A snapshot plus the server-minus-device clock offset measured when it arrived. */
export interface KdsData extends KdsSnapshot {
  offsetMs: number;
}

/** A ticket's first minute on the board, by server time. */
export const NEW_FOR_MS = 60_000;
