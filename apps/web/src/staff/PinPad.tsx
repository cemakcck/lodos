import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, Delete, Lock } from "lucide-react";

const PIN_MIN = 4;
const PIN_MAX = 6;

interface Props {
  /** Resolves when the PIN was accepted (the caller then moves on); rejects with the error to show. */
  onSubmit: (pin: string) => Promise<void>;
  /** Text for a rejection; `locked` adds the lock icon. */
  describe: (err: unknown) => { text: string; locked: boolean };
  submitLabel: string;
  pendingLabel: string;
}

/** The PIN dots, message line and 3×4 keypad (physical keyboard too). Shared by sign-in and the time clock. */
export function PinPad({ onSubmit, describe, submitLabel, pendingLabel }: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);
  const [pressed, setPressed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = useCallback(
    (p: string) => {
      setPending(true);
      onSubmit(p).catch((e: unknown) => {
        setPending(false);
        setError(e);
        setPin("");
        setShake((n) => n + 1);
      });
    },
    [onSubmit],
  );

  const press = useCallback(
    (key: string) => {
      if (pending) return;
      if (key === "back") return setPin((p) => p.slice(0, -1));
      if (key === "enter") {
        if (pin.length >= PIN_MIN) submit(pin);
        return;
      }
      setError(null);
      setPin((p) => (p.length < PIN_MAX ? p + key : p));
    },
    [pending, pin, submit],
  );

  // Physical keyboard: digits, Backspace and Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      // Enter on a focused control (a pad key reached with Tab, the banner) keeps its native meaning.
      const onControl = !!el?.closest?.("button, a, [role='switch']");
      let key: string | null = null;
      if (/^[0-9]$/.test(e.key)) key = e.key;
      else if (e.key === "Backspace") key = "back";
      else if (e.key === "Enter" && !onControl) key = "enter";
      if (!key) return;
      e.preventDefault();
      setPressed(key);
      press(key);
    };
    const onUp = () => setPressed(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [press]);

  const failure = error ? describe(error) : null;
  const slots = Math.max(PIN_MIN, Math.min(PIN_MAX, pin.length + (pin.length < PIN_MAX ? 1 : 0)));

  const key = (k: string, label: string, content: ReactNode = label, cls = "") => (
    <button
      key={k}
      type="button"
      // Taps don't take focus, so a later Enter on the keyboard still means "sign in".
      onMouseDown={(e) => e.preventDefault()}
      className={`staff-key ${cls} ${pressed === k ? "is-pressed" : ""}`}
      aria-label={label}
      disabled={pending || (k === "enter" && pin.length < PIN_MIN)}
      onClick={() => press(k)}
    >
      {content}
    </button>
  );

  return (
    <>
      <div
        key={shake}
        className={`staff-pin-dots mt-5 flex h-6 items-center justify-center gap-3 ${shake ? "is-shake" : ""}`}
        role="status"
        aria-live="polite"
        aria-label={t("staff.login.entered", { count: pin.length })}
      >
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={`staff-pin-dot ${i < pin.length ? "is-on" : ""}`} aria-hidden="true" />
        ))}
      </div>

      <div className="mt-3 min-h-[38px]">
        {failure && (
          <p role="alert" className="staff-notice">
            {failure.locked && <Lock size={14} strokeWidth={2} className="mt-0.5 flex-none" aria-hidden="true" />}
            {failure.text}
          </p>
        )}
      </div>

      <div role="group" aria-label={t("staff.login.pad")} className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => key(d, d))}
        {key("back", t("staff.login.delete"), <Delete size={20} strokeWidth={1.75} aria-hidden="true" />, "is-util")}
        {key("0", "0")}
        {key(
          "enter",
          submitLabel,
          pending ? pendingLabel : (
            <>
              {submitLabel}
              <CornerDownLeft size={16} strokeWidth={2} aria-hidden="true" />
            </>
          ),
          "is-go",
        )}
      </div>
    </>
  );
}
