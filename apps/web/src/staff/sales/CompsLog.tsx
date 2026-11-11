import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import type { SalesLogEntry } from "./types";

/** Comps and voids in the range, newest first: who asked, who approved, and why. */
export function CompsLog({ log }: { log: SalesLogEntry[] }) {
  const { t } = useTranslation();
  const { lang, money, clock } = useFormat();
  const id = useId();
  const day = new Intl.DateTimeFormat(lang, { timeZone: "Europe/Istanbul", weekday: "short" });
  return (
    <section className="sa-card sa-log" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("sales.log.title")}</h2>
      </div>
      {log.length === 0 ? (
        <p className="sa-empty">{t("sales.log.empty")}</p>
      ) : (
        <ul aria-labelledby={id}>
          {log.map((e, i) => {
            const at = new Date(e.at);
            const reason = t(`adjust.reasons.${e.reason}`, { defaultValue: e.reason });
            return (
              <li key={`${e.at}-${i}`} className={e.reversed ? "is-reversed" : undefined}>
                <span className="t font-mono">{day.format(at)} {clock(at)}</span>
                <span className={`pill ${e.kind}`}>{t(`sales.log.${e.kind}`)}</span>
                <span className="what">{loc(e.itemName, lang)} · {e.tableName}</span>
                <span className="why">
                  {reason}
                  {e.note ? `: ${e.note}` : ""} · {t("sales.log.by", { requester: e.requestedByName, approver: e.approvedByName })}
                  {e.reversed && <b className="undone"> · {t("sales.log.reversed")}</b>}
                </span>
                <span className="amt font-mono">{money(e.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
