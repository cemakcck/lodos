import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * A non-modal popover: the trigger toggles it, Escape or a press outside closes it, focus moves into the
 * panel on open and back to the trigger on Escape.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  return {
    open,
    close,
    toggle,
    triggerProps: { ref: triggerRef, "aria-expanded": open, "aria-controls": id, onClick: toggle },
    panelProps: { ref: panelRef, id, tabIndex: -1 },
  };
}
