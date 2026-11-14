import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../../lib/format";
import { loc } from "../../kds/lib";
import type { MonthlyView } from "../queries";
import { Change, pct, ptsChange, useVs } from "./Change";

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="sa-tile bz-tile">
      <h3 id={id} className="staff-label">{label}</h3>
      <p className="v font-mono">{value}</p>
      <div className="d">{children}</div>
    </div>
  );
}

/** Section 1: sales, costs and profit of the month, each against the comparison days. Cost changes are words, not good or bad colours. */
export function Pnl({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = useVs(view.previous.month);
  const { cur, prev } = view.pnl;
  const num = (n: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);
  const share = (part: number) => (cur.sales > 0 ? <span>{t("business.ofSales", { n: num((part / cur.sales) * 100) })}</span> : null);
  const id = useId();
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h"><h2 id={id}>{t("business.pnl.title")}</h2></div>
      <div className="bz-tiles">
        <Tile label={t("business.pnl.sales")} value={money(cur.sales)}>
          <Change pct={pct(cur.sales, prev.sales)} vs={vs} />
        </Tile>
        <Tile label={t("business.pnl.foodDrink")} value={money(cur.foodDrink)}>
          {share(cur.foodDrink)} <Change pct={pct(cur.foodDrink, prev.foodDrink)} vs={vs} />
        </Tile>
        <Tile label={t("business.pnl.labour")} value={money(cur.labour)}>
          {share(cur.labour)} <Change pct={pct(cur.labour, prev.labour)} vs={vs} />
        </Tile>
        <Tile label={t("business.pnl.other")} value={money(cur.other)}>
          <Change pct={pct(cur.other, prev.other)} vs={vs} />
        </Tile>
        <Tile label={t("business.pnl.profit")} value={money(cur.profit)}>
          {cur.margin !== null && <span>{t("business.margin", { n: num(cur.margin * 100) })}</span>} <Change pts={ptsChange(cur.margin, prev.margin)} vs={vs} />
          {" "}<Change pct={pct(cur.profit, prev.profit)} vs={vs} />
        </Tile>
      </div>
      {cur.otherByCategory.length > 0 && (
        <table className="ex-table bz-table" aria-label={t("business.pnl.otherBy")}>
          <caption className="bz-cap">{t("business.pnl.otherBy")}</caption>
          <thead>
            <tr><th scope="col">{t("business.expenses.category")}</th><th scope="col" className="r">{t("business.expenses.spent")}</th></tr>
          </thead>
          <tbody>
            {cur.otherByCategory.map((c) => (
              <tr key={c.categoryId}><th scope="row">{loc(c.name, lang)}</th><td className="r font-mono">{money(c.spent)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
