import { serviceDayStartOf } from "./hours";
import { SERVICE_DAY_START_HOUR } from "./time";

/** Where a shift is worked (spec §6.2). `bar` is the guest bar area, `bar_station` the bartenders' station. */
export const SHIFT_AREAS = ["salon", "bar", "terrace", "kitchen", "bar_station"] as const;
export type ShiftArea = (typeof SHIFT_AREAS)[number];

/**
 * Spec §6.2. `maxShiftH` is a hard rule; the others are warnings, flagged only when strictly exceeded
 * (rest: when strictly under).
 */
export const SHIFT_LIMITS = { maxShiftH: 16, weekH: 45, dayH: 11, restH: 11 } as const;

/** Rows of the schedule, in display order. */
export const SCHEDULE_GROUPS = ["floor", "kitchen", "bar", "managers"] as const;
export type ScheduleGroup = (typeof SCHEDULE_GROUPS)[number];

const GROUP_OF: Record<string, ScheduleGroup> = {
  waiter: "floor",
  host: "floor",
  cook: "kitchen",
  dishwasher: "kitchen",
  bartender: "bar",
  manager: "managers",
};

/** The schedule group of a person's role; null for station accounts, which are never on the schedule. */
export const scheduleGroupOf = (role: string): ScheduleGroup | null => GROUP_OF[role] ?? null;

const DAY_MS = 86_400_000;
const parseDay = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const formatDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `day` ("YYYY-MM-DD") moved by `n` calendar days. */
export const addDays = (day: string, n: number): string => formatDay(parseDay(day) + n * DAY_MS);

/** The 7 service days of the week starting on `monday`. */
export const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** The Monday of the week that contains service day `serviceDay`. */
export const mondayOf = (serviceDay: string): string => {
  const dow = new Date(parseDay(serviceDay)).getUTCDay(); // 0 = Sunday
  return addDays(serviceDay, -((dow + 6) % 7));
};

/** Whether "YYYY-MM-DD" is a Monday. */
export const isMonday = (day: string): boolean => new Date(parseDay(day)).getUTCDay() === 1;

const minutesOf = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * The instants of a shift on service day `serviceDay` from wall-clock `start` to `end` ("HH:MM", Istanbul).
 * A start before 06:00 is on the next calendar day (still the same service day); an end at or before the start is
 * on the day after the start, so `end` is always after `start` (at most 24 h).
 */
export function shiftSpan(serviceDay: string, start: string, end: string): { start: Date; end: Date } {
  const dayStart = serviceDayStartOf(serviceDay).getTime();
  const fromDayStart = (minutesOf(start) - SERVICE_DAY_START_HOUR * 60 + 1440) % 1440;
  const s = dayStart + fromDayStart * 60_000;
  return { start: new Date(s), end: new Date(s + clockSpanMinutes(start, end) * 60_000) };
}

/** Length in minutes of a shift from wall-clock `start` to `end` (1 … 1440: an end at or before the start is the next day). */
export const clockSpanMinutes = (start: string, end: string): number => (minutesOf(end) - minutesOf(start) + 1440) % 1440 || 1440;

export const shiftMinutes = (s: { start: Date; end: Date }): number => Math.round((s.end.getTime() - s.start.getTime()) / 60_000);

export type ScheduleShift = { id: string; staffId: string; serviceDay: string; start: Date; end: Date };
export type WarningKind = "week_hours" | "day_hours" | "rest" | "inactive";
export type ScheduleWarning = { kind: WarningKind; staffId: string; shiftIds: string[]; minutes?: number };

/**
 * Warnings for the week `opts.week` (spec §6.2): over 45 h in the week and over 11 h in a service day (shifts of the
 * week only), under 11 h of rest between a person's consecutive shifts (the later one in the week, so pass the shifts
 * of the days before the week too), and any shift of an inactive person in the week. Per person, in that order.
 */
export function scheduleWarnings(shifts: readonly ScheduleShift[], opts: { week: readonly string[]; inactive: ReadonlySet<string> }): ScheduleWarning[] {
  const inWeek = new Set(opts.week);
  const byPerson = new Map<string, ScheduleShift[]>();
  for (const s of [...shifts].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    byPerson.set(s.staffId, [...(byPerson.get(s.staffId) ?? []), s]);
  }
  const out: ScheduleWarning[] = [];
  for (const [staffId, all] of byPerson) {
    const week = all.filter((s) => inWeek.has(s.serviceDay));
    const total = week.reduce((n, s) => n + shiftMinutes(s), 0);
    if (total > SHIFT_LIMITS.weekH * 60) out.push({ kind: "week_hours", staffId, shiftIds: week.map((s) => s.id), minutes: total });
    for (const day of opts.week) {
      const onDay = week.filter((s) => s.serviceDay === day);
      const minutes = onDay.reduce((n, s) => n + shiftMinutes(s), 0);
      if (minutes > SHIFT_LIMITS.dayH * 60) out.push({ kind: "day_hours", staffId, shiftIds: onDay.map((s) => s.id), minutes });
    }
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const next = all[i]!;
      if (!inWeek.has(next.serviceDay)) continue;
      const minutes = Math.round((next.start.getTime() - prev.end.getTime()) / 60_000);
      if (minutes < SHIFT_LIMITS.restH * 60) out.push({ kind: "rest", staffId, shiftIds: [prev.id, next.id], minutes });
    }
    if (opts.inactive.has(staffId) && week.length > 0) out.push({ kind: "inactive", staffId, shiftIds: week.map((s) => s.id) });
  }
  return out;
}
