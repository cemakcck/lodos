import { mondayOf, SHIFT_LIMITS } from "./shifts";

/** Time-clock thresholds (phase 3 spec). `weekH` and `forgotOutH` mirror the schedule limits. */
export const TIME_CLOCK = { lateGraceMin: 5, missingAfterMin: 15, forgotOutH: SHIFT_LIMITS.maxShiftH, weekH: SHIFT_LIMITS.weekH, overtimeFactor: 1.5 } as const;

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The hourly rate (kuruş) in force at `at`: the latest `from ≤ at`, or 0. */
export function rateAt(rates: readonly { from: Date; kurusPerHour: number }[], at: Date): number {
  let best: { from: Date; kurusPerHour: number } | null = null;
  for (const r of rates) {
    if (r.from.getTime() <= at.getTime() && (!best || r.from.getTime() >= best.from.getTime())) best = r;
  }
  return best?.kurusPerHour ?? 0;
}

/** Minutes worked in an entry; null while open, and for an entry open longer than 16 h (the caller flags it). */
export function entryMinutes(e: { in: Date; out: Date | null }, now: Date): number | null {
  if (!e.out) return null; // open now, or open past 16 h (flagged by the caller): either way no minutes
  if (e.out.getTime() > now.getTime()) return null; // not closed yet as of `now`
  return Math.round((e.out.getTime() - e.in.getTime()) / MIN_MS);
}

/**
 * Overtime minutes per entry id: per person and Monday–Sunday week (by service day), entries in `in` order; minutes
 * beyond 45 h go to the entries that cross the line.
 */
export function allocateOvertime(entries: readonly { id: string; staffId: string; serviceDay: string; minutes: number; in: Date }[]): Map<string, number> {
  const out = new Map<string, number>();
  const totals = new Map<string, number>();
  const limit = TIME_CLOCK.weekH * 60;
  for (const e of [...entries].sort((a, b) => a.in.getTime() - b.in.getTime())) {
    const key = `${e.staffId}|${mondayOf(e.serviceDay)}`;
    const before = totals.get(key) ?? 0;
    const after = before + e.minutes;
    totals.set(key, after);
    out.set(e.id, Math.max(0, after - Math.max(before, limit)));
  }
  return out;
}

/** Labour cost in kuruş: base pay plus the 0.5× premium on overtime minutes, each rounded half up. */
export const entryCost = (minutes: number, overtimeMinutes: number, rate: number): number =>
  Math.round((minutes * rate) / 60) + Math.round((overtimeMinutes * rate) / 120);

export type Attendance = "on_shift" | "late" | "missing" | "later" | "finished" | "unscheduled" | "forgot_out";

/**
 * Where a person stands against a shift. `forgot_out` (an entry open past 16 h) wins over everything. With a shift:
 * no entry is `later` until 15 min after the start, then `missing`; a person clocked in is `on_shift`, or `late`
 * (with `lateMin` = first clock-in − start) if they arrived more than 5 min after the start; once every entry is
 * closed they are `finished`. An entry without a shift is `unscheduled` (so is the empty case, which callers skip).
 */
export function attendanceStatus(
  shift: { start: Date; end: Date } | null,
  entries: readonly { in: Date; out: Date | null }[],
  now: Date,
): { status: Attendance; lateMin?: number } {
  if (entries.some((e) => !e.out && now.getTime() - e.in.getTime() > TIME_CLOCK.forgotOutH * HOUR_MS)) return { status: "forgot_out" };
  if (!shift) return { status: "unscheduled" };
  if (entries.length === 0) {
    return { status: now.getTime() > shift.start.getTime() + TIME_CLOCK.missingAfterMin * MIN_MS ? "missing" : "later" };
  }
  const firstIn = Math.min(...entries.map((e) => e.in.getTime()));
  const lateBy = firstIn - shift.start.getTime();
  const open = entries.some((e) => !e.out);
  if (!open) return { status: "finished" };
  if (lateBy > TIME_CLOCK.lateGraceMin * MIN_MS) return { status: "late", lateMin: Math.round(lateBy / MIN_MS) };
  return { status: "on_shift" };
}
