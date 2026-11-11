import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import type { Range, Totals } from "./types";

/** Whole-percent change, or null when there is nothing to compare with. Never NaN or Infinity. */
export function changePct(current: number, previous: number): number | null {
  if (!(previous > 0) || !Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "▲ 12%" / "▼ 8%" / "= 0%" as text; the arrow is decoration, a screen-reader word follows. */
function Change({ pct }: { pct: number | null }) {
  const { t } = useTranslation();
  if (pct === null) return <b className="chg">{t("sales.tiles.noPrevShort")}</b>;
  const kind = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "=";
  return (
    <b className="chg">
      <span aria-hidden="true">{arrow} {Math.abs(pct)}%</span>
      <span className="sr-only">{Math.abs(pct)}% {t(`sales.tiles.${kind}`)}</span>
    </b>
  );
}

function Tile({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section role="group" aria-labelledby={id} className="sa-tile">
      <h2 id={id} className="staff-label">{label}</h2>
      <p className="v font-mono">{value}</p>
      <div className="d">{children}</div>
    </section>
  );
}

/** Revenue, covers, average per cover, comps and voids, each against the previous period of the same length. */
export function Tiles({ range, current: c, previous: p }: { range: Range; current: Totals; previous: Totals }) {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const vs = <span>{t(`sales.tiles.vs.${range}`)}</span>;
  const compsAmount = c.comps.amount + c.voids.amount;
  const pct = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(Number.isFinite(c.compsPct) ? c.compsPct : 0);
  return (
    <div className="sa-tiles">
      <Tile label={t("sales.tiles.revenue")} value={money(c.revenue)}>
        <Change pct={changePct(c.revenue, p.revenue)} /> {vs}
      </Tile>
      <Tile label={t("sales.tiles.covers")} value={c.covers}>
        <Change pct={changePct(c.covers, p.covers)} /> {vs}
      </Tile>
      <Tile label={t("sales.tiles.perCover")} value={money(c.avgPerCover)}>
        <Change pct={changePct(c.avgPerCover, p.avgPerCover)} /> <span>· {t("sales.tiles.perCheck", { amount: money(c.avgPerCheck) })}</span>
      </Tile>
      <Tile label={t("sales.tiles.compsVoids")} value={money(compsAmount)}>
        <Change pct={changePct(compsAmount, p.comps.amount + p.voids.amount)} /> {vs}
        <div>{t("sales.tiles.compsLine", { comps: c.comps.count, voids: c.voids.count, pct })}</div>
      </Tile>
    </div>
  );
}
