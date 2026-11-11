import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { hh, type SalesView } from "./types";

const W = 720;
const H = 200;
const PAD_X = 8;
const TOP = 30;
const AXIS = 22;

/**
 * Revenue by service hour as hand-rolled SVG bars. The peak hour (highest revenue, when above zero) is the one
 * red bar and carries the word "Peak". Every bar has an accessible name; a visually hidden table repeats the numbers.
 */
export function HourBars({ byHour }: { byHour: SalesView["byHour"] }) {
  const { t } = useTranslation();
  const { money } = useFormat();
  const max = Math.max(0, ...byHour.map((h) => h.revenue));
  const peak = max > 0 ? byHour.findIndex((h) => h.revenue === max) : -1;
  const slot = (W - PAD_X * 2) / Math.max(1, byHour.length);
  const bw = Math.min(44, slot * 0.66);
  const plot = H - TOP - AXIS;

  return (
    <figure className="sa-card">
      <figcaption className="sa-card-h">
        <h2>{t("sales.hours.title")}</h2>
      </figcaption>
      {byHour.length === 0 ? (
        <p className="sa-empty">{t("sales.hours.empty")}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="sa-svg">
            <line x1={0} x2={W} y1={H - AXIS} y2={H - AXIS} className="sa-axis" />
            {byHour.map((h, i) => {
              const x = PAD_X + slot * i + (slot - bw) / 2;
              const bh = max > 0 ? (h.revenue / max) * plot : 0;
              const isPeak = i === peak;
              const label = t(isPeak ? "sales.hours.barPeak" : "sales.hours.bar", { hour: `${hh(h.hour)}:00`, amount: money(h.revenue) });
              return (
                <g key={h.hour} role="img" aria-label={label}>
                  <rect x={x} y={H - AXIS - bh} width={bw} height={bh} rx={3} className={isPeak ? "sa-bar is-peak" : "sa-bar"} />
                  {isPeak && (
                    <text x={x + bw / 2} y={H - AXIS - bh - 8} textAnchor="middle" className="sa-peak-label">
                      {t("sales.hours.peak")}
                    </text>
                  )}
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="sa-tick" aria-hidden="true">{hh(h.hour)}</text>
                </g>
              );
            })}
          </svg>
          <div className="sr-only">
            <table>
              <caption>{t("sales.hours.title")}</caption>
              <thead>
                <tr><th scope="col">{t("sales.hours.hour")}</th><th scope="col">{t("sales.hours.revenue")}</th></tr>
              </thead>
              <tbody>
                {byHour.map((h) => (
                  <tr key={h.hour}><th scope="row">{hh(h.hour)}:00</th><td>{money(h.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  );
}
