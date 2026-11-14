import { useTranslation } from "react-i18next";
import { pctChange } from "@lodos/shared";
import { useFormat } from "../../../lib/format";

/** "6% vs September" copy, localized; the month comes from the previous period. */
export function useVs(prevMonth: string): string {
  const { t } = useTranslation();
  return t(`business.vs.${Number(prevMonth.slice(5, 7))}`);
}

/** The change in percent; renders nothing when there is nothing to compare with (null). Words and an arrow, never colour. */
export function Change({ pct, pts, vs }: { pct?: number | null; pts?: number | null; vs: string }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const value = pct !== undefined ? pct : pts;
  if (value === null || value === undefined) return null;
  const kind = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(Math.abs(value));
  return <span className="bz-chg">{t(`business.change.${pct !== undefined ? "pct" : "pts"}.${kind}`, { n, vs })}</span>;
}

/** Percent change of two numbers, null when the earlier is 0. */
export const pct = pctChange;

/** Percentage-point change of two ratios (0.148 → 14.8%), one decimal; null when either is missing. */
export const ptsChange = (cur: number | null, prev: number | null): number | null =>
  cur === null || prev === null ? null : Math.round((cur - prev) * 1000) / 10;
