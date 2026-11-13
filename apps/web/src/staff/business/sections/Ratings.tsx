import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useFormat } from "../../../lib/format";
import { useSetCommentHidden } from "../../performance/queries";
import { businessKey, type Dist, type MonthlyView } from "../queries";
import { Change, pct, useVs } from "./Change";

/** Stars 5 to 1 as meters with their counts; the numbers are text, the bars only echo them. */
function Spread({ label, dist }: { label: string; dist: Dist }) {
  const { t } = useTranslation();
  const total = dist.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...dist);
  return (
    <div className="bz-spread">
      <h4>{label}</h4>
      {total === 0 ? (
        <p className="sa-empty">{t("business.ratings.noData")}</p>
      ) : (
        <ul aria-label={t("business.ratings.spreadOf", { what: label })}>
          {[5, 4, 3, 2, 1].map((star) => (
            <li key={star}>
              <span className="k">{t("business.ratings.stars", { n: star })}</span>
              <span className="meter" aria-hidden="true"><span className="fill" style={{ width: `${(dist[star - 1]! / max) * 100}%` }} /></span>
              <span className="amt font-mono">{t("business.ratings.count", { count: dist[star - 1]! })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Section 5: the restaurant rating and its three categories, the star spread, a weekly trend and the latest comments (hideable). */
export function Ratings({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const hide = useSetCommentHidden();
  const vs = useVs(view.previous.month);
  const id = useId();
  const r = view.ratings;
  const one = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const date = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
  const cats = [
    ["restaurant", r.restaurant],
    ["food", r.food],
    ["cleanliness", r.cleanliness],
    ["atmosphere", r.atmosphere],
  ] as const;
  const weeks = r.byWeek.cur;
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h"><h2 id={id}>{t("business.ratings.title")}</h2></div>
      <div className="bz-tiles">
        {cats.map(([key, p]) => (
          <div key={key} role="group" aria-label={t(`business.ratings.${key}`)} className="sa-tile bz-tile">
            <h3 className="staff-label">{t(`business.ratings.${key}`)}</h3>
            <p className="v font-mono">
              {p.cur === null ? <><span aria-hidden="true">{t("business.none")}</span><span className="sr-only">{t("business.notEnough")}</span></> : <>★ {one.format(p.cur)}</>}
            </p>
            <div className="d">{p.cur !== null && p.prev !== null && <Change pct={pct(p.cur, p.prev)} vs={vs} />}</div>
          </div>
        ))}
      </div>
      <h3 className="bz-sub">{t("business.ratings.spread")}</h3>
      <div className="bz-three">
        <Spread label={t("business.ratings.forRestaurant")} dist={r.dist.restaurant.cur} />
        <Spread label={t("business.ratings.forWaiter")} dist={r.dist.waiter.cur} />
        <Spread label={t("business.ratings.forDish")} dist={r.dist.dish.cur} />
      </div>
      {weeks.length > 0 && (
        <table className="ex-table bz-table">
          <caption className="bz-cap">{t("business.ratings.trend")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("business.ratings.week")}</th>
              <th scope="col" className="r">{t("business.ratings.restaurant")}</th>
              <th scope="col" className="r">{t("business.ratings.ratings")}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week}>
                <th scope="row">{date(w.week, { day: "numeric", month: "short" })}</th>
                <td className="r font-mono">{w.restaurant === null ? t("business.none") : `★ ${one.format(w.restaurant)}`}</td>
                <td className="r font-mono">{w.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="bz-sub">{t("business.ratings.comments")}</h3>
      {r.comments.length === 0 ? (
        <p className="sa-empty">{t("business.ratings.noComments")}</p>
      ) : (
        <ul className="pf-comments" aria-label={t("business.ratings.comments")}>
          {r.comments.map((c) => (
            <li key={c.id} className="pf-comment">
              <div className="meta font-mono">{date(c.serviceDay, { dateStyle: "medium" })}</div>
              <p>{c.comment}</p>
              <button
                type="button"
                className="staff-btn"
                disabled={hide.isPending}
                aria-label={`${t("business.ratings.hideComment")}: ${c.comment}`}
                onClick={() => hide.mutate({ id: c.id, hidden: true }, { onSuccess: () => void qc.invalidateQueries({ queryKey: businessKey }) })}
              >
                {t("business.ratings.hide")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hide.isError && <p role="alert" className="mg-error">{t("business.ratings.error")}</p>}
    </section>
  );
}
