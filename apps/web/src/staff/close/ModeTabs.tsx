import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SplitMode } from "./types";

const MODES: readonly SplitMode[] = ["full", "even", "items"];

export interface ModeTabsProps {
  mode: SplitMode;
  /** Modes that can't be chosen now (a share is paid, or the check is closed). */
  disabled: ReadonlySet<SplitMode>;
  /** Id of the text that explains why modes are disabled. */
  describedBy?: string;
  onChange: (mode: SplitMode) => void;
}

/**
 * "In full / Evenly / By item" as a radiogroup: one tab stop, arrow keys move and choose. A disabled mode is skipped by
 * the arrows, does nothing on a tap and is announced as `aria-disabled`, with the reason linked by `aria-describedby`.
 */
export function ModeTabs({ mode, disabled, describedBy, onChange }: ModeTabsProps) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<SplitMode, HTMLButtonElement | null>>>({});
  const choose = (m: SplitMode) => {
    if (disabled.has(m) || m === mode) return;
    onChange(m);
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    for (let k = 1; k < MODES.length; k++) {
      const next = MODES[(i + step * k + MODES.length * 2) % MODES.length]!;
      if (!disabled.has(next)) {
        refs.current[next]?.focus();
        choose(next);
        return;
      }
    }
  };

  return (
    <div className="staff-seg cv-modes" role="radiogroup" aria-label={t("close.modes.label")} aria-describedby={describedBy}>
      {MODES.map((m, i) => {
        const off = disabled.has(m);
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[m] = el;
            }}
            type="button"
            role="radio"
            aria-checked={mode === m}
            aria-disabled={off || undefined}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => choose(m)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t(`close.modes.${m}`)}
          </button>
        );
      })}
    </div>
  );
}
