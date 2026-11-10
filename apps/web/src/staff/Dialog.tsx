import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The button row. */
  footer?: ReactNode;
  /** Focus this on open instead of the first control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Pixel width; default 400. */
  width?: number;
}

/**
 * The staff modal: centred panel on a dim backdrop. Focus moves in on open and returns to the opener on close,
 * Tab is trapped, Escape and the backdrop close it, and the page behind does not scroll.
 */
export function Dialog({ title, onClose, children, footer, initialFocus, width = 400 }: DialogProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current!;
    (initialFocus?.current ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === a || !inside)) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !inside)) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  return createPortal(
    <div className="theme-staff staff-dialog-root">
      <div className="staff-backdrop" onClick={() => close.current()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="staff-dialog"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <div className="staff-dialog-h">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="staff-icon-btn" onClick={() => close.current()} aria-label={t("floor.cancel")}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="staff-dialog-b">{children}</div>
        {footer && <div className="staff-dialog-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
