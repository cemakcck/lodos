import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { Dialog } from "../Dialog";

export const MIN_COVERS = 1;
export const MAX_COVERS = 20;

export interface SeatDialogProps {
  tableName: string;
  capacity: number;
  /** "seat" opens a check on a free table; "set" fills covers on a QR-opened check. */
  mode: "seat" | "set";
  pending: boolean;
  error: string | null;
  onConfirm: (covers: number) => void;
  onCancel: () => void;
}

const clamp = (n: number) => Math.min(MAX_COVERS, Math.max(MIN_COVERS, n));

/** Covers for a table: a 1–20 stepper starting at the table's capacity. Arrow keys work on the value too. */
export function SeatDialog({ tableName, capacity, mode, pending, error, onConfirm, onCancel }: SeatDialogProps) {
  const { t } = useTranslation();
  const [covers, setCovers] = useState(() => clamp(capacity));
  const confirmRef = useRef<HTMLButtonElement>(null);
  const step = (d: number) => setCovers((c) => clamp(c + d));

  return (
    <Dialog
      title={mode === "seat" ? t("floor.seat.title", { table: tableName }) : t("floor.seat.titleSet", { table: tableName })}
      onClose={onCancel}
      initialFocus={confirmRef}
      width={360}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onCancel}>
            {t("floor.cancel")}
          </button>
          <button ref={confirmRef} type="button" className="staff-btn primary" disabled={pending} onClick={() => onConfirm(covers)}>
            {pending
              ? t("floor.seat.saving")
              : t(mode === "seat" ? "floor.seat.confirm" : "floor.seat.confirmSet", { count: covers })}
          </button>
        </>
      }
    >
      <p className="staff-label mb-2" id="seat-covers-label">{t("floor.seat.covers")}</p>
      <div
        className="fl-stepper"
        role="group"
        aria-labelledby="seat-covers-label"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          }
        }}
      >
        <button type="button" className="fl-step" aria-label={t("floor.seat.fewer")} disabled={covers <= MIN_COVERS} onClick={() => step(-1)}>
          <Minus size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <output className="fl-step-val font-mono" data-testid="covers" aria-live="polite">
          {covers}
        </output>
        <button type="button" className="fl-step" aria-label={t("floor.seat.more")} disabled={covers >= MAX_COVERS} onClick={() => step(1)}>
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className="fl-dialog-note">{covers > capacity ? t("floor.seat.over") : t("floor.seat.capacity", { count: capacity })}</p>
      {error && (
        <p className="staff-notice mt-3" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
