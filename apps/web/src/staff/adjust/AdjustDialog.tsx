import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { COMP_REASONS, VOID_REASONS, type AdjustmentKind } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { useDemo } from "../../demo/useDemo";
import { Dialog } from "../Dialog";
import { loc } from "../kds/lib";
import type { CheckLine } from "../floor/types";
import { ApproverPad, PIN_MIN, type Approver } from "./ApproverPad";

export const NOTE_MAX = 140;

export interface AdjustDialogProps {
  checkId: string;
  tableName: string;
  line: CheckLine;
  /** A manager confirms with one tap; anyone else needs a manager's PIN. */
  isManager: boolean;
  initialKind?: AdjustmentKind;
  onDone: (kind: AdjustmentKind) => void;
  onCancel: () => void;
}

/** True when the kitchen has made the line, so only a comp makes sense. */
export const isMade = (l: Pick<CheckLine, "status">) => l.status === "ready" || l.status === "served";
export const freeUnits = (l: Pick<CheckLine, "qty" | "compedQty" | "voidedQty">) => l.qty - l.compedQty - l.voidedQty;

/**
 * Comp (made, on the house) or void (a mistake, never made) some units of a line: kind, quantity, reason, then the
 * approval, a plain Confirm for a manager or a manager's PIN for anyone else.
 */
export function AdjustDialog({ checkId, tableName, line, isManager, initialKind = "comp", onDone, onCancel }: AdjustDialogProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const demo = useDemo();
  const made = isMade(line);
  const free = Math.max(1, freeUnits(line));
  const [kind, setKind] = useState<AdjustmentKind>(made ? "comp" : initialKind);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kindRadios = useRef<Record<string, HTMLButtonElement | null>>({});

  const approvers = useQuery({ queryKey: ["approvers"], queryFn: () => api<Approver[]>("/api/approvers"), enabled: !isManager, staleTime: 60_000 });
  const list = approvers.data ?? [];
  const managerId = picked ?? (list.length === 1 ? list[0]!.id : null);

  const reasons: readonly string[] = kind === "comp" ? COMP_REASONS : VOID_REASONS;
  const kinds: AdjustmentKind[] = made ? ["comp"] : ["comp", "void"];
  const noteOk = reason !== "other" || note.trim().length > 0;
  const ready = reason !== null && noteOk && (isManager || (managerId !== null && pin.length >= PIN_MIN));

  const save = useMutation({
    mutationFn: () =>
      api(`/api/checks/${checkId}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          lineRef: line.lineRef,
          kind,
          qty,
          reason,
          ...(reason === "other" ? { note: note.trim() } : {}),
          ...(isManager ? {} : { approval: { managerId, pin } }),
        }),
      }),
    onSuccess: () => onDone(kind),
    onError: (err) => {
      if (err instanceof ApiClientError && err.status === 401) {
        setError(t("adjust.wrongPin"));
        setPin("");
      } else if (err instanceof ApiClientError && [403, 409, 429].includes(err.status) && err.message) {
        setError(err.message);
        setPin("");
      } else setError(errorMessage(t, err));
    },
  });

  const pickKind = (k: AdjustmentKind) => {
    if (k !== kind) setReason(null);
    setKind(k);
    setError(null);
    kindRadios.current[k]?.focus();
  };
  const submit = () => {
    if (!ready || save.isPending) return;
    setError(null);
    save.mutate();
  };
  const confirmLabel = isManager ? t("adjust.confirm") : t(kind === "comp" ? "adjust.approveComp" : "adjust.approveVoid");

  return (
    <Dialog
      title={t("adjust.title", { item: loc(line.name, lang), table: tableName })}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onCancel}>
            {t("floor.cancel")}
          </button>
          <button type="button" className="staff-btn primary" disabled={!ready || save.isPending} onClick={submit}>
            {save.isPending ? t("adjust.working") : confirmLabel}
          </button>
        </>
      }
    >
      <p className="staff-label mb-2" id="ad-kind-label">
        {t("adjust.kind.label")}
      </p>
      <div className="ad-kinds" role="radiogroup" aria-labelledby="ad-kind-label">
        {kinds.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              kindRadios.current[k] = el;
            }}
            type="button"
            role="radio"
            aria-checked={kind === k}
            tabIndex={kind === k ? 0 : -1}
            className="ad-kind"
            onClick={() => pickKind(k)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key) && kinds.length > 1) {
                e.preventDefault();
                pickKind(kinds[(i + 1) % kinds.length]!);
              }
            }}
          >
            <b>{t(`adjust.kind.${k}`)}</b>
            <span>{t(`adjust.kind.${k}Hint`)}</span>
          </button>
        ))}
      </div>
      {made && <p className="fl-dialog-note">{t("adjust.menu.madeNote")}</p>}

      <div className="ad-qty-row">
        <span className="staff-label" id="ad-qty-label">
          {t("adjust.qty.label")}
        </span>
        <div className="ad-qty" role="group" aria-labelledby="ad-qty-label">
          <button type="button" className="ad-step" aria-label={t("adjust.qty.less")} disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <output className="ad-qty-val font-mono" data-testid="adjust-qty">
            {qty}
          </output>
          <button type="button" className="ad-step" aria-label={t("adjust.qty.more")} disabled={qty >= free} onClick={() => setQty((q) => Math.min(free, q + 1))}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <span className="ad-qty-of">{t("adjust.qty.of", { count: free })}</span>
        <span className="staff-grow" />
        <span className="font-mono ad-amt">{money(Math.round((line.originalTotal / line.qty) * qty))}</span>
      </div>

      <p className="staff-label mt-4 mb-2" id="ad-reason-label">
        {t("adjust.reason")}
      </p>
      <ReasonChips labelledBy="ad-reason-label" reasons={reasons} value={reason} onChange={setReason} />
      {reason === "other" && (
        <label className="ad-note">
          <span className="staff-label">{t("adjust.note")}</span>
          <input
            className="ad-note-in"
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            placeholder={t("adjust.notePlaceholder")}
            aria-required="true"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <span className="ad-note-count">
            {note.length}/{NOTE_MAX}
          </span>
        </label>
      )}

      {!isManager && (
        <div className="ad-approval-wrap">
          <ApproverPad
            approvers={list}
            managerId={managerId}
            onManager={(id) => {
              setPicked(id);
              setError(null);
            }}
            pin={pin}
            onPin={(p) => {
              setPin(p);
              setError(null);
            }}
            demo={demo.isDemo === true}
          />
        </div>
      )}
      {error && (
        <p className="staff-notice mt-3" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function ReasonChips({ labelledBy, reasons, value, onChange }: { labelledBy: string; reasons: readonly string[]; value: string | null; onChange: (r: string) => void }) {
  const { t } = useTranslation();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const go = (i: number, d: number) => {
    const r = reasons[(i + d + reasons.length) % reasons.length]!;
    onChange(r);
    refs.current[r]?.focus();
  };
  return (
    <div className="ad-chips" role="radiogroup" aria-labelledby={labelledBy}>
      {reasons.map((r, i) => (
        <button
          key={r}
          ref={(el) => {
            refs.current[r] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === r}
          tabIndex={value === r || (value === null && i === 0) ? 0 : -1}
          className="ad-chip"
          onClick={() => onChange(r)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              go(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              go(i, -1);
            }
          }}
        >
          {t(`adjust.reasons.${r}`)}
        </button>
      ))}
    </div>
  );
}
