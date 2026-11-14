import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { ShiftRow } from "../schedule/types";
import type { StaffRole } from "../auth";

export interface ClockPerson {
  id: string;
  name: string;
  clockedIn: boolean;
}

export interface PunchResult {
  action: "in" | "out";
  at: string;
  minutesToday: number;
}

export interface TimesheetEntry {
  id: string;
  serviceDay: string;
  in: string;
  out: string | null;
  minutes: number | null;
  overtimeMinutes: number;
  cost: number;
  rate: number;
  edited: boolean;
  forgot: boolean;
}

export interface TimesheetPerson {
  staffId: string;
  name: string;
  role: StaffRole;
  entries: TimesheetEntry[];
  shifts: ShiftRow[];
  minutes: number;
  overtimeMinutes: number;
  cost: number;
}

export interface TimesheetView {
  week: string;
  /** The first week with raw clock data; older weeks are summarised history (hours only on the reports). */
  firstWeek: string;
  days: string[];
  people: TimesheetPerson[];
}

export const clockPeopleKey = ["clock", "people"] as const;
export const timesheetsKey = ["timesheets"] as const;

/** Who can punch: no session needed, the tenant comes from the login tenant or the demo sandbox. */
export const useClockPeople = (enabled = true) =>
  useQuery({ queryKey: clockPeopleKey, queryFn: () => api<ClockPerson[]>("/api/clock/people"), retry: false, enabled });

/** `null` week: the server's current week. */
export const useTimesheets = (week: string | null) =>
  useQuery({
    queryKey: [...timesheetsKey, week ?? "current"],
    queryFn: () => api<TimesheetView>(week ? `/api/timesheets?week=${week}` : "/api/timesheets"),
    placeholderData: (prev) => prev,
  });

export const refreshTimesheets = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: timesheetsKey });
