import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { useMe } from "../auth";
import { hoursText } from "../schedule/lib";
import { Breakdown } from "./Breakdown";
import { PeriodPicker } from "./Period";
import { ordinal, rankNoun, useMyPerformance, usePeriod } from "./queries";

/** `/staff/my-performance` (any login role): the caller's own score, rank as a position only, hours, lateness and guest comments. */
export function MyPerformance() {
  const { t, i18n } = useTranslation();
  const { lang } = useFormat();
  const me = useMe().data ?? undefined;
  const p = usePeriod();
  const q = useMyPerformance(p.period, p.key);
  const v = q.data;
  const num = new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const noun = rankNoun(me?.role);

  return (
    <Shell title={t("performance.myTitle")} toolbar={<PeriodPicker period={p.period} periodKey={p.key} onChange={p.set} />} clock={false}>
      {!v ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("performance.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("staff.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="ms-page pf-me">
          <section className="sa-card pf-head" aria-label={t("performance.summary")}>
            <div>
              <p className="staff-label">{t("performance.col.score")}</p>
              <p className="pf-score font-mono">{v.score === null ? t("performance.notEnough") : num.format(v.score)}</p>
              {v.rank && <p className="pf-rank-text">{t(`performance.rank.${noun}`, { count: v.rank.of, position: ordinal(v.rank.position, lang) })}</p>}
            </div>
            <dl className="pf-facts">
              <div><dt>{t("performance.hours")}</dt><dd className="font-mono">{t("performance.hoursOf", { actual: hoursText(t, v.minutes, lang), planned: hoursText(t, v.plannedMinutes, lang) })}</dd></div>
              <div><dt>{t("performance.lateness")}</dt><dd className="font-mono">{t("performance.late", { count: v.lateShifts })}</dd></div>
              <div><dt>{t("performance.col.rating")}</dt><dd className="font-mono">{v.ratingAvg === null ? "—" : `${v.ratingAvg.toFixed(1)} (${v.ratingCount})`}</dd></div>
            </dl>
            {v.score !== null && <Breakdown breakdown={v.breakdown} score={v.score} station={noun !== "waiter"} />}
          </section>

          {noun === "waiter" && (
            <section className="sa-card" aria-label={t("performance.comments.title")}>
              <div className="sa-card-h"><h2>{t("performance.comments.title")}</h2></div>
              {v.comments.length === 0 ? (
                <p className="sa-empty">{t("performance.comments.none")}</p>
              ) : (
                <ul className="pf-comments">
                  {v.comments.map((c) => (
                    <li key={c.at + c.comment} className="pf-comment">
                      <div className="meta font-mono">
                        {new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(new Date(c.at))}
                        {c.stars !== null && ` · ${t("performance.stars", { n: c.stars })}`}
                      </div>
                      <p>{c.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}
