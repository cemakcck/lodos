import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { BreakdownRow } from "./queries";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A stacked bar out of 100 (one segment per component) with its text equivalent: a table of points and max.
 * `score` is the total shown; the table's total row is the sum of the rows, which equals it.
 */
export function Breakdown({ breakdown, score, station = false }: { breakdown: BreakdownRow[]; score: number; station?: boolean }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const num = (n: number) => new Intl.NumberFormat(i18n.language === "tr" ? "tr-TR" : "en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  const name = (k: BreakdownRow["key"]) => t(k === "rating" && station ? "performance.parts.dishRating" : `performance.parts.${k}`);
  const total = round1(breakdown.reduce((s, b) => s + b.points, 0));
  return (
    <div className="pf-breakdown">
      <h2 id={id} className="staff-label">{t("performance.breakdown.title")}</h2>
      <div className="pf-stack" role="img" aria-label={t("performance.breakdown.bar", { score: num(score) })}>
        {breakdown.map((b, i) => (
          <span key={b.key} className={`seg s${i}`} style={{ width: `${b.points}%` }} title={`${name(b.key)}: ${num(b.points)} / ${b.max}`} />
        ))}
      </div>
      <table className="pf-table" aria-labelledby={id}>
        <thead>
          <tr>
            <th scope="col">{t("performance.breakdown.component")}</th>
            <th scope="col" className="r">{t("performance.breakdown.points")}</th>
            <th scope="col" className="r">{t("performance.breakdown.max")}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((b, i) => (
            <tr key={b.key}>
              <th scope="row"><span className={`sw s${i}`} aria-hidden="true" />{name(b.key)}</th>
              <td className="r font-mono">{num(b.points)}</td>
              <td className="r font-mono">{b.max}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("performance.breakdown.total")}</th>
            <td className="r font-mono">{num(total)}</td>
            <td className="r font-mono">100</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
