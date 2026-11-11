import { useId, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Delete } from "lucide-react";

export const PIN_MAX = 6;
export const PIN_MIN = 4;
export interface Approver {
  id: string;
  name: string;
}

export interface ApproverPadProps {
  approvers: Approver[];
  /** The manager list's query: while loading or after a failure, say so (with a retry) instead of "no manager". */
  status: "pending" | "error" | "success";
  onRetry: () => void;
  managerId: string | null;
  onManager: (id: string) => void;
  pin: string;
  onPin: (pin: string) => void;
  /** Show "Demo: Selin's PIN is 9999". */
  demo: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * Manager approval on another person's tablet: manager name tiles (a radio group), then a 10-key pad. The digits are
 * never shown, only dots; a polite status says how many were entered.
 */
export function ApproverPad({ approvers, status, onRetry, managerId, onManager, pin, onPin, demo }: ApproverPadProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const add = (d: string) => pin.length < PIN_MAX && onPin(pin + d);
  const back = () => onPin(pin.slice(0, -1));
  const onKey = (e: KeyboardEvent) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      add(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      back();
    }
  };
  const move = (i: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = approvers[(i + dir + approvers.length) % approvers.length]!;
    onManager(next.id);
    (e.currentTarget.parentElement?.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  const dots = Math.max(PIN_MIN, pin.length);

  return (
    <div className="ad-approval" onKeyDown={onKey}>
      <p className="staff-label mb-2" id={labelId}>
        {t("adjust.approval")}
      </p>
      {status === "pending" ? (
        <p className="fl-dialog-note" role="status">
          {t("adjust.approversLoading")}
        </p>
      ) : status === "error" ? (
        <div className="fl-dialog-note" role="alert">
          <p>{t("adjust.approversError")}</p>
          <button type="button" className="staff-btn" onClick={onRetry}>
            {t("staff.retry")}
          </button>
        </div>
      ) : approvers.length === 0 ? (
        <p className="fl-dialog-note">{t("adjust.noApprovers")}</p>
      ) : (
        <div className="ad-who" role="radiogroup" aria-labelledby={labelId}>
          {approvers.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              data-id={a.id}
              aria-checked={managerId === a.id}
              tabIndex={managerId === a.id || (managerId === null && i === 0) ? 0 : -1}
              className="ad-tile"
              onClick={() => onManager(a.id)}
              onKeyDown={(e) => move(i, e)}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
      <div className="ad-pinrow">
        <span className="staff-label">{t("adjust.pin.label")}</span>
        <span className="ad-dots" aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => (
            <i key={i} className={i < pin.length ? "f" : ""} />
          ))}
        </span>
        <span className="sr-only" role="status">
          {t("adjust.pin.entered", { count: pin.length })}
        </span>
      </div>
      <div className="ad-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className="ad-key font-mono" onClick={() => add(k)}>
            {k}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className="ad-key font-mono" onClick={() => add("0")}>
          0
        </button>
        <button type="button" className="ad-key" aria-label={t("adjust.pin.delete")} disabled={pin.length === 0} onClick={back}>
          <Delete size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {demo && <p className="fl-dialog-note ad-demo">{t("adjust.demoHint")}</p>}
    </div>
  );
}
