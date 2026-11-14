import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SCHEDULE_GROUPS } from "@lodos/shared";
import { Download } from "lucide-react";
import { useFormat } from "../../../lib/format";
import { csvHref, type MonthlyView } from "../queries";
import { Change, pct, useVs } from "./Change";

/** Section 4: every ranked person's month, labour cost by role and overtime. Their prior values exist only for the figures that carry a change. */
export function StaffTable({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = useVs(view.previous.month);
  const id = useId();
  const one = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const hours = (minutes: number) => t("business.hours", { n: one.format(minutes / 60) });
  const labour = view.labourByGroup.cur;
  const groups = SCHEDULE_GROUPS.filter((g) => labour[g] > 0 || view.labourByGroup.prev[g] > 0);
  const max = Math.max(1, ...groups.map((g) => labour[g]));
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("business.staff.title")}</h2>
        <a className="staff-btn" href={csvHref(view.month, "staff")} download aria-label={t("business.csvOf", { section: t("business.staff.title") })}>
          <Download size={15} aria-hidden="true" />
          {t("business.csv")}
        </a>
      </div>
      {view.staff.length === 0 ? (
        <p className="sa-empty">{t("business.staff.empty")}</p>
      ) : (
        <table className="ex-table bz-table">
          <caption className="sr-only">{t("business.staff.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("business.staff.name")}</th>
              <th scope="col">{t("business.staff.role")}</th>
              <th scope="col" className="r">{t("business.staff.hours")}</th>
              <th scope="col" className="r">{t("business.staff.late")}</th>
              <th scope="col" className="r">{t("business.staff.rating")}</th>
              <th scope="col" className="r">{t("business.staff.points")}</th>
              <th scope="col" className="r">{t("business.staff.labour")}</th>
            </tr>
          </thead>
          <tbody>
            {view.staff.map((s) => (
              <tr key={s.staffId}>
                <th scope="row">{s.name}</th>
                <td>{t(`staff.roles.${s.role}`, { defaultValue: s.role })}</td>
                <td className="r font-mono">{hours(s.minutes)} ({hours(s.plannedMinutes)})</td>
                <td className="r font-mono">{s.lateShifts}</td>
                <td className="r font-mono">{s.ratingAvg === null ? <><span aria-hidden="true">{t("business.none")}</span><span className="sr-only">{t("business.notEnough")}</span></> : <>★ {one.format(s.ratingAvg)}</>}</td>
                <td className="r font-mono">
                  {s.score === null ? <><span aria-hidden="true">{t("business.none")}</span><span className="sr-only">{t("business.notEnough")}</span></> : one.format(s.score)}
                  {s.score !== null && s.prev.score !== null && <> <Change pct={pct(s.score, s.prev.score)} vs={vs} /></>}
                </td>
                <td className="r font-mono">{money(s.labourCost)} <Change pct={pct(s.labourCost, s.prev.labourCost)} vs={vs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="bz-sub">{t("business.staff.labourByRole")}</h3>
      <ul className="bz-meters" aria-label={t("business.staff.labourByRole")}>
        {groups.map((g) => (
          <li key={g}>
            <span className="nm">{t(`business.staff.groups.${g}`)}</span>
            <span className="meter" aria-hidden="true"><span className="fill" style={{ width: `${(labour[g] / max) * 100}%` }} /></span>
            <span className="amt font-mono">{money(labour[g])} <Change pct={pct(labour[g], view.labourByGroup.prev[g])} vs={vs} /></span>
          </li>
        ))}
      </ul>
      <p className="bz-note">
        {t("business.staff.overtime")}: <b className="font-mono">{hours(view.overtimeMinutes.cur)}</b> <Change pct={pct(view.overtimeMinutes.cur, view.overtimeMinutes.prev)} vs={vs} />
      </p>
    </section>
  );
}
