import type { StaffRole } from "./schemas";

/** People who sign in with their own PIN. */
export const LOGIN_ROLES = ["waiter", "manager"] as const satisfies readonly StaffRole[];
/** Shared wall-screen accounts ("Kitchen", "Bar"): fixed, never deactivated, never on the schedule. */
export const STATION_ROLES = ["kitchen", "bar"] as const satisfies readonly StaffRole[];
/** People on the schedule only: no PIN, can't sign in, no rooms. */
export const SCHEDULE_ROLES = ["cook", "bartender", "host", "dishwasher"] as const satisfies readonly StaffRole[];

export type LoginRole = (typeof LOGIN_ROLES)[number];
export type StationRole = (typeof STATION_ROLES)[number];
export type ScheduleRole = (typeof SCHEDULE_ROLES)[number];

const SIGN_IN: readonly string[] = [...LOGIN_ROLES, ...STATION_ROLES];

/** Whether a role can hold a session at all (a person's PIN role, or a station). */
export const canSignIn = (role: string): role is LoginRole | StationRole => SIGN_IN.includes(role);
export const isStationRole = (role: string): role is StationRole => (STATION_ROLES as readonly string[]).includes(role);
export const isScheduleRole = (role: string): role is ScheduleRole => (SCHEDULE_ROLES as readonly string[]).includes(role);

/**
 * Table names as compact ranges: sorted by prefix then number, consecutive numbers collapsed with an en dash.
 *   tableRanges(["T10", "B2", "T5", "B1", "B3", "T6"]) → "B1–B3, T5–T6, T10"
 */
export function tableRanges(names: readonly string[]): string {
  const parsed = [...new Set(names)]
    .map((n) => {
      const m = /^(\D*)(\d+)$/.exec(n);
      return m ? { prefix: m[1]!, num: Number(m[2]) } : { prefix: n, num: NaN };
    })
    .sort((a, b) => (a.prefix === b.prefix ? a.num - b.num : a.prefix < b.prefix ? -1 : 1));
  const out: string[] = [];
  for (let i = 0; i < parsed.length; ) {
    const start = parsed[i]!;
    let j = i;
    while (j + 1 < parsed.length && parsed[j + 1]!.prefix === start.prefix && parsed[j + 1]!.num === parsed[j]!.num + 1) j++;
    const end = parsed[j]!;
    const label = (p: typeof start) => (Number.isNaN(p.num) ? p.prefix : `${p.prefix}${p.num}`);
    out.push(j === i ? label(start) : `${label(start)}–${label(end)}`);
    i = j + 1;
  }
  return out.join(", ");
}
