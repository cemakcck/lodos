import type { TFunction } from "i18next";
import { addDays, clockSpanMinutes, SHIFT_LIMITS, type ScheduleGroup, type ShiftArea } from "@lodos/shared";
import { ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Lang } from "../../lib/format";
import type { ScheduleWarningRow, WeekView } from "./types";

const locale = (lang: Lang) => (lang === "tr" ? "tr-TR" : "en-GB");
const dateOf = (day: string) => new Date(`${day}T12:00:00Z`);
const fmt = (lang: Lang, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(lang), { timeZone: "UTC", ...o });

/** Hours as a number for display: "47", "7.5" / "7,5". */
export const hoursNumber = (minutes: number, lang: Lang): string =>
  new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(minutes / 60);

/** "8 h" / "8 sa"; "—" for nothing. */
export const hoursText = (t: TFunction, minutes: number, lang: Lang): string =>
  minutes > 0 ? t("schedule.hours", { n: hoursNumber(minutes, lang) }) : "—";

/** Column header parts: "Mon" and "9 Nov". */
export const dayShort = (day: string, lang: Lang) => ({
  weekday: fmt(lang, { weekday: "short" }).format(dateOf(day)),
  date: fmt(lang, { day: "numeric", month: "short" }).format(dateOf(day)),
});

/** "Wednesday 11 November" / "11 Kasım Çarşamba". */
export const dayLong = (day: string, lang: Lang): string => fmt(lang, { weekday: "long", day: "numeric", month: "long" }).format(dateOf(day));

/** "9–15 Nov 2026". */
export const weekRange = (week: string, lang: Lang): string =>
  fmt(lang, { day: "numeric", month: "short", year: "numeric" }).formatRange(dateOf(week), dateOf(addDays(week, 6)));

export const span = (start: string, end: string) => `${start}–${end}`;

/** The area a new shift starts with, by the person's group. */
export const DEFAULT_AREA: Record<ScheduleGroup, ShiftArea> = { floor: "salon", kitchen: "kitchen", bar: "bar_station", managers: "salon" };

/** Over the hard 16 h limit (an end at or before the start is the next day). */
export const tooLong = (start: string, end: string) => clockSpanMinutes(start, end) > SHIFT_LIMITS.maxShiftH * 60;

/** A warning without the person: "47 h this week (limit 45)". */
export function warningText(t: TFunction, w: ScheduleWarningRow, view: WeekView, lang: Lang): string {
  const hours = hoursNumber(w.minutes ?? 0, lang);
  const lastDay = () => {
    const id = w.shiftIds.at(-1);
    const day = view.shifts.find((s) => s.id === id)?.serviceDay;
    return day ? dayLong(day, lang) : "";
  };
  switch (w.kind) {
    case "week_hours":
      return t("schedule.warn.week", { hours, limit: SHIFT_LIMITS.weekH });
    case "day_hours":
      return t("schedule.warn.day", { hours, limit: SHIFT_LIMITS.dayH, day: lastDay() });
    case "rest":
      return t("schedule.warn.rest", { hours, limit: SHIFT_LIMITS.restH, day: lastDay() });
    case "inactive":
      return t("schedule.warn.inactive");
  }
}

/** API errors for shift writes; an overlap names the person whose shifts clash. */
export function shiftError(t: TFunction, e: unknown, name: string): string {
  if (e instanceof ApiClientError && e.code === "shift_overlap") return t("errors.shift_overlap", { name });
  return errorMessage(t, e);
}

/** PDF links, in the UI language. */
export const pdfHref = {
  week: (week: string, lang: Lang) => `/api/shifts/pdf/week?week=${week}&lang=${lang}`,
  people: (week: string, lang: Lang) => `/api/shifts/pdf/people?week=${week}&lang=${lang}`,
  person: (id: string, week: string, lang: Lang) => `/api/shifts/pdf/person/${id}?week=${week}&lang=${lang}`,
  mine: (week: string, lang: Lang) => `/api/me/shifts/pdf?week=${week}&lang=${lang}`,
};
