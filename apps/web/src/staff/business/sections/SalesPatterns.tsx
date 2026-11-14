import { useId } from "react";
import { useTranslation } from "react-i18next";
import { HourBars } from "../../sales/HourBars";
import { useFormat } from "../../../lib/format";
import type { MonthlyView } from "../queries";
import { Change, pct, useVs } from "./Change";

const W = 720;
const H = 180;
const AXIS = 22;

/** Revenue per day as SVG bars; a visually hidden table repeats every number. */
function DayBars({ days }: { days: MonthlyView["sales"]["byDay"]["cur"] }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const max = Math.max(0, ...days.map((d) => d.revenue));
  const slot = W / Math.max(1, days.length);
  const bw = Math.min(20, slot * 0.7);
  const plot = H - AXIS - 8;
  const dayLabel = (d: string) => new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return (
    <figure className="bz-fig">
      <figcaption className="bz-cap">{t("business.sales.byDay")}</figcaption>
      {days.length === 0 ? (
        <p className="sa-empty">{t("business.sales.empty")}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="sa-svg">
            <line x1={0} x2={W} y1={H - AXIS} y2={H - AXIS} className="sa-axis" />
            {days.map((d, i) => {
              const bh = max > 0 ? (d.revenue / max) * plot : 0;
              const x = slot * i + (slot - bw) / 2;
              return (
                <g key={d.day} role="img" aria-label={t("business.sales.bar", { day: dayLabel(d.day), amount: money(d.revenue) })}>
                  <rect x={x} y={H - AXIS - bh} width={bw} height={bh} rx={2} className="sa-bar" />
                  {(i === 0 || (i + 1) % 5 === 0) && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="sa-tick" aria-hidden="true">{Number(d.day.slice(8))}</text>}
                </g>
              );
            })}
          </svg>
          <div className="sr-only">
            <table>
              <caption>{t("business.sales.byDay")}</caption>
              <thead><tr><th scope="col">{t("business.sales.day")}</th><th scope="col">{t("business.sales.revenue")}</th></tr></thead>
              <tbody>
                {days.map((d) => <tr key={d.day}><th scope="row">{dayLabel(d.day)}</th><td>{money(d.revenue)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  );
}

function Weekdays({ rows }: { rows: MonthlyView["sales"]["byWeekday"]["cur"] }) {
  const { t } = useTranslation();
  const { money } = useFormat();
  return (
    <table className="ex-table bz-table">
      <caption className="bz-cap">{t("business.sales.byWeekday")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("business.sales.weekday")}</th>
          <th scope="col" className="r">{t("business.sales.revenue")}</th>
          <th scope="col" className="r">{t("business.sales.nights")}</th>
          <th scope="col" className="r">{t("business.sales.avg")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.weekday}>
            <th scope="row">{t(`business.sales.days.${r.weekday}`)}</th>
            <td className="r font-mono">{money(r.revenue)}</td>
            <td className="r font-mono">{r.nights}</td>
            <td className="r font-mono">{money(r.avg)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Section 2: sales by day, weekday and hour, plus the headline ratios against the comparison days. */
export function SalesPatterns({ view }: { view: MonthlyView }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = useVs(view.previous.month);
  const s = view.sales;
  const id = useId();
  const dec = (n: number | null) => (n === null ? t("business.none") : new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n));
  const int = (n: number) => new Intl.NumberFormat(lang).format(n);
  const perHour = s.salesPerLabourHour.cur;
  return (
    <section className="sa-card" aria-labelledby={id}>
      <div className="sa-card-h"><h2 id={id}>{t("business.sales.title")}</h2></div>
      <DayBars days={s.byDay.cur} />
      <div className="bz-tiles">
        <div className="sa-tile bz-tile">
          <h3 className="staff-label">{t("business.sales.avgCheck")}</h3>
          <p className="v font-mono">{money(s.avgCheck.cur)}</p>
          <div className="d"><Change pct={pct(s.avgCheck.cur, s.avgCheck.prev)} vs={vs} /></div>
        </div>
        <div className="sa-tile bz-tile">
          <h3 className="staff-label">{t("business.sales.avgCover")}</h3>
          <p className="v font-mono">{money(s.avgCover.cur)}</p>
          <div className="d"><Change pct={pct(s.avgCover.cur, s.avgCover.prev)} vs={vs} /></div>
        </div>
        <div className="sa-tile bz-tile">
          <h3 className="staff-label">{t("business.sales.covers")}</h3>
          <p className="v font-mono">{int(s.covers.cur)}</p>
          <div className="d"><Change pct={pct(s.covers.cur, s.covers.prev)} vs={vs} /></div>
        </div>
        <div className="sa-tile bz-tile">
          <h3 className="staff-label">{t("business.sales.perLabour")}</h3>
          <p className="v font-mono">{perHour === null ? t("business.none") : money(perHour)}</p>
          <div className="d">{perHour !== null && s.salesPerLabourHour.prev !== null && <Change pct={pct(perHour, s.salesPerLabourHour.prev)} vs={vs} />}</div>
        </div>
        <div className="sa-tile bz-tile">
          <h3 className="staff-label">{t("business.sales.turns")}</h3>
          <p className="v font-mono">{dec(s.turnsPerNight.cur)}</p>
          <div className="d">{s.turnsPerNight.cur !== null && s.turnsPerNight.prev !== null && <Change pct={pct(s.turnsPerNight.cur, s.turnsPerNight.prev)} vs={vs} />}</div>
        </div>
      </div>
      <div className="bz-two">
        <Weekdays rows={s.byWeekday.cur} />
        <HourBars byHour={s.byHour.cur} />
      </div>
    </section>
  );
}
