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

/** `GET /api/checks/:id/print` (the whole-check `ReceiptView`; Task 10 rebuilds the print page around it). */
export interface CheckPrint {
  table: { name: string };
  checkNo: string;
  serverName: string | null;
  covers: number | null;
  printedAt: string;
  openedAt: string;
  closedAt: string | null;
  lines: { label: string; name: Loc; options: Loc[]; amount: number; comp: string | null }[];
  total: number;
  vat: { rate: 10 | 20; amount: number }[];
  payment: { method: PayMethod; amount: number; at: string; last4: string | null } | null;
  paid: boolean;
}
