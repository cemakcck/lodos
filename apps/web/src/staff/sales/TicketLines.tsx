import { useTranslation } from "react-i18next";
import { serviceHourIndex } from "@lodos/shared";
import { hh, type SalesView } from "./types";

const W = 720;
const H = 200;
const PAD_X = 28;
const TOP = 26;
const AXIS = 22;

const fmt = (n: number, lang: string) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);

/**
 * Average ticket time per hour for the kitchen (plum, round markers) and the bar (tan, square markers), with a
 * dashed neutral line at the lateness threshold. A visually hidden table repeats the numbers.
 */
export function TicketLines({ times, thresholdMin }: { times: SalesView["ticketTimes"]; thresholdMin: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "tr" ? "tr" : "en";
  const kitchen = new Map(times.kitchen.map((p) => [p.hour, p.avgMin]));
  const bar = new Map(times.bar.map((p) => [p.hour, p.avgMin]));
  const hours = [...new Set([...kitchen.keys(), ...bar.keys()])].sort((a, b) => serviceHourIndex(a) - serviceHourIndex(b));
  const values = [...kitchen.values(), ...bar.values()].filter(Number.isFinite);
  const top = Math.max(thresholdMin * 1.25, Math.max(0, ...values) * 1.1, 1);
  const plot = H - TOP - AXIS;
  const y = (v: number) => H - AXIS - (v / top) * plot;
  const x = (i: number) => (hours.length <= 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (hours.length - 1));

  const series = [
    { key: "kitchen", map: kitchen, cls: "sa-line-k", square: false },
    { key: "bar", map: bar, cls: "sa-line-b", square: true },
  ] as const;
  const points = (map: Map<number, number>) =>
    hours.flatMap((h, i) => (map.has(h) ? [{ h, i, v: map.get(h)! }] : []));

  return (
    <figure className="sa-card">
      <figcaption className="sa-card-h">
        <h2>{t("sales.tickets.title")}</h2>
        <span className="sa-legend">
          <span><i className="sa-key-k" aria-hidden="true" />{t("sales.tickets.kitchen")}</span>
          <span><i className="sa-key-b" aria-hidden="true" />{t("sales.tickets.bar")}</span>
        </span>
      </figcaption>
      {hours.length === 0 ? (
        <p className="sa-empty">{t("sales.tickets.empty")}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="sa-svg" aria-hidden="true">
            <line x1={0} x2={W} y1={H - AXIS} y2={H - AXIS} className="sa-axis" />
            <line x1={0} x2={W} y1={y(thresholdMin)} y2={y(thresholdMin)} className="sa-threshold" />
            <text x={W - 4} y={y(thresholdMin) - 6} textAnchor="end" className="sa-thr-label">
              {t("sales.tickets.threshold", { min: thresholdMin })}
            </text>
            {series.map((s) => {
              const pts = points(s.map);
              return (
                <g key={s.key} className={s.cls}>
                  {pts.length > 1 && <polyline fill="none" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} />}
                  {pts.map((p) =>
                    s.square ? (
                      <rect key={p.h} x={x(p.i) - 3.5} y={y(p.v) - 3.5} width={7} height={7} />
                    ) : (
                      <circle key={p.h} cx={x(p.i)} cy={y(p.v)} r={3.5} />
                    ),
                  )}
                </g>
              );
            })}
            {hours.map((h, i) => (
              <text key={h} x={x(i)} y={H - 6} textAnchor="middle" className="sa-tick">{hh(h)}</text>
            ))}
          </svg>
          <div className="sr-only">
            <table>
              <caption>{t("sales.tickets.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("sales.hours.hour")}</th>
                  <th scope="col">{t("sales.tickets.kitchen")}</th>
                  <th scope="col">{t("sales.tickets.bar")}</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((h) => (
                  <tr key={h}>
                    <th scope="row">{hh(h)}:00</th>
                    <td>{kitchen.has(h) ? t("sales.tickets.min", { value: fmt(kitchen.get(h)!, lang) }) : "–"}</td>
                    <td>{bar.has(h) ? t("sales.tickets.min", { value: fmt(bar.get(h)!, lang) }) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  );
}
