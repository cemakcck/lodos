import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, CreditCard } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import type { PayMethod } from "../floor/types";

export interface PayDialogProps {
  /** "Close check · T4", "Take payment · Guest A". */
  title: string;
  /** Kuruş, as computed by the server; sent back to confirm it. */
  amount: number;
  /** The confirm button's words: "Close check", "Take payment". */
  confirmLabel: string;
  /** The confirm button's words while the request runs. */
  pendingLabel: string;
  /** The guest's choice when they asked for the bill; preselected. */
  suggested?: PayMethod | null;
  pending: boolean;
  /** Shown as an alert, e.g. "The amount changed to ₺X". */
  error: string | null;
  onConfirm: (method: PayMethod) => void;
  onCancel: () => void;
}

const METHODS: readonly PayMethod[] = ["card", "cash"];

/**
 * Confirm a payment: the amount in JetBrains Mono, card or cash, then confirm. Used for closing in full and for one
 * share. The payment is recorded, not taken.
 */
export function PayDialog({ title, amount, confirmLabel, pendingLabel, suggested = null, pending, error, onConfirm, onCancel }: PayDialogProps) {
  const { t } = useTranslation();
  const { money } = useFormat();
  const [method, setMethod] = useState<PayMethod>(suggested ?? "card");
  const radios = useRef<Record<PayMethod, HTMLButtonElement | null>>({ card: null, cash: null });
  const shown = money(amount);
  const pick = (m: PayMethod) => {
    setMethod(m);
    radios.current[m]?.focus();
  };

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      width={380}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onCancel}>
            {t("floor.cancel")}
          </button>
          <button
            type="button"
            className="staff-btn primary"
            disabled={pending}
            aria-label={t("close.pay.confirmAria", { action: confirmLabel, amount: shown, method: t(`floor.close.methodWord.${method}`) })}
            onClick={() => onConfirm(method)}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="fl-close-total">
        <span className="staff-label">{t("floor.close.total")}</span>
        <span className="font-mono" data-testid="close-total">
          {shown}
        </span>
      </div>
      <p className="staff-label mt-4 mb-2" id="close-method-label">{t("floor.close.method")}</p>
      <div className="fl-methods" role="radiogroup" aria-labelledby="close-method-label">
        {METHODS.map((m, i) => {
          const Icon = m === "card" ? CreditCard : Banknote;
          return (
            <button
              key={m}
              ref={(el) => {
                radios.current[m] = el;
              }}
              type="button"
              role="radio"
              aria-checked={method === m}
              tabIndex={method === m ? 0 : -1}
              className="fl-method"
              onClick={() => setMethod(m)}
              onKeyDown={(e) => {
                if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  pick(METHODS[(i + 1) % METHODS.length]!);
                }
              }}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {t(`floor.close.${m}`)}
            </button>
          );
        })}
      </div>
      {suggested && <p className="fl-dialog-note">{t("floor.close.asked", { method: t(`floor.close.methodWord.${suggested}`) })}</p>}
      <p className="fl-dialog-note">{t("floor.close.simulated")}</p>
      {error && (
        <p className="staff-notice mt-3" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
