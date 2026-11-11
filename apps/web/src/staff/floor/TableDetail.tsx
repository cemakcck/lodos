import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Ban, Gift, Plus, Printer, Receipt, ReceiptText, UserPlus, Users, type LucideIcon } from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { initials, useMe } from "../auth";
import { AdjustDialog, freeUnits, isMade } from "../adjust/AdjustDialog";
import { loc } from "../kds/lib";
import { SeatDialog } from "./SeatDialog";
import { checkKey, floorKey, patchFloorTable, snapshotCaches, syncFloorFromCheck } from "./cache";
import { checkState, hm, readyTickets, since } from "./lib";
import type { AdjustmentKind } from "@lodos/shared";
import type { CheckLine, FloorTable, LineAdjustment, TableCheck } from "./types";

type OpenCheck = Extract<TableCheck, { check: object }>;

interface Action {
  key: string;
  label: string;
  /** Full accessible name when the visible label is shortened. */
  aria?: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** A link instead of a button (Print check). */
  to?: string;
  disabled?: boolean;
  primary?: boolean;
  wide?: boolean;
}

export interface SeatRequest {
  /** Changes on every request, so the same request twice opens the dialog twice. */
  id: number;
  /** After seating, go straight to order entry ("+ New order" on a free table). */
  thenOrder: boolean;
}

export interface TableDetailProps {
  tableId: string;
  /** Server time from the floor snapshot (never the device clock). */
  now: Date;
  /** The floor's view of the table: name and capacity before the check loads. */
  table?: FloorTable;
  /** Ask the panel to open the covers dialog (the floor's "+ New order" on a free table). */
  seatRequest?: SeatRequest | null;
}

type DialogState =
  | null
  | { kind: "seat"; mode: "seat" | "set"; thenOrder: boolean }
  | { kind: "adjust"; line: CheckLine; adjust: AdjustmentKind };

const MESSAGE_MS = 4000;

/**
 * The floor's right panel for one table: name, status pill and server initials; covers, seated time and check;
 * the open check as Food and Drinks with line status and price, subtotals and the total; and the actions:
 * Seat table (free), or Answer call, Mark picked up (one per ready ticket), Set covers, Add items, Print check and
 * Close check (which opens the close view). Mark picked up and Answer call are optimistic and roll back on error.
 */
export function TableDetail({ tableId, now, table, seatRequest }: TableDetailProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: checkKey(tableId), queryFn: () => api<TableCheck>(`/api/tables/${tableId}/check`) });
  const data = q.data;
  const isManager = useMe().data?.role === "manager";
  const [menuRef, setMenuRef] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  };

  const name = data?.table.name ?? table?.name ?? "";
  const capacity = data?.table.capacity ?? table?.capacity ?? 2;

  // "+ New order" on a free table: the floor asks for the covers dialog first.
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!seatRequest || seatRequest.id === lastRequest.current) return;
    lastRequest.current = seatRequest.id;
    setDialogError(null);
    setDialog({ kind: "seat", mode: "seat", thenOrder: seatRequest.thenOrder });
  }, [seatRequest]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: checkKey(tableId) });
    void qc.invalidateQueries({ queryKey: floorKey });
  };
  const failure = (err: unknown) =>
    err instanceof ApiClientError && err.status === 409 ? t("floor.detail.conflict") : errorMessage(t, err);

  // ---- Seat / set covers ----------------------------------------------------------------------------------------
  const seat = useMutation({
    mutationFn: (v: { covers: number; thenOrder: boolean }) =>
      api<{ checkId: string; covers: number }>(`/api/tables/${tableId}/seat`, { method: "POST", body: JSON.stringify({ covers: v.covers }) }),
    onSuccess: (r, v) => {
      patchFloorTable(qc, tableId, (tb) => ({
        ...tb,
        state: tb.state === "free" ? "seated" : tb.state,
        covers: r.covers,
        checkId: r.checkId,
        seatedAt: tb.seatedAt ?? now.toISOString(),
      }));
      setDialog(null);
      refresh();
      if (v.thenOrder) void navigate(`/staff/order/${tableId}`);
    },
    onError: (err) => {
      setDialogError(err instanceof ApiClientError && err.status === 409 ? t("floor.seat.taken") : errorMessage(t, err));
      refresh();
    },
  });

  // ---- Mark picked up (optimistic) ------------------------------------------------------------------------------
  const served = useMutation({
    mutationFn: (ticketId: string) => api(`/api/tickets/${ticketId}/served`, { method: "POST" }),
    onMutate: async (ticketId) => {
      await qc.cancelQueries({ queryKey: checkKey(tableId) });
      const rollback = snapshotCaches(qc, tableId);
      const mark = (ls: CheckLine[]) => ls.map((l) => (l.ticketId === ticketId && l.status === "ready" ? { ...l, status: "served" as const } : l));
      const next = qc.setQueryData<TableCheck>(checkKey(tableId), (d) =>
        d && d.check ? { ...d, food: mark(d.food), drinks: mark(d.drinks) } : d,
      );
      if (next) syncFloorFromCheck(qc, tableId, next);
      return { rollback };
    },
    onError: (err, _id, ctx) => {
      ctx?.rollback();
      flash(failure(err));
    },
    onSettled: refresh,
  });

  // ---- Undo a comp or void (managers) ---------------------------------------------------------------------------
  const undo = useMutation({
    mutationFn: (v: { checkId: string; adjustmentId: string }) =>
      api(`/api/checks/${v.checkId}/adjustments/${v.adjustmentId}`, { method: "DELETE" }),
    onError: (err) => flash(err instanceof ApiClientError && err.message ? err.message : t("adjust.undoFailed")),
    onSettled: refresh,
  });

  // ---- Answer call (optimistic): every open call at the table ----------------------------------------------------
  const answer = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api(`/api/calls/${id}/answer`, { method: "POST" }))),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: checkKey(tableId) });
      const rollback = snapshotCaches(qc, tableId);
      const next = qc.setQueryData<TableCheck>(checkKey(tableId), (d) => (d ? { ...d, calls: [] } : d));
      if (next) syncFloorFromCheck(qc, tableId, next);
      return { rollback };
    },
    onError: (err, _ids, ctx) => {
      ctx?.rollback();
      flash(failure(err));
    },
    onSettled: refresh,
  });

  const openDialog = (d: DialogState) => {
    setDialogError(null);
    setDialog(d);
  };

  // ---- Render ---------------------------------------------------------------------------------------------------
  const status = (
    <p className="fl-msg" role="status" aria-live="polite">
      {message}
    </p>
  );

  if (!data) {
    return (
      <section className="fl-det" aria-label={t("floor.detail.label", { table: name })} aria-busy={!q.isError}>
        <div className="fl-det-h">
          <h2 className="big">{name}</h2>
        </div>
        {q.isError && (
          <div className="fl-empty">
            <p>{t("floor.detail.loadError")}</p>
            <button type="button" className="staff-btn" onClick={() => void q.refetch()}>
              {t("staff.retry")}
            </button>
          </div>
        )}
        {status}
      </section>
    );
  }

  const state = checkState(data);
  const open: OpenCheck | null = data.check ? (data as OpenCheck) : null;
  const seatedMs = open ? since(open.check.openedAt, now) : 0;
  const lines = open ? [...open.food, ...open.drinks] : [];
  const ready = readyTickets(lines);

  // Actions: urgent ones first and full width; then one primary; the rest in two columns.
  const actions: Action[] = [];
  if (!open) {
    actions.push({ key: "seat", label: t("floor.detail.actions.seat"), icon: UserPlus, onClick: () => openDialog({ kind: "seat", mode: "seat", thenOrder: false }), wide: true });
  } else {
    const urgent: Action[] = [];
    if (data.calls.length > 0) {
      urgent.push({ key: "answer", label: t("floor.detail.actions.answer"), icon: Bell, onClick: () => answer.mutate(data.calls.map((c) => c.id)), disabled: answer.isPending });
    }
    for (const rt of ready) {
      const names = rt.lines.map((l) => loc(l.name, lang));
      const more = names.length > 1 ? ` +${names.length - 1}` : "";
      urgent.push({
        key: `served-${rt.ticketId}`,
        label: ready.length > 1 ? `${t("floor.detail.actions.pickedUp")} · ${names[0]}${more}` : t("floor.detail.actions.pickedUp"),
        aria: t("floor.detail.actions.pickedUpAria", { items: names.join(", ") }),
        icon: Check,
        onClick: () => served.mutate(rt.ticketId),
      });
    }
    if (open.check.covers === null) {
      urgent.push({ key: "covers", label: t("floor.detail.actions.setCovers"), icon: Users, onClick: () => openDialog({ kind: "seat", mode: "set", thenOrder: false }) });
    }
    for (const u of urgent) u.wide = true;
    const add: Action = { key: "add", label: t("floor.detail.actions.addItems"), icon: Plus, onClick: () => void navigate(`/staff/order/${tableId}`) };
    const print: Action = { key: "print", label: t("floor.detail.actions.print"), icon: Printer, to: `/staff/check/${open.check.id}/print` };
    // The close view: In full, Evenly or By item (spec §3.1).
    const closeA: Action = { key: "close", label: t("floor.detail.actions.close"), icon: Receipt, onClick: () => void navigate(`/staff/check/${open.check.id}/close`) };
    // The primary: the first urgent action, else Close when the bill is asked for, else Add items.
    if (urgent.length > 0) actions.push(...urgent, add, print, closeA);
    else if (state === "bill") actions.push({ ...closeA, wide: true }, add, print);
    else actions.push({ ...add, wide: true }, print, closeA);
  }
  if (actions[0]) actions[0].primary = true;
  // An odd one out at the end spans both columns.
  const halves = actions.filter((a) => !a.wide);
  if (halves.length % 2 === 1) halves[halves.length - 1]!.wide = true;

  // "1m", "12m", then "1h 05m": a waiting time reads without a leading zero.
  const waited = (iso: string) => {
    const ms = since(iso, now);
    const m = Math.floor(ms / 60_000);
    if (m < 1) return t("floor.time.underMinute");
    return m < 60 ? t("floor.time.min", { count: m }) : hm(ms, lang);
  };
  const serverName = open?.check.serverName ?? null;
  const call = data.calls[0];

  return (
    <section className="fl-det" aria-label={t("floor.detail.label", { table: name })}>
      <div className="fl-det-h">
        <div className="r1">
          <h2 className="big">{name}</h2>
          <span className={`fl-pill is-${state}`}>{t(`floor.state.label.${state}`)}</span>
          <span className="staff-grow" />
          {serverName && (
            <span className="staff-avatar fl-det-av" role="img" aria-label={t("floor.detail.server", { name: serverName })} title={serverName}>
              {initials(serverName)}
            </span>
          )}
        </div>
        {call && (
          <p className="fl-flag is-calling">
            <Bell size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("floor.detail.calling", { time: waited(call.openedAt) })}
            {call.reason && <span> · {t(`floor.detail.reasons.${call.reason}`, { defaultValue: call.reason })}</span>}
          </p>
        )}
        {open?.check.billRequestedAt && (
          <p className="fl-flag is-bill">
            <ReceiptText size={14} strokeWidth={1.75} aria-hidden="true" />
            {open.check.billMethod
              ? t("floor.detail.billAskedBy", { time: waited(open.check.billRequestedAt), method: t(`floor.close.methodWord.${open.check.billMethod}`) })
              : t("floor.detail.billAsked", { time: waited(open.check.billRequestedAt) })}
          </p>
        )}
        <dl className="fl-kv">
          {open ? (
            <>
              <div data-testid="kv-covers">
                <dt>{t("floor.detail.kv.covers")}</dt>
                <dd>{open.check.covers ?? "–"}</dd>
              </div>
              <div data-testid="kv-seated">
                <dt>{t("floor.detail.kv.seated")}</dt>
                <dd className="font-mono">{hm(seatedMs, lang)}</dd>
              </div>
              <div data-testid="kv-check">
                <dt>{t("floor.detail.kv.check")}</dt>
                <dd className="font-mono">{money(open.totals.total)}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>{t("floor.detail.kv.seats")}</dt>
                <dd>{capacity}</dd>
              </div>
              <div>
                <dt>{t("floor.detail.kv.seated")}</dt>
                <dd>–</dd>
              </div>
              <div>
                <dt>{t("floor.detail.kv.check")}</dt>
                <dd>–</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {/* It scrolls on a long check, so it takes keyboard focus to be scrollable without a mouse (WCAG 2.1.1). */}
      <div className="fl-det-body" tabIndex={0} role="group" aria-label={t("floor.detail.lines", { table: name })}>
        {!open ? (
          <p className="fl-hint">{t("floor.detail.freeHint", { table: name })}</p>
        ) : lines.length === 0 ? (
          <p className="fl-hint">{t("floor.detail.noLines")}</p>
        ) : (
          <>
            {[
              { label: t("floor.detail.food"), ls: open.food, subtotal: open.totals.food },
              { label: t("floor.detail.drinks"), ls: open.drinks, subtotal: open.totals.drinks },
            ].map((g) => (
              <LineGroup
                key={g.label}
                label={g.label}
                lines={g.ls}
                subtotal={g.subtotal}
                openRef={menuRef}
                onToggle={(ref) => setMenuRef((r) => (r === ref ? null : ref))}
                onAdjust={(line, adjust) => {
                  setMenuRef(null);
                  openDialog({ kind: "adjust", line, adjust });
                }}
                canUndo={isManager}
                onUndo={(adjustmentId) => undo.mutate({ checkId: open.check.id, adjustmentId })}
                undoing={undo.isPending}
              />
            ))}
          </>
        )}
      </div>

      {open && (
        <div className="fl-total" data-testid="total">
          <span>{t("floor.detail.total")}</span>
          <span className="font-mono">{money(open.totals.total)}</span>
        </div>
      )}
      {status}
      <div className="fl-det-f">
        {actions.map(({ key, label, aria, icon: Icon, onClick, to, disabled, primary, wide }) => {
          const cls = `staff-btn ${primary ? "primary" : ""} ${wide ? "is-wide" : ""}`;
          const inner = (
            <>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </>
          );
          return to ? (
            <Link key={key} className={cls} to={to} aria-label={aria}>
              {inner}
            </Link>
          ) : (
            <button key={key} type="button" className={cls} aria-label={aria} disabled={disabled} onClick={onClick}>
              {inner}
            </button>
          );
        })}
      </div>

      {dialog?.kind === "seat" && (
        <SeatDialog
          tableName={name}
          capacity={capacity}
          mode={dialog.mode}
          pending={seat.isPending}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onConfirm={(covers) => seat.mutate({ covers, thenOrder: dialog.thenOrder })}
        />
      )}
      {dialog?.kind === "adjust" && open && (
        <AdjustDialog
          checkId={open.check.id}
          tableName={name}
          line={dialog.line}
          isManager={isManager}
          initialKind={dialog.adjust}
          onCancel={() => setDialog(null)}
          onDone={(k) => {
            setDialog(null);
            flash(t(`adjust.done.${k}`));
            refresh();
          }}
        />
      )}
    </section>
  );
}

interface LineGroupProps {
  label: string;
  lines: CheckLine[];
  subtotal: number;
  /** The line whose Comp / Void menu is open. */
  openRef: string | null;
  onToggle: (lineRef: string) => void;
  onAdjust: (line: CheckLine, kind: AdjustmentKind) => void;
  canUndo: boolean;
  onUndo: (adjustmentId: string) => void;
  undoing: boolean;
}

function LineGroup({ label, lines, subtotal, openRef, onToggle, onAdjust, canUndo, onUndo, undoing }: LineGroupProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  if (lines.length === 0) return null;
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return (
    <div className="fl-group" role="group" aria-label={label}>
      <h3 className="fl-h">
        <span>{label}</span>
        <span>{count}</span>
      </h3>
      <ul>
        {lines.map((l, i) => {
          const gone = l.voidedQty >= l.qty;
          const free = freeUnits(l);
          const tappable = !gone && free > 0;
          const menuOpen = tappable && openRef === l.lineRef;
          const body = (
            <>
              <span className="q">
                {l.voidedQty > 0 && !gone ? (
                  <>
                    <s>{l.qty}</s> {l.qty - l.voidedQty}
                  </>
                ) : gone ? (
                  <s>{l.qty}</s>
                ) : (
                  l.qty
                )}
              </span>
              <span className="body">
                <span className="nm">{gone ? <s>{loc(l.name, lang)}</s> : loc(l.name, lang)}</span>
                {l.options.map((o, j) => (
                  <span key={j} className="mod">
                    {loc(o, lang)}
                  </span>
                ))}
                {l.note && <span className="mod note">{l.note}</span>}
                <span className="meta">
                  {gone ? (
                    <span className="fl-st is-voided">{t("adjust.tag.voidedLine")}</span>
                  ) : (
                    <span className={`fl-st is-${l.status}`}>{t(`floor.detail.status.${l.status}`)}</span>
                  )}
                  {l.seat != null && <span> · {t("floor.detail.seat", { n: l.seat })}</span>}
                </span>
              </span>
              <span className="price font-mono">{gone ? <s>{money(l.originalTotal)}</s> : money(l.lineTotal)}</span>
            </>
          );
          return (
            <li key={`${l.orderId}-${l.ticketId}-${i}`} className={`fl-line is-${l.status}${gone ? " is-gone" : ""}`}>
              {tappable ? (
                <button
                  type="button"
                  className="fl-line-hit"
                  aria-expanded={menuOpen}
                  onClick={() => onToggle(l.lineRef)}
                >
                  {body}
                </button>
              ) : (
                <div className="fl-line-hit">{body}</div>
              )}
              {menuOpen && (
                <div className="fl-line-menu" role="group" aria-label={t("adjust.menu.label", { item: loc(l.name, lang) })}>
                  <button type="button" className="staff-btn" onClick={() => onAdjust(l, "comp")}>
                    <Gift size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t("adjust.menu.comp")}
                  </button>
                  {isMade(l) ? (
                    <p className="fl-dialog-note">{t("adjust.menu.madeNote")}</p>
                  ) : (
                    <button type="button" className="staff-btn" onClick={() => onAdjust(l, "void")}>
                      <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                      {t("adjust.menu.void")}
                    </button>
                  )}
                </div>
              )}
              {l.adjustments.length > 0 && (
                <ul className="fl-tags">
                  {l.adjustments.map((a) => (
                    <AdjustTag key={a.id} adj={a} canUndo={canUndo} undoing={undoing} onUndo={() => onUndo(a.id)} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="fl-sub" data-testid="subtotal">
        <span>{t("floor.detail.subtotal")}</span>
        <span className="font-mono">{money(subtotal)}</span>
      </div>
    </div>
  );
}

function AdjustTag({ adj, canUndo, undoing, onUndo }: { adj: LineAdjustment; canUndo: boolean; undoing: boolean; onUndo: () => void }) {
  const { t } = useTranslation();
  const reason = t(`adjust.reasons.${adj.reason}`, { defaultValue: adj.reason });
  const text = adj.kind === "comp" ? t(adj.qty > 1 ? "adjust.tag.compMany" : "adjust.tag.comp", { count: adj.qty, reason }) : null;
  return (
    <li className={`fl-tag is-${adj.kind}`}>
      {adj.kind === "comp" ? (
        <span>{text}</span>
      ) : (
        <>
          <span>{t("adjust.tag.voided", { count: adj.qty })}</span>
          <span>{t("adjust.tag.voidedReason", { reason })}</span>
        </>
      )}
      {canUndo && (
        <button
          type="button"
          className="fl-tag-undo"
          disabled={undoing}
          aria-label={adj.kind === "comp" ? t("adjust.undoAria.comp", { reason }) : t("adjust.undoAria.void", { count: adj.qty, reason })}
          onClick={onUndo}
        >
          {t("adjust.undo")}
        </button>
      )}
    </li>
  );
}
