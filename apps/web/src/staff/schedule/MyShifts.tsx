import { useTranslation } from "react-i18next";
import { FileDown } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { dayShort, hoursText, pdfHref, span, weekRange } from "./lib";
import { useMyShifts } from "./queries";

/** `/staff/my-shifts` (any signed-in person, spec §6.4): this week and next, read-only, with hours and the personal PDF. */
export function MyShifts() {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const q = useMyShifts();

  return (
    <Shell title={t("myShifts.title")} clock={false}>
      {!q.data ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("myShifts.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="ms-page">
          {q.data.weeks.map((w, i) => {
            const h = `ms-week-${w.week}`;
            return (
              <section key={w.week} className="ms-week" aria-labelledby={h}>
                <header className="ms-week-h">
                  <h2 id={h}>
                    {t(i === 0 ? "myShifts.thisWeek" : "myShifts.nextWeek")}
                    <span className="sub font-mono"> · {weekRange(w.week, lang)}</span>
                  </h2>
                  <span className="ms-total">
                    <span className="staff-label">{t("myShifts.total")}</span>
                    <b className="font-mono">{hoursText(t, w.minutes, lang)}</b>
                  </span>
                  <a className="staff-btn" href={pdfHref.mine(w.week, lang)} download>
                    <FileDown size={15} strokeWidth={1.75} aria-hidden="true" />
                    {t("myShifts.pdf")}
                  </a>
                </header>
                {w.shifts.length === 0 ? (
                  <p className="ms-empty">{t("myShifts.none")}</p>
                ) : (
                  <ul className="ms-list">
                    {w.shifts.map((s) => {
                      const d = dayShort(s.serviceDay, lang);
                      return (
                        <li key={s.id}>
                          <span className="ms-day">{`${d.weekday} ${d.date}`}</span>
                          <span className="ms-time font-mono">{span(s.start, s.end)}</span>
                          <span className="ms-area">
                            {t(`schedule.area.${s.area}`)}
                            {s.note && <span className="mg-muted"> · {s.note}</span>}
                          </span>
                          <span className="ms-hours font-mono">{hoursText(t, s.minutes, lang)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
