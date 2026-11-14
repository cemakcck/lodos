import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { useFormat } from "../../../lib/format";
import { loc } from "../../kds/lib";
import { csvHref, type MonthlyView } from "../queries";
import { Change, pct, useVs } from "./Change";

/** Section 6: spend against budget per category, the total, and the month's biggest single costs. */
export function ExpensesSection({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = useVs(view.previous.month);
  const id = useId();
  const e = view.expenses;
  const prevSpent = new Map(e.byCategory.prev.map((c) => [c.categoryId, c.spent]));
  const day = (d: string) => new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("business.expenses.title")}</h2>
        <a className="staff-btn" href={csvHref(view.month, "expenses")} download aria-label={t("business.csvOf", { section: t("business.expenses.title") })}>
          <Download size={15} aria-hidden="true" />
          {t("business.csv")}
        </a>
      </div>
      {e.byCategory.cur.length === 0 ? (
        <p className="sa-empty">{t("business.expenses.empty")}</p>
      ) : (
        <table className="ex-table bz-table">
          <caption className="sr-only">{t("business.expenses.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("business.expenses.category")}</th>
              <th scope="col" className="r">{t("business.expenses.spent")}</th>
              <th scope="col" className="r">{t("business.expenses.budget")}</th>
              <th scope="col">{t("business.expenses.status")}</th>
            </tr>
          </thead>
          <tbody>
            {e.byCategory.cur.map((c) => {
              const over = c.budget > 0 && c.spent > c.budget;
              return (
                <tr key={c.categoryId}>
                  <th scope="row">{loc(c.name, lang)}</th>
                  <td className="r font-mono">{money(c.spent)} <Change pct={pct(c.spent, prevSpent.get(c.categoryId) ?? 0)} vs={vs} /></td>
                  <td className="r font-mono">{c.budget > 0 ? money(c.budget) : t("business.none")}</td>
                  <td className={over ? "bz-over" : undefined}>
                    {c.budget === 0 ? t("business.expenses.noBudget") : over ? `▲ ${t("business.expenses.over", { amount: money(c.spent - c.budget) })}` : t("business.expenses.under", { amount: money(c.budget - c.spent) })}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("business.expenses.total")}</th>
              <td className="r font-mono">{money(e.total.cur)} <Change pct={pct(e.total.cur, e.total.prev)} vs={vs} /></td>
              <td className="r font-mono">{e.budgetTotal > 0 ? money(e.budgetTotal) : t("business.none")}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      <h3 className="bz-sub">{t("business.expenses.biggest")}</h3>
      {e.biggest.length === 0 ? (
        <p className="sa-empty">{t("business.expenses.empty")}</p>
      ) : (
        <table className="ex-table bz-table">
          <caption className="sr-only">{t("business.expenses.biggest")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("business.expenses.date")}</th>
              <th scope="col">{t("business.expenses.category")}</th>
              <th scope="col">{t("business.expenses.payee")}</th>
              <th scope="col" className="r">{t("business.expenses.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {e.biggest.map((x) => (
              <tr key={x.id}>
                <td className="font-mono">{day(x.date)}</td>
                <td>{loc(x.category, lang)}</td>
                <td>{x.payee ?? x.note ?? ""}</td>
                <td className="r font-mono">{money(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
