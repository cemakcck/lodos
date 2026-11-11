/** `GET /api/sales?range=…` (apps/api/src/sales/service.ts SalesView). */
export const RANGES = ["today", "7d", "30d"] as const;
export type Range = (typeof RANGES)[number];

export interface Loc {
  en: string;
  tr: string;
}
export interface Sum {
  count: number;
  amount: number;
}
export interface Totals {
  revenue: number;
  covers: number;
  checks: number;
  avgPerCover: number;
  avgPerCheck: number;
  comps: Sum;
  voids: Sum;
  compsPct: number;
}
export interface SalesLogEntry {
  at: string;
  kind: "comp" | "void";
  itemName: Loc;
  tableName: string;
  reason: string;
  note: string | null;
  requestedByName: string;
  approvedByName: string;
  amount: number;
  reversed: boolean;
}
export interface SalesView {
  range: Range;
  from: string;
  to: string;
  current: Totals;
  previous: Totals;
  byHour: { hour: number; revenue: number }[];
  ticketTimes: { kitchen: { hour: number; avgMin: number }[]; bar: { hour: number; avgMin: number }[] };
  thresholdMin: number;
  topItems: { name: Loc; qty: number; revenue: number }[];
  log: SalesLogEntry[];
}

export const salesKey = (range: Range) => ["sales", range] as const;
export const csvHref = (range: Range) => `/api/sales/export.csv?range=${range}`;
/** "07" for an hour of the day. */
export const hh = (hour: number) => String(hour).padStart(2, "0");
