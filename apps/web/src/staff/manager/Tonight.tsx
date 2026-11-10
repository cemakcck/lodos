import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useFormat } from "../../lib/format";
import { useLive } from "../../lib/useLive";
import { Shell } from "../Shell";
import { loc } from "../kds/lib";
import { useTonight } from "./queries";
import { tonightKey } from "./types";

export const TOP_N = 5;

function Kv({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  const id = useId();
  return (
    <section role="group" aria-labelledby={id} className="mg-kv">
      <h2 id={id} className="staff-label">{label}</h2>
      <p className="v font-mono">{value}</p>
      {sub && <p className="s">{sub}</p>}
    </section>
  );
}

/**
 * `/staff/tonight`: the service day so far. Covers, revenue (closed checks), open checks with their total,
 * average ticket time, and the five best-selling items. Refreshes on order and check events, and every minute.
 */
export function Tonight() {
  const { t } = useTranslation();
  const { lang, money, elapsed } = useFormat();
  const qc = useQueryClient();
  const q = useTonight();
  const topId = useId();
  useLive({ audience: "staff" }, (e) => {
    if (e.type.startsWith("ticket.") || e.type === "check.updated") void qc.invalidateQueries({ queryKey: tonightKey });
  });
  const d = q.data;
  const top = d?.topItems.slice(0, TOP_N) ?? [];
  const max = Math.max(1, ...top.map((x) => x.qty));

  const statsEnd = <span>{t("manager.tonight.serviceDay")}</span>;

  return (
    <Shell title={t("manager.tonight.title")} stats={null} statsEnd={statsEnd} clock={false}>
      {!d ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("manager.tonight.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page mg-tonight">
          <div className="mg-kvs">
            <Kv label={t("manager.tonight.covers")} value={d.covers} sub={t("manager.tonight.coversHint")} />
            <Kv label={t("manager.tonight.revenue")} value={money(d.revenue)} sub={t("manager.tonight.revenueHint")} />
            <Kv
              label={t("manager.tonight.open")}
              value={d.openChecks}
              sub={
                <>
                  <b className="font-mono">{money(d.openTotal)}</b> {t("manager.tonight.openTotal")}
                </>
              }
            />
            <Kv
              label={t("manager.tonight.avg")}
              value={d.avgTicketMs > 0 ? elapsed(d.avgTicketMs) : "–"}
              sub={d.avgTicketMs > 0 ? t("manager.tonight.avgHint") : t("manager.tonight.none")}
            />
          </div>

          <section className="mg-top" aria-labelledby={topId}>
            <h2 id={topId} className="mg-top-h">{t("manager.tonight.top")}</h2>
            {top.length === 0 ? (
              <p className="mg-muted">{t("manager.tonight.topEmpty")}</p>
            ) : (
              <ol aria-labelledby={topId}>
                {top.map((x, i) => (
                  <li key={`${x.name.en}-${i}`}>
                    <span className="rk font-mono" aria-hidden="true">{i + 1}</span>
                    <span className="nm">{loc(x.name, lang)}</span>
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: `${(x.qty / max) * 100}%` }} />
                    </span>
                    <span className="q">
                      <b className="font-mono">{x.qty}</b> {t("manager.tonight.sold")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
