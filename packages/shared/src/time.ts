export const SERVICE_DAY_START_HOUR = 6;

const TZ = "Europe/Istanbul";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "YYYY-MM-DD" of the service day containing `at` (Istanbul, day starts 06:00). */
export function serviceDayOf(at: Date): string {
  return dayFmt.format(new Date(at.getTime() - SERVICE_DAY_START_HOUR * 3_600_000));
}

/** "HH:MM" wall clock in Istanbul. */
export function istanbulClock(at: Date): string {
  return clockFmt.format(at);
}

/** "mm:ss" under one hour, else "h:mm:ss". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
