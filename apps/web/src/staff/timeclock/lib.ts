import type { TFunction } from "i18next";

const IST_OFFSET_MS = 3 * 3_600_000;

/** "7 h 12 min" / "12 min". */
export const durationText = (t: TFunction, minutes: number): string =>
  minutes >= 60 ? t("timeclock.duration", { h: Math.floor(minutes / 60), m: minutes % 60 }) : t("timeclock.durationMin", { m: minutes });

/** An instant as the Istanbul wall clock "YYYY-MM-DDTHH:MM" (the value of a datetime-local input). Istanbul is fixed UTC+3. */
export const toLocalInput = (iso: string): string => new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);

/** The reverse: an Istanbul wall-clock "YYYY-MM-DDTHH:MM" as an ISO instant; null when it isn't a valid date and time. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+03:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
