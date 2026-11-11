import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { Shell } from "../Shell";
import { floorKey } from "../floor/cache";
import type { PayMethod } from "../floor/types";
import { loc } from "../kds/lib";
import { EvenSplit } from "./EvenSplit";
import { ItemSplit } from "./ItemSplit";
import { ModeTabs } from "./ModeTabs";
import { PayDialog } from "./PayDialog";
import { closeInFull, payShare, putSplit, splitKey, useCovers, useSplit } from "./queries";
import { ShareCard } from "./ShareCard";
import { MAX_SHARES, MIN_SHARES, type ShareView, type SplitBody, type SplitMode, type SplitView } from "./types";

/** What the pay dialog is for: the whole check (In full) or one share. */
type Paying = { label: string | null; amount: number; error: string | null };

const ALL_MODES: readonly SplitMode[] = ["full", "even", "items"];

/**
 * `/staff/check/:id/close`: the full-screen close view (spec §3.1). Header "Close check · T4" with the total, the mode
 * tabs, the mode's body and the share cards with a progress strip. Every amount is the server's; the split is
 * refetched on live events. When the check closes, a "Check closed" confirmation leads back to the floor.
 */
export function CloseView() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useSplit(id);
  const view = q.data;
  const covers = useCovers(id);
  const [paying, setPaying] = useState<Paying | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [closedShown, setClosedShown] = useState(false);

  // The check closing while this view is open (the last share here, or on another tablet) shows the confirmation.
  const lastStatus = useRef<SplitView["status"] | null>(null);
  useEffect(() => {
    if (!view) return;
    if (lastStatus.current === "open" && view.status === "paid") setClosedShown(true);
    lastStatus.current = view.status;
  }, [view]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: splitKey(id) });
    void qc.invalidateQueries({ queryKey: floorKey });
  };
  const failure = (err: unknown) => {
    setMessage(errorMessage(t, err));
    refresh();
  };

  const split = useMutation({
    mutationFn: (body: SplitBody) => putSplit(id, body),
    onMutate: () => setMessage(null),
    onSuccess: (v) => {
      qc.setQueryData(splitKey(id), v);
      void qc.invalidateQueries({ queryKey: floorKey });
    },
    onError: failure,
  });

  const amountChanged = (err: unknown): number | null => {
    if (!(err instanceof ApiClientError) || err.code !== "amount_changed") return null;
    const amount = (err.details as { amount?: unknown } | undefined)?.amount;
    return typeof amount === "number" ? amount : null;
  };
  const payErr = (err: unknown) => {
    const changed = amountChanged(err);
    setPaying((p) =>
      p && changed !== null
        ? { ...p, amount: changed, error: t("close.pay.changed", { amount: money(changed) }) }
        : p
          ? { ...p, error: errorMessage(t, err) }
          : p,
    );
    refresh();
  };

  const pay = useMutation({
    mutationFn: (v: { label: string; method: PayMethod; amount: number }) => payShare(id, v.label, v.method, v.amount),
    onSuccess: (r) => {
      setPaying(null);
      if (r.closed) setClosedShown(true);
      refresh();
    },
    onError: payErr,
  });

  const full = useMutation({
    mutationFn: (method: PayMethod) => closeInFull(id, method),
    onSuccess: () => {
      setPaying(null);
      refresh();
      void navigate("/staff/floor");
    },
    onError: payErr,
  });

  const units = useMemo(() => new Map((view?.units ?? []).map((u) => [u.ref, u])), [view]);
  const tableName = view?.tableName ?? "";
  const title = t("floor.close.title", { table: tableName });
  const back = (
    <Link to="/staff/floor" className="staff-btn oe-back" aria-label={t("close.back")}>
      <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );

  if (!view) {
    return (
      <Shell leading={back} title={title} clock={false}>
        <div className="cv-empty" aria-busy={!q.isError}>
          {q.isError && (
            <>
              <p>{errorMessage(t, q.error)}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>
                {t("staff.retry")}
              </button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const open = view.status === "open";
  const disabledModes = new Set<SplitMode>(!open ? ALL_MODES : view.locked ? ALL_MODES.filter((m) => m !== view.mode) : []);
  const firstCount = Math.min(MAX_SHARES, Math.max(MIN_SHARES, covers ?? MIN_SHARES));
  const chooseMode = (m: SplitMode) => {
    if (m === "full") split.mutate({ mode: "full" });
    else if (m === "even") split.mutate({ mode: "even", count: firstCount });
    else split.mutate({ mode: "items", count: view.mode === "even" ? view.count : firstCount, assignments: [] });
  };
  const startPay = (share: ShareView | null) => {
    pay.reset();
    full.reset();
    setPaying({ label: share?.label ?? null, amount: share?.amount ?? view.total, error: null });
  };

  const lockedId = "cv-locked";
  const note = !open ? t("close.closed.already") : view.locked ? t("close.modes.locked") : null;
  const progress = view.mode !== "full" && (
    <div className="cv-foot">
      <span className="cv-prog-t" data-testid="progress">
        {t("close.progress", { paid: view.paidCount, of: view.shares.length, left: money(view.left) })}
      </span>
      <span className="cv-prog" aria-hidden="true">
        {view.shares.map((s) => (
          <i key={s.label} className={s.payment ? "is-done" : ""} />
        ))}
      </span>
    </div>
  );

  return (
    <Shell
      leading={back}
      title={title}
      subtitle={covers != null ? t("floor.table.covers", { count: covers }) : undefined}
      toolbar={<ModeTabs mode={view.mode} disabled={disabledModes} describedBy={note ? lockedId : undefined} onChange={chooseMode} />}
      actions={
        <span className="cv-total">
          <span className="staff-label">{t("close.checkTotal")}</span>
          <span className="font-mono" data-testid="check-total">
            {money(view.total)}
          </span>
        </span>
      }
      clock={false}
    >
      <div className="cv-body" lang={lang}>
        {note && (
          <p className="cv-note" id={lockedId}>
            <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
            {note}
          </p>
        )}
        <p className="fl-msg" role="status" aria-live="polite">
          {message}
        </p>
        <div className="cv-split" aria-busy={split.isPending}>
          <section className="cv-left" aria-label={t(`close.modes.${view.mode}`)}>
            {view.mode === "even" ? (
              <EvenSplit view={view} onCount={(count) => split.mutate({ mode: "even", count })} />
            ) : view.mode === "items" ? (
              <ItemSplit view={view} onSend={(body) => split.mutateAsync(body)} />
            ) : (
              <ul className="cv-units is-static">
                {view.units.map((u) => (
                  <li key={u.ref} className={`cv-unit ${u.comp ? "is-comp" : ""}`}>
                    <span className="n">{loc(u.name, lang)}</span>
                    <span className="p font-mono">{money(u.unitAmount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="cv-right" aria-label={t("close.shares")}>
            {view.mode === "full" ? (
              <div className="cv-full">
                <span className="staff-label">{t("close.checkTotal")}</span>
                <span className="cv-full-amt font-mono">{money(view.total)}</span>
                {view.shares[0]?.payment ? (
                  <span className="cv-st is-paid">{t("close.share.paid", { method: t(`floor.close.methodWord.${view.shares[0].payment.method}`) })}</span>
                ) : (
                  <button
                    type="button"
                    className="staff-btn primary"
                    disabled={!open}
                    aria-label={t("close.payAria", { amount: money(view.total) })}
                    onClick={() => startPay(null)}
                  >
                    {t("close.takePayment")}
                  </button>
                )}
              </div>
            ) : (
              <div className="cv-cards">
                {view.shares.map((s) => (
                  <ShareCard key={s.label} view={view} share={s} units={units} onPay={startPay} />
                ))}
              </div>
            )}
            {progress}
          </section>
        </div>
      </div>

      {paying && (
        <PayDialog
          title={paying.label === null ? title : t("close.pay.title", { label: paying.label })}
          amount={paying.amount}
          confirmLabel={paying.label === null ? t("floor.close.confirm") : t("close.takePayment")}
          pendingLabel={paying.label === null ? t("floor.close.closing") : t("close.pay.taking")}
          pending={pay.isPending || full.isPending}
          error={paying.error}
          onCancel={() => setPaying(null)}
          onConfirm={(method) => {
            if (pay.isPending || full.isPending) return;
            if (paying.label === null) full.mutate(method);
            else pay.mutate({ label: paying.label, method, amount: paying.amount });
          }}
        />
      )}
      {closedShown && (
        <Dialog
          title={t("close.closed.title")}
          onClose={() => setClosedShown(false)}
          width={380}
          footer={
            <button type="button" className="staff-btn primary" onClick={() => void navigate("/staff/floor")}>
              {t("close.closed.back")}
            </button>
          }
        >
          <p>{t("close.closed.body", { table: tableName, amount: money(view.total) })}</p>
        </Dialog>
      )}
    </Shell>
  );
}
