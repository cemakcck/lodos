import { useTranslation } from "react-i18next";
import { addDays, mondayOf, serviceDayOf } from "@lodos/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormat } from "../../lib/format";
import { weekRange } from "../schedule/lib";
import { monthLabel, shiftMonth, type PerfPeriod } from "./queries";

interface Props {
  period: PerfPeriod;
  /** Monday or "YYYY-MM"; null is the current one. */
  periodKey: string | null;
  onChange: (period: PerfPeriod, key: string | null) => void;
}

/** Week / Month switch with previous, next and "this" for either; the current period is `key = null`. */
export function PeriodPicker({ period, periodKey, onChange }: Props) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const today = serviceDayOf(new Date());
  const current = period === "week" ? mondayOf(today) : today.slice(0, 7);
  const shown = periodKey ?? current;
  const go = (k: string) => onChange(period, k === current ? null : k);
  const step = (by: number) => go(period === "week" ? addDays(shown, 7 * by) : shiftMonth(shown, by));
  return (
    <div className="pf-period">
      <div className="staff-seg" role="group" aria-label={t("performance.period.label")}>
        {(["week", "month"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => onChange(p, null)}>{t(`performance.period.${p}`)}</button>
        ))}
      </div>
      <div className="sc-week" role="group" aria-label={t(`performance.period.range_${period}`)}>
        <button type="button" className="staff-icon-btn sc-nav" aria-label={t(`performance.period.prev_${period}`)} onClick={() => step(-1)}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="sc-range font-mono" aria-live="polite">{period === "week" ? weekRange(shown, lang) : monthLabel(shown, lang)}</span>
        <button type="button" className="staff-icon-btn sc-nav" aria-label={t(`performance.period.next_${period}`)} disabled={shown >= current} onClick={() => step(1)}>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="staff-btn" disabled={periodKey === null} onClick={() => onChange(period, null)}>{t(`performance.period.this_${period}`)}</button>
      </div>
    </div>
  );
}
