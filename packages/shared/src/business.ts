import { addDays } from "./shifts";

/**
 * Monthly business dashboard helpers (phase 3, spec §8). A "month" is the service days whose date is in that calendar
 * month ("YYYY-MM"); the current month runs "so far", up to today.
 */

/** Days in calendar month "YYYY-MM". */
export const monthLength = (month: string): number => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** The calendar month before "YYYY-MM". */
export const previousMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** The service days of `month` up to `today` (all of a past month, none of a future one). */
export function monthDays(month: string, today: string): string[] {
  const days: string[] = [];
  for (let i = 0, d = `${month}-01`; i < monthLength(month) && d <= today; i++, d = addDays(d, 1)) days.push(d);
  return days;
}

/** What `month` compares with: the previous month's days 1 … the same day number, capped at that month's length. */
export function comparisonDays(month: string, today: string): string[] {
  const n = monthDays(month, today).length;
  const prev = previousMonth(month);
  return Array.from({ length: Math.min(n, monthLength(prev)) }, (_, i) => addDays(`${prev}-01`, i));
}

/** The change from `prev` to `cur` in percent, one decimal; null when `prev` is 0. Relative to |prev|, so up is positive. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export const MENU_GROUPS = ["stars", "hidden_gems", "fix", "rethink"] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];
/** The menu groups' copy (plan Global Constraints, verbatim). */
export const MENU_GROUP_LABELS: Record<MenuGroup, { en: string; tr: string }> = {
  stars: { en: "Stars", tr: "Yıldızlar" },
  hidden_gems: { en: "Hidden gems", tr: "Gizli hazineler" },
  fix: { en: "Fix", tr: "Düzeltilmeli" },
  rethink: { en: "Rethink", tr: "Gözden geçir" },
};
/** The rating at or above which a dish counts as rated high (spec §8.3, Claude's call). */
export const MENU_RATING_THRESHOLD = 4.0;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Popularity × rating per dish: `qty ≥` the median of all `qty` sells a lot, `ratingAvg ≥ 4.0` is rated high.
 * An unrated dish (`ratingAvg` null) has no group.
 */
export function menuQuadrant(dishes: readonly { qty: number; ratingAvg: number | null }[]): (MenuGroup | null)[] {
  if (dishes.length === 0) return [];
  const threshold = median(dishes.map((d) => d.qty));
  return dishes.map((d) => {
    if (d.ratingAvg === null) return null;
    const popular = d.qty >= threshold;
    const high = d.ratingAvg >= MENU_RATING_THRESHOLD;
    return popular ? (high ? "stars" : "fix") : high ? "hidden_gems" : "rethink";
  });
}
