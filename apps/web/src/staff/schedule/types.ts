/* Wire types for `/api/shifts`, `/api/shift-templates` and `/api/me/shifts`. */
import type { ScheduleGroup, ShiftArea, WarningKind } from "@lodos/shared";
import type { StaffRole } from "../auth";

export interface ShiftRow {
  id: string;
  staffId: string;
  serviceDay: string;
  /** Istanbul wall clock, "HH:MM". */
  start: string;
  end: string;
  startAt: string;
  endAt: string;
  area: ShiftArea;
  note: string | null;
  minutes: number;
}

export interface SchedulePerson {
  id: string;
  name: string;
  role: StaffRole;
  group: ScheduleGroup;
  active: boolean;
}

export interface ScheduleWarningRow {
  kind: WarningKind;
  staffId: string;
  shiftIds: string[];
  minutes?: number;
}

export interface WeekView {
  week: string;
  days: string[];
  people: SchedulePerson[];
  shifts: ShiftRow[];
  totals: { byPerson: Record<string, number>; byDay: Record<string, number> };
  warnings: ScheduleWarningRow[];
}

export interface ShiftTemplate {
  id: string;
  name: string;
  start: string;
  end: string;
  area: ShiftArea;
  sort: number;
  minutes: number;
}

export interface MyShiftsView {
  weeks: { week: string; shifts: ShiftRow[]; minutes: number }[];
}

/** A cell of the grid: one person on one service day. */
export interface Cell {
  staffId: string;
  day: string;
}

export const shiftsKey = ["shifts"] as const;
/** `null` week: the server's current week. */
export const weekKey = (week: string | null) => [...shiftsKey, "week", week ?? "current"] as const;
export const myShiftsKey = [...shiftsKey, "me"] as const;
export const templatesKey = ["shift-templates"] as const;
