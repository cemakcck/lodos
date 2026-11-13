import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { hoursText } from "../schedule/lib";
import { PeriodPicker } from "./Period";
import { usePeriod, useRanking, type Group, type PerfRow } from "./queries";

const GROUPS: readonly Group[] = ["floor", "kitchen", "bar"];

/** `/staff/performance` (manager): per-group rankings for a week or a month; people below the minimums show no score. */
export function Ranking() {
  const { t, i18n } = useTranslation();
  const { lang } = useFormat();
  const p = usePeriod();
  const [group, setGroup] = useState<Group>("floor");
  const q = useRanking(p.period, p.key);
  const rows: PerfRow[] = q.data?.groups[group] ?? [];
  const score = new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const toolbar = (
    <>
      <div className="staff-seg" role="group" aria-label={t("performance.group.label")}>
        {GROUPS.map((g) => (
          <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{t(`performance.group.${g}`)}</button>
        ))}
      </div>
      <PeriodPicker period={p.period} periodKey={p.key} onChange={p.set} />
    </>
  );

  return (
    <Shell title={t("performance.title")} toolbar={toolbar} clock={false}>
      {!q.data ? (
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
        <div className="mg-page sa-page" role="region" aria-label={t(`performance.group.${group}`)} tabIndex={0}>
          <section className="sa-card">
            {rows.length === 0 ? (
              <p className="sa-empty">{t("performance.empty")}</p>
            ) : (
              <table className="pf-table pf-rank" aria-label={t("performance.rankingOf", { group: t(`performance.group.${group}`) })}>
                <thead>
                  <tr>
                    <th scope="col" className="r">{t("performance.col.rank")}</th>
                    <th scope="col">{t("performance.col.name")}</th>
                    <th scope="col" className="r">{t("performance.col.score")}</th>
                    <th scope="col" className="r">{t("performance.col.rating")}</th>
                    <th scope="col" className="r">{t("performance.col.hours")}</th>
                    <th scope="col" className="r">{t("performance.col.late")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.staffId}>
                      <td className="r font-mono">{r.score === null ? "—" : i + 1}</td>
                      <th scope="row"><Link to={`/staff/performance/${r.staffId}${p.search}`}>{r.name}</Link></th>
                      <td className="r font-mono">{r.score === null ? <span className="pf-na">{t("performance.notEnough")}</span> : score.format(r.score)}</td>
                      <td className="r font-mono">{r.ratingAvg === null ? "—" : `${r.ratingAvg.toFixed(1)} (${r.ratingCount})`}</td>
                      <td className="r font-mono">{t("performance.hoursOf", { actual: hoursText(t, r.minutes, lang), planned: hoursText(t, r.plannedMinutes, lang) })}</td>
                      <td className="r font-mono">{r.lateShifts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
