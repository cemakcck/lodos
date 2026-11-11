import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { loc } from "../kds/lib";
import { CompsLog } from "./CompsLog";
import { HourBars } from "./HourBars";
import { useSales } from "./queries";
import { Tiles } from "./Tiles";
import { TicketLines } from "./TicketLines";
import { csvHref, RANGES, type Range, type SalesView } from "./types";

function TopDishes({ items }: { items: SalesView["topItems"] }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const id = useId();
  const max = Math.max(1, ...items.map((i) => i.qty));
  return (
    <section className="sa-card sa-top" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("sales.top.title")}</h2>
        <span className="staff-label">{t("sales.top.sub")}</span>
      </div>
      {items.length === 0 ? (
        <p className="sa-empty">{t("sales.top.empty")}</p>
      ) : (
        <ol aria-labelledby={id}>
          {items.map((x, i) => (
            <li key={`${x.name.en}-${i}`}>
              <span className="rk font-mono" aria-hidden="true">{i + 1}</span>
              <span className="nm">{loc(x.name, lang)}</span>
              <span className="meter" aria-hidden="true"><span style={{ width: `${(x.qty / max) * 100}%` }} /></span>
              <span className="q font-mono">{x.qty}</span>
              <span className="m font-mono">{money(x.revenue)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** `/staff/sales`: the manager's dashboard for Today, 7 days (default) or 30 days. */
export function Sales() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>("7d");
  const q = useSales(range);
  const d = q.data;

  const toolbar = (
    <div className="staff-seg sa-range ml-2" role="group" aria-label={t("sales.ranges.label")}>
      {RANGES.map((r) => (
        <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)}>
          {t(`sales.ranges.${r}`)}
        </button>
      ))}
    </div>
  );
  const actions = (
    <a className="staff-btn" href={csvHref(range)} download>
      <Download size={16} aria-hidden="true" />
      {t("sales.export")}
    </a>
  );
  const period = d && (d.from === d.to ? d.from : t("sales.period", { from: d.from, to: d.to }));

  return (
    <Shell title={t("sales.title")} subtitle={<span className="font-mono">{period}</span>} toolbar={toolbar} actions={actions} stats={null} clock={false}>
      {!d ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("sales.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("sales.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page sa-page" role="region" aria-label={t("sales.title")} tabIndex={0}>
          <Tiles range={d.range} current={d.current} previous={d.previous} />
          <div className="sa-grid">
            <HourBars byHour={d.byHour} />
            <TicketLines times={d.ticketTimes} thresholdMin={d.thresholdMin} />
            <TopDishes items={d.topItems} />
            <CompsLog log={d.log} />
          </div>
        </div>
      )}
    </Shell>
  );
}
