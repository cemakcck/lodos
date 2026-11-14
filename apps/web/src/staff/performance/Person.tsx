import { useId } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { wholeCount } from "@lodos/shared";
import { ChevronLeft } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { hoursText, weekRange } from "../schedule/lib";
import { Breakdown } from "./Breakdown";
import { PeriodPicker } from "./Period";
import { usePeriod, usePerson, useSetCommentHidden, type PerfComment } from "./queries";

const W = 360;
const H = 110;

/** Eight weekly bars (value / max) with a visible table as the text equivalent. */
function WeekBars({ title, rows, max, valueHead, extraHead }: {
  title: string;
  rows: { week: string; value: number | null; text: string; extra?: string }[];
  max: number;
  valueHead: string;
  extraHead?: string;
}) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const id = useId();
  const slot = W / Math.max(1, rows.length);
  const bw = slot * 0.6;
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h"><h2 id={id}>{title}</h2></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sa-svg" role="img" aria-label={`${title}: ${rows.map((r) => `${weekRange(r.week, lang)} ${r.text}`).join(", ")}`}>
        <line x1={0} x2={W} y1={H - 4} y2={H - 4} className="sa-axis" />
        {rows.map((r, i) => {
          const h = r.value === null ? 0 : (r.value / max) * (H - 12);
          return <rect key={r.week} x={slot * i + (slot - bw) / 2} y={H - 4 - h} width={bw} height={h} rx={3} className="sa-bar" />;
        })}
      </svg>
      <table className="pf-table">
        <thead>
          <tr>
            <th scope="col">{t("performance.week")}</th>
            <th scope="col" className="r">{valueHead}</th>
            {extraHead && <th scope="col" className="r">{extraHead}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}>
              <th scope="row" className="font-mono">{weekRange(r.week, lang)}</th>
              <td className="r font-mono">{r.text}</td>
              {extraHead && <td className="r font-mono">{r.extra}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Comment({ c, onToggle, busy }: { c: PerfComment; onToggle: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  return (
    <li className={c.hidden ? "pf-comment is-hidden" : "pf-comment"}>
      <div className="meta font-mono">
        {new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "medium" }).format(new Date(c.at))}
        {c.stars !== null && ` · ${t("performance.stars", { n: c.stars })}`}
        {c.hidden && <b className="pf-tag"> · {t("performance.comments.hidden")}</b>}
      </div>
      <p>{c.comment}</p>
      <button type="button" className="staff-btn" disabled={busy} onClick={onToggle}>
        {t(c.hidden ? "performance.comments.unhide" : "performance.comments.hide")}
      </button>
    </li>
  );
}

/** `/staff/performance/:staffId` (manager): one person's score, hours, lateness, trends and guest comments. */
export function Person() {
  const { t, i18n } = useTranslation();
  const { lang } = useFormat();
  const { staffId = "" } = useParams();
  const p = usePeriod();
  const q = usePerson(staffId, p.period, p.key);
  const hide = useSetCommentHidden();
  const v = q.data;
  const num = new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const back = (
    <Link to={`/staff/performance${p.search}`} className="staff-icon-btn" aria-label={t("performance.back")}>
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );

  return (
    <Shell leading={back} title={v?.name ?? t("performance.title")} subtitle={v ? t(`staff.roles.${v.role}`) : undefined} toolbar={<PeriodPicker period={p.period} periodKey={p.key} range={v?.range} onChange={p.set} />} clock={false}>
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
        <div className="mg-page sa-page" role="region" aria-label={v.name} tabIndex={0}>
          <section className="sa-card pf-head" aria-label={t("performance.summary")}>
            <div>
              <p className="staff-label">{t("performance.col.score")}</p>
              <p className="pf-score font-mono">{v.score === null ? t("performance.notEnough") : num.format(v.score)}</p>
            </div>
            <dl className="pf-facts">
              <div><dt>{t("performance.hours")}</dt><dd className="font-mono">{t("performance.hoursOf", { actual: hoursText(t, v.minutes, lang), planned: hoursText(t, v.plannedMinutes, lang) })}</dd></div>
              <div><dt>{t("performance.lateness")}</dt><dd className="font-mono">{t("performance.late", { count: v.lateShifts })}</dd></div>
              <div><dt>{t("performance.col.rating")}</dt><dd className="font-mono">{v.ratingAvg === null ? "—" : `${v.ratingAvg.toFixed(1)} (${wholeCount(v.ratingCount)})`}</dd></div>
            </dl>
            {v.score !== null && <Breakdown breakdown={v.breakdown} score={v.score} station={v.role !== "waiter"} />}
          </section>

          <div className="sa-grid">
            <WeekBars
              title={t("performance.trend.title")}
              max={5}
              valueHead={t("performance.trend.avg")}
              extraHead={t("performance.trend.count")}
              rows={v.trend.map((w) => ({ week: w.week, value: w.avg, text: w.avg === null ? "—" : w.avg.toFixed(1), extra: String(w.count) }))}
            />
            <WeekBars
              title={t("performance.history.title")}
              max={100}
              valueHead={t("performance.col.score")}
              rows={v.history.map((w) => ({ week: w.week, value: w.score, text: w.score === null ? "—" : num.format(w.score) }))}
            />
          </div>

          <section className="sa-card" aria-label={t("performance.comments.title")}>
            <div className="sa-card-h"><h2>{t("performance.comments.title")}</h2></div>
            {v.comments.length === 0 ? (
              <p className="sa-empty">{t("performance.comments.none")}</p>
            ) : (
              <ul className="pf-comments">
                {v.comments.map((c) => (
                  <Comment key={c.id} c={c} busy={hide.isPending} onToggle={() => hide.mutate({ id: c.id, hidden: !c.hidden })} />
                ))}
              </ul>
            )}
            {hide.isError && <p role="alert" className="mg-error">{t("performance.comments.error")}</p>}
          </section>
        </div>
      )}
    </Shell>
  );
}
