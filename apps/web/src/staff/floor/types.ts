import type { TableState } from "@lodos/shared";
import type { Loc } from "../kds/types";

export type { TableState };
export type ChipKind = "calling" | "ready" | "bill";
export type LineStatus = "sent" | "preparing" | "ready" | "served";
export type PayMethod = "card" | "cash";

/** One table on `GET /api/floor`. Names are always prefixed: "T12", "B2". Dates are ISO strings. */
export interface FloorTable {
  id: string;
  name: string;
  roomId: string;
  shape: "round" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  /** The waiter whose section the table is in ("My tables"). */
  sectionStaffId: string | null;
  /** The open check's server, else the section waiter. */
  serverStaffId: string | null;
  serverInitials: string | null;
  state: TableState;
  covers: number | null;
  seatedAt: string | null;
  checkId: string | null;
}

export interface FloorChip {
  kind: ChipKind;
  tableId: string;
  tableName: string;
  since: string;
}

export interface FloorStats {
  seated: number;
  totalTables: number;
  covers: number;
  avgTurnMs: number;
  openChecksTotal: number;
}

export interface FloorSnapshot {
  now: string;
  rooms: { id: string; name: string }[];
  tables: FloorTable[];
  chips: FloorChip[];
  stats: FloorStats;
}

/** The snapshot plus the held server-time offset (server now − device clock). */
export type FloorData = FloorSnapshot & { offsetMs: number };

export interface CheckLine {
  orderId: string;
  ticketId: string;
  qty: number;
  name: Loc;
  options: Loc[];
  note: string | null;
  seat: number | null;
  status: LineStatus;
  lineTotal: number;
}

export interface CheckTotals {
  food: number;
  drinks: number;
  total: number;
}

export interface OpenCall {
  id: string;
  reason: string;
  openedAt: string;
}

export interface CheckInfo {
  id: string;
  covers: number | null;
  openedAt: string;
  serverStaffId: string | null;
  serverName: string | null;
  billRequestedAt: string | null;
  billMethod: PayMethod | null;
}

/** `GET /api/tables/:id/check`: `table` and `calls` always; `check` is null for a free table. */
export type TableCheck = {
  table: { id: string; name: string; capacity: number; sectionStaffId: string | null };
  calls: OpenCall[];
} & ({ check: null } | { check: CheckInfo; food: CheckLine[]; drinks: CheckLine[]; totals: CheckTotals });

export interface CheckPrint {
  table: { id: string; name: string };
  check: {
    id: string;
    status: "open" | "paid";
    paid: boolean;
    covers: number | null;
    openedAt: string;
    closedAt: string | null;
    serverName: string | null;
    payment: { method: PayMethod; amount: number; at: string } | null;
  };
  food: CheckLine[];
  drinks: CheckLine[];
  totals: CheckTotals;
}
