import { useId, type Ref } from "react";
import { useTranslation } from "react-i18next";

export const PIN_RE = /^\d{4,6}$/;

interface Props {
  pin: string;
  confirm: string;
  onPin: (v: string) => void;
  onConfirm: (v: string) => void;
  pinError?: string;
  confirmError?: string;
  /** Label of the first field ("PIN", or "New PIN" when resetting). */
  label?: string;
  pinRef?: Ref<HTMLInputElement>;
  confirmRef?: Ref<HTMLInputElement>;
}

/** PIN + confirm: password fields with the numeric keypad, visible labels, errors tied by aria-describedby. */
export function PinFields({ pin, confirm, onPin, onConfirm, pinError, confirmError, label, pinRef, confirmRef }: Props) {
  const { t } = useTranslation();
  const base = useId();
  const field = (id: string, text: string, value: string, set: (v: string) => void, err: string | undefined, ref?: Ref<HTMLInputElement>) => (
    <div className="mg-field">
      <label htmlFor={`${base}-${id}`}>{text}</label>
      <input
        ref={ref}
        id={`${base}-${id}`}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        className="mg-input font-mono"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${base}-${id}-err` : `${base}-hint`}
      />
      {err && <p id={`${base}-${id}-err`} className="mg-err">{err}</p>}
    </div>
  );
  return (
    <div className="mg-grid2">
      {field("pin", label ?? t("people.pin"), pin, onPin, pinError, pinRef)}
      {field("confirm", t("people.pinConfirm"), confirm, onConfirm, confirmError, confirmRef)}
      <p id={`${base}-hint`} className="mg-hint" style={{ gridColumn: "1 / -1" }}>{t("people.pinHint")}</p>
    </div>
  );
}
