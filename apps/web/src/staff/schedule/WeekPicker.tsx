import { useTranslation } from "react-i18next";
import { addDays } from "@lodos/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormat } from "../../lib/format";
import { weekRange } from "./lib";

interface Props {
  /** Monday of the shown week. */
  week: string;
  /** Showing the server's current week: "This week" is disabled. */
  isCurrent: boolean;
  /** A Monday, or null for the current week. */
  onGo: (week: string | null) => void;
  /** The earliest Monday it goes back to; unbounded when absent. */
  min?: string;
}

/** Previous / next week and "This week", shared by Schedule and Timesheets. */
export function WeekPicker({ week, isCurrent, onGo, min }: Props) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  return (
    <div className="sc-week" role="group" aria-label={t("schedule.week.label")}>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("schedule.week.prev")} disabled={min !== undefined && week <= min} onClick={() => onGo(addDays(week, -7))}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className="sc-range font-mono" aria-live="polite">{weekRange(week, lang)}</span>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("schedule.week.next")} onClick={() => onGo(addDays(week, 7))}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="staff-btn" disabled={isCurrent} onClick={() => onGo(null)}>{t("schedule.week.this")}</button>
    </div>
  );
}
