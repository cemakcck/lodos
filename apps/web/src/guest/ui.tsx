/* Plum Salon building blocks shared by the guest screens. */
import { useEffect, useRef, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Minus, Plus, X } from "lucide-react";
import { setLanguage } from "../i18n";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet dialog. Focus moves inside on open (to `initialFocus` or the first control) and returns to the opener
 * on close; Tab is trapped; Esc and the backdrop close it; the page behind does not scroll.
 */
export function Sheet({
  title, onClose, children, footer, initialFocus,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current!;
    const first = initialFocus?.current ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    first.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hasAttribute("disabled"));
      if (items.length === 0) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
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

  const { t } = useTranslation();
  return createPortal(
    <div className="theme-guest guest-sheet-root fixed inset-0 z-50 flex items-end justify-center" style={{ minHeight: 0, background: "transparent" }}>
      <div className="guest-backdrop absolute inset-0" onClick={() => close.current()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="guest-sheet relative flex max-h-[92dvh] w-full max-w-[480px] flex-col outline-none"
      >
        <div className="flex items-start gap-3 px-5 pt-3">
          <span className="mx-auto mt-0.5 mb-1 block h-1 w-10 rounded-full bg-[#5d3150]" aria-hidden="true" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pb-2">
          <h2 id={titleId} className="font-guest-dish text-[28px] leading-[1.1] font-semibold text-guest-cream">{title}</h2>
          <button type="button" onClick={() => close.current()} aria-label={t("guest.sheet.close")} className="guest-icon-btn -mr-1 shrink-0">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="guest-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-[#3a1630] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A photo in an arched (mirror-shaped) frame. */
export function ArchPhoto({ src, size = 72, dim = false, className = "" }: { src?: string | null; size?: number; dim?: boolean; className?: string }) {
  return (
    <span className={`guest-arch ${dim ? "guest-arch-dim" : ""} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {src && <img src={src} alt="" loading="lazy" decoding="async" />}
    </span>
  );
}

export function LeopardBand({ height = 10, className = "" }: { height?: number; className?: string }) {
  return <div className={`leopard guest-leopard ${className}`} style={{ height }} aria-hidden="true" />;
}

export function LangToggle({ className = "" }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "tr" ? "tr" : "en";
  return (
    <div role="group" aria-label={t("guest.nav.language")} className={`guest-lang ${className}`}>
      {(["en", "tr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => void setLanguage(l)}
        >
          {/* The visible code starts the accessible name ("EN, English"), so speech users can say what they see. */}
          {l.toUpperCase()}
          <span className="sr-only">, {t(`lang.${l}`)}</span>
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value, onChange, min = 1, max = 20, decLabel, incLabel, valueLabel, size = "md",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  decLabel: string;
  incLabel: string;
  valueLabel: string;
  size?: "sm" | "md";
}) {
  const s = size === "sm" ? 28 : 36;
  return (
    <div className="guest-stepper" role="group" aria-label={valueLabel}>
      <button type="button" aria-label={decLabel} disabled={value <= min} onClick={() => onChange(value - 1)} style={{ width: s, height: s }}>
        <Minus size={size === "sm" ? 14 : 16} aria-hidden="true" />
      </button>
      <output aria-live="polite" className={size === "sm" ? "w-6 text-[13px]" : "w-8 text-[15px]"}>{value}</output>
      <button type="button" aria-label={incLabel} disabled={value >= max} onClick={() => onChange(value + 1)} style={{ width: s, height: s }}>
        <Plus size={size === "sm" ? 14 : 16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A small diamond-and-rule ornament, used above section titles. */
export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="120" height="10" viewBox="0 0 120 10" aria-hidden="true">
      <path d="M0 5h50M70 5h50" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <path d="M60 1l4 4-4 4-4-4z" fill="currentColor" />
    </svg>
  );
}

/** Shared SVG symbols (chairs, mirror sheen) used by the hero and the farewell screen. Render once per page. */
export function SalonDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="lodos-chair-tolix" viewBox="0 0 60 90">
          <path d="M14 6h32l-2 34H16z" fill="currentColor" opacity=".92" />
          <path d="M19 12h22M19 18h22" stroke="#000" strokeOpacity=".25" strokeWidth="1.5" />
          <rect x="10" y="40" width="40" height="6" rx="1.5" fill="currentColor" />
          <path d="M12 46l-5 42M48 46l5 42M18 46l-2 40M42 46l2 40" stroke="currentColor" strokeWidth="3" fill="none" />
          <path d="M9 72h42" stroke="currentColor" strokeWidth="2" />
        </symbol>
        <symbol id="lodos-chair-bentwood" viewBox="0 0 60 90">
          <path d="M16 44C10 20 16 4 30 4s20 16 14 40" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M22 40c-2-14 2-26 8-26s10 12 8 26" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <ellipse cx="30" cy="46" rx="20" ry="5" fill="currentColor" />
          <path d="M14 48l-4 40M46 48l4 40M24 50l-1 36M36 50l1 36" stroke="currentColor" strokeWidth="3" />
          <ellipse cx="30" cy="70" rx="16" ry="3" fill="none" stroke="currentColor" strokeWidth="2" />
        </symbol>
        <linearGradient id="lodos-mirror" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".07" />
          <stop offset=".6" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity=".02" />
        </linearGradient>
        <linearGradient id="lodos-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6c793" />
          <stop offset=".5" stopColor="#c9a46a" />
          <stop offset="1" stopColor="#8a6a3c" />
        </linearGradient>
        <radialGradient id="lodos-sconce" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#f3d9a4" stopOpacity=".35" />
          <stop offset="1" stopColor="#f3d9a4" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** The brass-edged arched mirror with chairs: the room, drawn. `children` sits over the mirror (the wordmark). */
export function MirrorScene({ height = 300, children }: { height?: number; children?: ReactNode }) {
  return (
    <div className="guest-hero relative overflow-hidden" style={{ height }}>
      <svg viewBox="0 0 390 300" preserveAspectRatio="xMidYMax meet" width="100%" height="100%" className="absolute inset-0" aria-hidden="true">
        <circle cx="195" cy="70" r="150" fill="url(#lodos-sconce)" />
        <path d="M0 236h390" stroke="#c9a46a" strokeOpacity=".14" />
        <path d="M0 241h390" stroke="#c9a46a" strokeOpacity=".08" />
        <path d="M105 288V130a90 90 0 0 1 180 0v158z" fill="#1a0b15" stroke="url(#lodos-brass)" strokeWidth="3" />
        <path d="M114 288V130a81 81 0 0 1 162 0v158z" fill="none" stroke="#c9a46a" strokeOpacity=".45" strokeWidth="1" />
        <path d="M114 288V130a81 81 0 0 1 162 0v158z" fill="url(#lodos-mirror)" />
        <path d="M132 138c4-36 26-60 58-66" stroke="#fff" strokeOpacity=".14" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="195" cy="34" r="4" fill="url(#lodos-brass)" />
        <ellipse cx="195" cy="294" rx="170" ry="13" fill="#c8102e" opacity=".32" />
      </svg>
      <svg className="absolute bottom-[10px] left-[4%] text-guest-black" width="60" height="90" aria-hidden="true">
        <use href="#lodos-chair-tolix" />
      </svg>
      <svg className="absolute right-[4%] bottom-[10px] text-guest-red" width="60" height="90" aria-hidden="true">
        <use href="#lodos-chair-bentwood" />
      </svg>
      {children}
    </div>
  );
}
