import { useId } from "react";
import { useTranslation } from "react-i18next";
import { MENU_GROUP_LABELS, MENU_GROUPS } from "@lodos/shared";
import { Download } from "lucide-react";
import { useFormat } from "../../../lib/format";
import { loc } from "../../kds/lib";
import { csvHref, type MonthlyView } from "../queries";
import { Change, pct, useVs } from "./Change";

/** Section 3: popularity × rating. The four groups as lists of dish names, then every dish with its figures. */
export function MenuQuadrant({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = useVs(view.previous.month);
  const id = useId();
  const num = (n: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("business.menu.title")}</h2>
        <a className="staff-btn" href={csvHref(view.month, "menu")} download aria-label={t("business.csvOf", { section: t("business.menu.title") })}>
          <Download size={15} aria-hidden="true" />
          {t("business.csv")}
        </a>
      </div>
      <ul className="bz-quad" aria-label={t("business.menu.groups")}>
        {MENU_GROUPS.map((g) => {
          const names = view.menu.filter((d) => d.group === g).map((d) => loc(d.name, lang));
          return (
            <li key={g}>
              <h3>{MENU_GROUP_LABELS[g][lang]}</h3>
              <p className="hint">{t(`business.menu.hint.${g}`)}</p>
              <p>{names.length > 0 ? names.join(", ") : t("business.menu.none")}</p>
            </li>
          );
        })}
      </ul>
      {view.menu.length === 0 ? (
        <p className="sa-empty">{t("business.menu.empty")}</p>
      ) : (
        <table className="ex-table bz-table">
          <caption className="sr-only">{t("business.menu.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("business.menu.dish")}</th>
              <th scope="col">{t("business.menu.group")}</th>
              <th scope="col" className="r">{t("business.menu.sold")}</th>
              <th scope="col" className="r">{t("business.menu.rating")}</th>
              <th scope="col" className="r">{t("business.menu.revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {view.menu.map((d) => (
              <tr key={d.itemId ?? d.name.en}>
                <th scope="row">{loc(d.name, lang)}</th>
                <td>{d.group ? MENU_GROUP_LABELS[d.group][lang] : t("business.none")}</td>
                <td className="r font-mono">{d.qty} <Change pct={pct(d.qty, d.prev.qty)} vs={vs} /></td>
                <td className="r font-mono">
                  {d.ratingAvg === null ? <><span aria-hidden="true">{t("business.none")}</span><span className="sr-only">{t("business.menu.unrated")}</span></> : <>★ {num(d.ratingAvg)}</>}
                </td>
                <td className="r font-mono">{money(d.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
