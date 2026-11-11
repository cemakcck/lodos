import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { MAX_SHARES, MIN_SHARES, type SplitView } from "./types";

export const EVEN_DEBOUNCE_MS = 300;

export interface EvenSplitProps {
  view: SplitView;
  /** Called once the stepper has rested for 300 ms. */
  onCount: (count: number) => void;
}

/**
 * Evenly's left side: a 2–20 guest stepper. Quick steps are debounced into one `PUT split`; the cards on the right
 * always show the server's amounts. Locked once a share is paid (the count can't change).
 */
export function EvenSplit({ view, onCount }: EvenSplitProps) {
  const { t } = useTranslation();
  const [count, setCount] = useState(view.count);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef(false);
  const send = useRef(onCount);
  useEffect(() => {
    send.current = onCount;
  });
  // Follow the server (another tablet) unless a local change is about to be sent.
  useEffect(() => {
    if (!waiting.current) setCount(view.count);
  }, [view.count]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const locked = view.locked || view.status !== "open";
  const step = (d: number) => {
    const next = Math.min(MAX_SHARES, Math.max(MIN_SHARES, count + d));
    if (next === count) return;
    setCount(next);
    waiting.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      waiting.current = false;
      send.current(next);
    }, EVEN_DEBOUNCE_MS);
  };

  return (
    <div className="cv-even">
      <p className="staff-label" id="cv-guests-label">
        {t("close.even.guests")}
      </p>
      <div className="cv-stepper" role="group" aria-labelledby="cv-guests-label">
        <button type="button" className="staff-btn" aria-label={t("close.even.fewer")} disabled={locked || count <= MIN_SHARES} onClick={() => step(-1)}>
          <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <output className="font-mono" data-testid="guest-count" aria-live="polite">
          {count}
        </output>
        <button type="button" className="staff-btn" aria-label={t("close.even.more")} disabled={locked || count >= MAX_SHARES} onClick={() => step(1)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className="fl-hint">{t("close.even.hint", { min: MIN_SHARES, max: MAX_SHARES })}</p>
    </div>
  );
}
