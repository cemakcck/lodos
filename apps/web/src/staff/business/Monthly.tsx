import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { MONTHS_BACK, monthLabel, pdfHref, shiftMonth, useMonthly } from "./queries";
import { ExpensesSection } from "./sections/ExpensesSection";
import { MenuQuadrant } from "./sections/MenuQuadrant";
import { Pnl } from "./sections/Pnl";
import { Ratings } from "./sections/Ratings";
import { SalesPatterns } from "./sections/SalesPatterns";
import { StaffTable } from "./sections/StaffTable";

/**
 * `/staff/business` (manager): the monthly business dashboard, six sections top to bottom, a month at a time.
 * The current month is learned from the server's first answer (the one with `soFar`), not the browser clock.
 */
export function Monthly() {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const [month, setMonth] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const q = useMonthly(month);
  const view = q.data;
  // Remember the server's current month the moment it answers (state adjusted during render, not in an effect).
  if (view?.soFar && current !== view.month) setCurrent(view.month);

  const newest = current ?? view?.month ?? "";
  const oldest = shiftMonth(newest, -MONTHS_BACK);
  const toolbar = view && (
    <div className="sc-week" role="group" aria-label={t("expenses.month.label")}>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("expenses.month.prev")} disabled={view.month <= oldest} onClick={() => setMonth(shiftMonth(view.month, -1))}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className="sc-range font-mono" aria-live="polite">{monthLabel(view.month, lang)}</span>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("expenses.month.next")} disabled={view.month >= newest} onClick={() => setMonth(shiftMonth(view.month, 1))}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
  const actions = view && (
    <a className="staff-btn" href={pdfHref(view.month, lang)} download>
      <Download size={16} aria-hidden="true" />
      {t("business.pdf")}
    </a>
  );

  return (
    <Shell title={t("business.title")} toolbar={toolbar} actions={actions} clock={false}>
      {!view ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("business.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("business.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page sa-page" role="region" aria-label={t("business.title")} tabIndex={0}>
          <p className="bz-period">
            {view.soFar
              ? t("business.soFar", { days: view.current.days, month: monthLabel(view.month, lang) })
              : t("business.full", { month: monthLabel(view.previous.month, lang) })}
          </p>
          <Pnl view={view} />
          <SalesPatterns view={view} />
          <MenuQuadrant view={view} />
          <StaffTable view={view} />
          <Ratings view={view} />
          <ExpensesSection view={view} />
        </div>
      )}
    </Shell>
  );
}
