import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "../lib/api";
import { useFormat } from "../lib/format";
import { loc } from "./kds/lib";
import type { CheckLine, CheckPrint } from "./floor/types";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });

export const printKey = (checkId: string) => ["checkPrint", checkId] as const;

export interface PrintCheckProps {
  /** Opens the browser's print dialog; injectable so tests never call the real one. */
  print?: () => void;
  /** Device clock, for the printed time of an open check. */
  clock?: () => number;
}

const browserPrint = () => {
  if (typeof window.print === "function") window.print();
};

/**
 * `/staff/check/:id/print`: the check as a receipt (wordmark, table, date and time, Food and Drinks with
 * subtotals, total, "KDV dahil / VAT included"), styled for paper by `@media print`. It opens the print dialog once
 * the data has loaded and the fonts are ready; `?noprint` skips that.
 */
export function PrintCheck({ print = browserPrint, clock = Date.now }: PrintCheckProps) {
  const { t } = useTranslation();
  const { lang, money, clock: hhmm } = useFormat();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: printKey(id), queryFn: () => api<CheckPrint>(`/api/checks/${id}/print`) });
  const data = q.data;

  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.has("noprint")) return;
    printed.current = true;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) void fonts.ready.then(() => print());
    else print();
  }, [data, params, print]);

  const back = `/staff/floor${data ? `?table=${data.table.id}` : ""}`;
  const toolbar = (
    <div className="pc-toolbar no-print">
      <Link to={back} className="staff-btn">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("floor.print.back")}
      </Link>
      <button type="button" className="staff-btn primary" disabled={!data} onClick={() => print()}>
        <Printer size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("floor.print.print")}
      </button>
    </div>
  );

  if (!data) {
    return (
      <div className="pc-page">
        {toolbar}
        <p className="pc-status" role={q.isError ? "alert" : "status"}>
          {q.isError ? t("floor.print.loadError") : t("floor.print.loading")}
        </p>
      </div>
    );
  }

  const at = new Date(data.check.closedAt ?? clock());
  const group = (key: "food" | "drinks", lines: CheckLine[], subtotal: number) =>
    lines.length > 0 && (
      <section className="pc-group" aria-label={t(`floor.print.${key}`)}>
        <h2>{t(`floor.print.${key}`)}</h2>
        <ul>
          {lines.map((l, i) => (
            <li key={`${l.orderId}-${i}`}>
              <span className="q">{l.qty}</span>
              <span className="nm">
                {loc(l.name, lang)}
                {l.options.map((o, j) => (
                  <span key={j} className="mod">
                    {loc(o, lang)}
                  </span>
                ))}
              </span>
              <span className="pr">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="pc-sub" data-testid={`sub-${key}`}>
          <span>{t("floor.print.subtotal", { group: t(`floor.print.${key}`) })}</span>
          <span className="pr">{money(subtotal)}</span>
        </p>
      </section>
    );

  return (
    <div className="pc-page">
      {toolbar}
      <article className="pc-receipt" aria-label={t("floor.print.title", { table: data.table.name })}>
        <header className="pc-head">
          <p className="pc-wordmark">Lodos</p>
        </header>
        <dl className="pc-meta">
          <div>
            <dt>{t("floor.print.table")}</dt>
            <dd className="pc-table">{data.table.name}</dd>
          </div>
          <div>
            <dt>{t("floor.print.date")}</dt>
            <dd className="pr">{dateFmt.format(at)}</dd>
          </div>
          <div>
            <dt>{t("floor.print.time")}</dt>
            <dd className="pr">{hhmm(at)}</dd>
          </div>
          {data.check.serverName && (
            <div>
              <dt>{t("floor.print.server")}</dt>
              <dd>{data.check.serverName}</dd>
            </div>
          )}
          {data.check.covers != null && (
            <div>
              <dt>{t("floor.print.covers")}</dt>
              <dd className="pr">{data.check.covers}</dd>
            </div>
          )}
        </dl>
        {group("food", data.food, data.totals.food)}
        {group("drinks", data.drinks, data.totals.drinks)}
        <p className="pc-total" data-testid="print-total">
          <span>{t("floor.print.total")}</span>
          <span className="pr">{money(data.totals.total)}</span>
        </p>
        <p className="pc-vat">KDV dahil / VAT included</p>
        <p className="pc-paid">
          {data.check.payment
            ? t("floor.print.paidBy", { method: t(`floor.close.methodWord.${data.check.payment.method}`) })
            : t("floor.print.open")}
        </p>
        <p className="pc-thanks">{t("floor.print.thanks")}</p>
      </article>
    </div>
  );
}
