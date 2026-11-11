import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "../lib/api";
import { useFormat } from "../lib/format";
import { useDemo } from "../demo/useDemo";
import { loc } from "./kds/lib";
import type { ReceiptView } from "./floor/types";

const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });

export const receiptKey = (checkId: string, share: string | null) => ["receipt", checkId, share] as const;

export interface ReceiptProps {
  /** Opens the browser's print dialog; injectable so tests never call the real one. */
  print?: () => void;
}

const browserPrint = () => {
  if (typeof window.print === "function") window.print();
};

/**
 * `/staff/check/:id/print` (the whole check) and `/staff/check/:id/receipt?share=A` (one share): an 80 mm receipt.
 * It opens the print dialog once the data has loaded and the fonts are ready; `?noprint` skips that.
 * The language is the staff UI language.
 */
export function Receipt({ print = browserPrint }: ReceiptProps) {
  const { t } = useTranslation();
  const { lang, money, clock: hhmm } = useFormat();
  const { isDemo } = useDemo();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const share = params.get("share");
  const url = share ? `/api/checks/${id}/receipt?share=${encodeURIComponent(share)}` : `/api/checks/${id}/print`;
  const q = useQuery({ queryKey: receiptKey(id, share), queryFn: () => api<ReceiptView>(url) });
  const data = q.data;

  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.has("noprint")) return;
    printed.current = true;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) void fonts.ready.then(() => print());
    else print();
  }, [data, params, print]);

  const toolbar = (
    <div className="pc-toolbar no-print">
      <Link to={data ? `/staff/floor?table=${data.table.id}` : "/staff/floor"} className="staff-btn">
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

  const at = new Date(data.closedAt ?? data.printedAt);
  const tableLine = data.share
    ? t("floor.print.guest", { table: data.table.name, label: data.share.label, count: data.share.of })
    : data.table.name;
  const method = (m: "card" | "cash", last4: string | null) =>
    m === "cash" ? t("floor.print.cash") : last4 ? t("floor.print.card", { last4 }) : t("floor.print.cardPlain");
  const paymentLines = data.payment
    ? [{ key: "p", text: method(data.payment.method, data.payment.last4), amount: data.payment.amount }]
    : data.payments.map((p) => ({ key: p.label, text: `${p.label} · ${method(p.method, p.last4)}`, amount: p.amount }));

  return (
    <div className="pc-page">
      {toolbar}
      <article className="pc-receipt" aria-label={t("floor.print.title", { table: data.table.name })}>
        <header className="pc-head">
          <p className="pc-wordmark">Lodos</p>
          <p className="pc-muted">{t("floor.print.address")}</p>
          {isDemo && <p className="pc-muted">{t("floor.print.demo")}</p>}
        </header>
        <div className="pc-row">
          <span>{tableLine}</span>
          <span>{t("floor.print.checkNo", { no: data.checkNo })}</span>
        </div>
        <div className="pc-row pc-muted pc-rule">
          <span className="pr">
            {dateFmt.format(at)} {hhmm(at)}
          </span>
          <span>{data.serverName}</span>
        </div>
        <ul className="pc-lines">
          {data.lines.map((l, i) => (
            <li key={i}>
              <span className="nm">
                {l.label && <span className="q">{l.label} </span>}
                {loc(l.name, lang)}
                {l.options.map((o, j) => (
                  <span key={j} className="mod">
                    {loc(o, lang)}
                  </span>
                ))}
                {l.comp && <span className="mod">{t("floor.print.comp", { reason: t(`adjust.reasons.${l.comp}`, { defaultValue: l.comp }) })}</span>}
              </span>
              <span className="pr">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="pc-total" data-testid="receipt-total">
          <span>{t("floor.print.total")}</span>
          <span className="pr">{money(data.total)}</span>
        </p>
        {data.vat.map((v) => (
          <div key={v.rate} className="pc-row pc-muted">
            <span>{t("floor.print.vat", { rate: v.rate })}</span>
            <span className="pr">{money(v.amount)}</span>
          </div>
        ))}
        {paymentLines.map((p) => (
          <div key={p.key} className="pc-row pc-pay">
            <span>{p.text}</span>
            <span className="pr">{money(p.amount)}</span>
          </div>
        ))}
        {data.comps.count > 0 && (
          <p className="pc-center pc-muted pc-rule">{t("floor.print.comps", { count: data.comps.count, amount: money(data.comps.amount) })}</p>
        )}
        <p className="pc-thanks">{t("floor.print.thanks")}</p>
        <p className="pc-center pc-muted pc-fine">{t("floor.print.fiscal")}</p>
      </article>
    </div>
  );
}
