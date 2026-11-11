import { SERVICE_DAY_START_HOUR } from "./time";

/** Istanbul is UTC+3 all year (no DST since 2016). */
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;

/** Wall-clock hours in service order: 06:00 … 23:00, then 00:00 … 05:00. */
export const SERVICE_HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => (i + SERVICE_DAY_START_HOUR) % 24);

/** Position of a wall-clock hour within the service day (06 → 0, 05 → 23). */
export function serviceHourIndex(hour: number): number {
  return (hour - SERVICE_DAY_START_HOUR + 24) % 24;
}

/** The Istanbul wall-clock hour (0–23) of `at`. */
export function istanbulHour(at: Date): number {
  return new Date(at.getTime() + ISTANBUL_OFFSET_MS).getUTCHours();
}

/** The Istanbul wall clock of `at` as `YYYY-MM-DD HH:MM` (e.g. the CSV export's `closed_at`). */
export function istanbulDateTime(at: Date): string {
  return new Date(at.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** Start instant of service day `day` ("YYYY-MM-DD"): 06:00 Istanbul = 03:00Z of that date. */
export function serviceDayStartOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, SERVICE_DAY_START_HOUR) - ISTANBUL_OFFSET_MS);
}
