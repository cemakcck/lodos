import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Printer } from "lucide-react";
import { fractionLabel } from "@lodos/shared";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import type { ShareView, SplitUnit, SplitView } from "./types";

export interface ShareCardProps {
  view: SplitView;
  share: ShareView;
  units: ReadonlyMap<string, SplitUnit>;
  onPay: (share: ShareView) => void;
}

/**
 * One guest's share: letter, its lines with their parts ("½ Burrata"), the amount and Take payment. A paid share
 * shows "Paid · card" and a Receipt link instead. The amounts are the server's.
 */
export function ShareCard({ view, share, units, onPay }: ShareCardProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const guest = t("close.share.guest", { label: share.label });
  const paid = share.payment;
  const headingId = `cv-share-${share.label}`;
  const empty = view.mode === "items" && share.units.length === 0;
  const amount = money(share.amount);

  return (
    <article className={`cv-card ${paid ? "is-paid" : ""}`} aria-labelledby={headingId}>
      <div className="cv-card-h">
        <span className={`cv-g is-${share.label.toLowerCase()} is-on`} aria-hidden="true">
          {share.label}
        </span>
        <h2 id={headingId}>{guest}</h2>
        <span className={`cv-st ${paid ? "is-paid" : ""}`}>
          {paid ? t("close.share.paid", { method: t(`floor.close.methodWord.${paid.method}`) }) : t("close.share.open")}
        </span>
      </div>
      <ul className="cv-card-b">
        {view.mode === "even" ? (
          <li className="cv-gl">
            <span>{t("close.share.even", { count: view.count })}</span>
          </li>
        ) : empty ? (
          <li className="cv-gl is-empty">
            <span>{t("close.share.empty")}</span>
          </li>
        ) : (
          share.units.map((p) => {
            const u = units.get(p.ref);
            const name = u ? loc(u.name, lang) : p.ref;
            const frac = fractionLabel(p.parts);
            return (
              <li key={p.ref} className="cv-gl">
                <span>{frac ? `${frac} ${name}` : name}</span>
                <span className="font-mono">{money(p.part)}</span>
              </li>
            );
          })
        )}
      </ul>
      <div className="cv-card-f">
        <span className="cv-amt font-mono" data-testid="share-amount">
          {amount}
        </span>
        {paid ? (
          <Link className="staff-btn" to={`/staff/check/${view.checkId}/receipt?share=${share.label}`} aria-label={t("close.share.receiptAria", { label: share.label })}>
            <Printer size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("close.share.receipt")}
          </Link>
        ) : (
          <button
            type="button"
            className="staff-btn primary"
            disabled={view.status !== "open" || empty}
            aria-label={t("close.share.payAria", { label: share.label, amount })}
            onClick={() => onPay(share)}
          >
            {t("close.takePayment")}
          </button>
        )}
      </div>
    </article>
  );
}
