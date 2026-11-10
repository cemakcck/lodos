import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import { setAvailability, useManagerMenu } from "./queries";
import { managerMenuKey, type Availability as AvailabilityState } from "./types";

type Body = { soldOut?: boolean; remaining?: number | null };
type Result = { itemId: string; serviceDay: string; soldOut: boolean; remaining: number | null };

const MAX_LEFT = 999;

/** What the server will answer for `body` (AvailabilityInput rules), so the switch and number move at once. */
export function predictAvailability(prev: AvailabilityState, body: Body): AvailabilityState {
  if (body.soldOut === true && body.remaining === undefined) return { soldOut: true, remaining: prev.remaining };
  if (body.soldOut === false && body.remaining === undefined) return { soldOut: false, remaining: null };
  const remaining = body.remaining === undefined ? prev.remaining : body.remaining;
  return { soldOut: remaining === 0 ? true : (body.soldOut ?? prev.soldOut), remaining };
}

/** The body for a typed "N left": a number on a sold-out item brings it back; empty clears the limit. */
export function leftBody(n: number | null, soldOut: boolean): Body {
  if (n === null) return { remaining: null };
  if (soldOut && n > 0) return { soldOut: false, remaining: n };
  return { remaining: n };
}

/**
 * The 86 switch and the "N left" number for one item, reading the cached manager menu. Both update the cache
 * at once and roll this item back if the server refuses; the number commits on Enter or blur, Escape reverts.
 */
export function Availability({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const item = useManagerMenu().data?.items.find((i) => i.id === itemId);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const errId = useId();
  const name = item ? loc(item.name, lang) : "";

  const m = useMutation({
    mutationFn: (body: Body) =>
      api<Result>(`/api/manager/availability/${itemId}`, { method: "POST", body: JSON.stringify(body) }),
    onMutate: async (body) => {
      setError(null);
      await qc.cancelQueries({ queryKey: managerMenuKey });
      const prev = item?.availability;
      if (prev) setAvailability(qc, itemId, predictAvailability(prev, body));
      return { prev };
    },
    onError: (err, _b, ctx) => {
      if (ctx?.prev) setAvailability(qc, itemId, ctx.prev);
      setError(`${t("manager.avail.failed", { name })} ${errorMessage(t, err)}`);
    },
    onSuccess: (r) => setAvailability(qc, itemId, r),
    onSettled: () => qc.invalidateQueries({ queryKey: managerMenuKey }),
  });

  if (!item) return null;
  const { soldOut, remaining } = item.availability;
  const shown = draft ?? (remaining === null ? "" : String(remaining));

  const commit = () => {
    if (draft === null) return;
    const s = draft.trim();
    setDraft(null);
    const n = s === "" ? null : Number(s);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > MAX_LEFT)) return;
    if (n === remaining && !(soldOut && n !== null && n > 0)) return;
    m.mutate(leftBody(n, soldOut));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape" && draft !== null) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
    }
  };

  return (
    <div className="mg-avail">
      <button
        type="button"
        role="switch"
        aria-checked={soldOut}
        aria-label={t("manager.avail.switch", { name })}
        className="mg-switch"
        onClick={() => m.mutate({ soldOut: !soldOut })}
      >
        <span className="track" aria-hidden="true">
          <span className="thumb" />
        </span>
        <span className="state">{soldOut ? t("manager.avail.on") : t("manager.avail.off")}</span>
      </button>
      <label className="mg-left">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_LEFT}
          step={1}
          value={shown}
          placeholder="–"
          aria-label={t("manager.avail.left", { name })}
          aria-describedby={error ? `${hintId} ${errId}` : hintId}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
        <span aria-hidden="true">{t("manager.avail.leftShort")}</span>
      </label>
      <span id={hintId} className="sr-only">{t("manager.avail.leftHint")}</span>
      {error && (
        <p id={errId} role="alert" className="mg-avail-err">
          {error}
        </p>
      )}
    </div>
  );
}
