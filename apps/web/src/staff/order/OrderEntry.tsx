import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Send, UserRound, Users } from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { useSlashFocus } from "../../lib/useSlashFocus";
import type { LineProblem } from "../../guest/cart";
import type { MenuItem, MenuResponse } from "../../guest/types";
import { Shell } from "../Shell";
import { loc } from "../kds/lib";
import { checkKey, floorKey } from "../floor/cache";
import type { TableCheck } from "../floor/types";
import {
  addItem,
  draftCount,
  emptyDraft,
  loadDraft,
  markProblem,
  removeLine,
  room,
  saveDraft,
  setLineNote,
  setLineQty,
  setLineSeat,
  toOrderRequest,
  withIdempotencyKey,
  MAX_ORDER_QTY,
  type Draft,
  type DraftLine,
  type NewDraftLine,
} from "./draft";
import { ItemGrid, groupCategories } from "./ItemGrid";
import { OptionsSheet } from "./OptionsSheet";
import { OrderTicket, linePrice } from "./OrderTicket";
import { searchItems } from "./search";

/** The staff-readable menu (`GET /api/menu`); `menu.changed` / `availability.changed` invalidate it (useLive). */
export const menuKey = ["menu"] as const;

type OrderResult = { orderId: string; checkId: string; ticketIds: string[] };
const ALL = "all";

/**
 * Waiter order entry, `/staff/order/:tableId`. Category tabs and search on the left, a dense item grid in the
 * centre, the order being built on the right with the total and Send. Send posts everything at once to
 * `/api/tables/:id/orders` (no courses); on success it returns to `/staff/floor?table=<id>`.
 */
export function OrderEntry() {
  const { tableId = "" } = useParams();
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const table = useQuery({ queryKey: checkKey(tableId), queryFn: () => api<TableCheck>(`/api/tables/${tableId}/check`) });
  const menu = useQuery({ queryKey: menuKey, queryFn: () => api<MenuResponse>("/api/menu") });
  const tableName = table.data?.table.name ?? "";
  const check = table.data?.check ?? null;

  // ---- The order being built (kept in sessionStorage per table) --------------------------------------------
  const [draft, setDraft] = useState<Draft>(() => loadDraft(tableId) ?? emptyDraft());
  useEffect(() => saveDraft(tableId, draft), [tableId, draft]);
  // The draft belongs to one check. On first load a stored draft for an earlier party is dropped; an empty draft
  // follows the table's current check. A check that changes mid-order is caught by Send (`expectedCheckId`).
  const reconciled = useRef(false);
  const currentCheckId = check?.id ?? null;
  useEffect(() => {
    if (!table.data) return;
    // Read before setDraft: React runs the updater later, after the ref below has flipped.
    const first = !reconciled.current;
    setDraft((d) => {
      if (first && d.checkId !== currentCheckId && d.lines.length > 0) return emptyDraft(currentCheckId);
      if (d.lines.length === 0 && d.checkId !== currentCheckId) return { ...d, checkId: currentCheckId };
      return d;
    });
    reconciled.current = true;
  }, [table.data, currentCheckId]);

  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const inOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of draft.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [draft.lines]);

  const problemOf = (l: DraftLine): LineProblem | undefined => {
    if (l.problem) return l.problem;
    if (!menu.data) return undefined;
    const item = itemsById.get(l.itemId);
    if (!item) return "unavailable";
    return item.availability.soldOut ? "sold_out" : undefined;
  };
  const hasProblem = draft.lines.some((l) => problemOf(l));
  const count = draftCount(draft);
  const total = draft.lines.reduce((sum, l) => sum + linePrice(l, itemsById.get(l.itemId)) * l.qty, 0);

  // ---- Feedback: live announcements, the cap, send errors ----------------------------------------------------
  const [announce, setAnnounce] = useState({ seq: 0, text: "" });
  const [capHit, setCapHit] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const edit = (fn: (d: Draft) => Draft) => {
    setSendError(null);
    setCapHit(false);
    setDraft(fn);
  };

  const add = (item: MenuItem, line: NewDraftLine) => {
    const { draft: next, added } = addItem(draft, line);
    if (added === 0) return setCapHit(true);
    edit(() => next);
    if (added < line.qty) setCapHit(true);
    const name = loc(item.name, lang);
    setAnnounce((a) => ({ seq: a.seq + 1, text: added > 1 ? t("order.addedMany", { count: added, name }) : t("order.added", { name }) }));
  };

  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const pick = (item: MenuItem) => {
    if (item.availability.soldOut) return;
    if (room(draft) === 0) {
      setCapHit(true);
      return;
    }
    if (item.optionGroups.length > 0) setSheetItem(item);
    else add(item, { itemId: item.id, qty: 1, options: [] });
  };

  // ---- Send ----------------------------------------------------------------------------------------------------
  const send = useMutation({
    mutationFn: (d: Draft) => api<OrderResult>(`/api/tables/${tableId}/orders`, { method: "POST", body: JSON.stringify(toOrderRequest(d)) }),
    onSuccess: () => {
      // Cleared in storage now: the route change below unmounts this screen before an effect could save.
      saveDraft(tableId, emptyDraft());
      setDraft(emptyDraft());
      void qc.invalidateQueries({ queryKey: floorKey });
      void qc.invalidateQueries({ queryKey: checkKey(tableId) });
      void navigate(`/staff/floor?table=${tableId}`);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        const itemId = (err.details as { itemId?: string } | undefined)?.itemId;
        if ((err.code === "sold_out" || err.code === "item_unavailable") && itemId) {
          // The rest of the order is kept; the attempt's key stays until the lines change.
          setDraft((d) => markProblem(d, itemId, err.code === "sold_out" ? "sold_out" : "unavailable"));
          return;
        }
        if (err.code === "conflict" || err.code === "check_closed") {
          setBlocked(true);
          void qc.invalidateQueries({ queryKey: checkKey(tableId) });
          return;
        }
        if (err.code === "limit_exceeded") return setSendError(t("order.limitExceeded"));
        if (err.status < 500) return setSendError(errorMessage(t, err));
      }
      // Network or server error: the lines and the key stay, so a retry can never place the order twice.
      setSendError(t("order.sendFailed"));
    },
  });

  const onSend = () => {
    if (send.isPending || count === 0 || hasProblem) return;
    const d = withIdempotencyKey(draft);
    setDraft(d);
    setSendError(null);
    send.mutate(d);
  };

  // ---- Search and categories -------------------------------------------------------------------------------------
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const groups = useMemo(() => groupCategories(menu.data?.categories ?? [], items), [menu.data, items]);
  const results = useMemo(() => searchItems(items, query), [items, query]);
  const searching = query.trim().length > 0;
  const catName = (id: string) => loc(menu.data?.categories.find((c) => c.id === id)?.name ?? { en: "", tr: "" }, lang);

  const sections = searching
    ? [{ id: "results", title: null, items: results }]
    : cat === ALL
      ? [...groups.food, ...groups.drinks].map((c) => ({ id: c.id, title: loc(c.name, lang), items: items.filter((i) => i.categoryId === c.id) }))
      : [{ id: cat, title: null, items: items.filter((i) => i.categoryId === cat) }];
  const gridLabel = t("order.grid", {
    label: searching ? t("order.search.results", { count: results.length }) : cat === ALL ? t("order.all") : catName(cat),
  });

  // ---- Render ------------------------------------------------------------------------------------------------------
  const back = `/staff/floor?table=${tableId}`;
  const leading = (
    <Link to={back} className="staff-btn oe-back" aria-label={t("order.back")}>
      <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      {t("order.backShort")}
    </Link>
  );
  const meta = check && (
    <div className="oe-meta">
      <span>
        <Users size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{check.covers ? t("order.covers", { count: check.covers }) : t("order.noCovers")}</span>
      </span>
      {check.serverName && (
        <span>
          <UserRound size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">{t("order.server")} </span>
          <span>{check.serverName}</span>
        </span>
      )}
    </div>
  );
  const shell = (body: ReactNode) => (
    <Shell leading={leading} title={tableName || t("order.title")} subtitle={tableName ? t("order.title") : undefined} toolbar={meta}>
      {body}
    </Shell>
  );

  if (table.isError) {
    return shell(
      <Blocking title={t("order.tableError")} body={errorMessage(t, table.error)} back={back} backLabel={t("order.back")} />,
    );
  }
  if (table.data && !check) {
    return shell(
      <Blocking title={t("order.notSeated.title", { table: tableName })} body={t("order.notSeated.body")} back={back} backLabel={t("order.back")} />,
    );
  }

  const footer = (
    <>
      {capHit && (
        <p className="staff-notice" role="status">{t("order.ticket.cap", { max: MAX_ORDER_QTY })}</p>
      )}
      {hasProblem && !blocked && <p className="oe-hint">{t("order.ticket.fixFirst")}</p>}
      {blocked && (
        <div className="staff-notice oe-blocked" role="alert">
          <p>{t("order.notSeated.closed", { table: tableName })}</p>
          <Link to={back} className="staff-btn">{t("order.back")}</Link>
        </div>
      )}
      {sendError && !blocked && <p className="staff-notice" role="alert">{sendError}</p>}
      <div className="oe-total">
        <span>{t("order.total")}</span>
        <span className="font-mono" data-testid="order-total">{money(total)}</span>
      </div>
      <button type="button" className="staff-btn primary oe-send" disabled={count === 0 || hasProblem || blocked || send.isPending} onClick={onSend}>
        <Send size={16} strokeWidth={1.75} aria-hidden="true" />
        {send.isPending ? t("order.sending") : t("order.send")}
      </button>
    </>
  );

  return shell(
    <div className="oe">
      <aside className="oe-side">
        <label className="kds-search oe-search">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">{t("order.search.label")}</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t("order.search.placeholder")}
            aria-keyshortcuts="/"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              } else if (e.key === "Enter" && results[0] && searching) {
                pick(results[0]);
              }
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <nav className="oe-cats" aria-label={t("order.categories")}>
          <button type="button" aria-pressed={!searching && cat === ALL} onClick={() => { setQuery(""); setCat(ALL); }}>
            {t("order.all")}
            <span className="n font-mono" aria-hidden="true">{items.length || ""}</span>
          </button>
          {(["food", "drinks"] as const).map((g) =>
            groups[g].length > 0 ? (
              <div key={g} className="oe-cat-group">
                <h2 className="staff-label">{t(`order.${g}`)}</h2>
                {groups[g].map((c) => (
                  <button key={c.id} type="button" aria-pressed={!searching && cat === c.id} onClick={() => { setQuery(""); setCat(c.id); }}>
                    {loc(c.name, lang)}
                    <span className="n font-mono" aria-hidden="true">{c.count}</span>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </nav>
      </aside>

      <div className="oe-main" aria-busy={menu.isPending}>
        {menu.isError ? (
          <div className="oe-msg">
            <p>{t("order.loadError")}</p>
            <button type="button" className="staff-btn" onClick={() => void menu.refetch()}>{t("order.retry")}</button>
          </div>
        ) : menu.isPending ? (
          <div className="oe-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="oe-tile is-skel" />)}
          </div>
        ) : searching && results.length === 0 ? (
          <p className="oe-msg">{t("order.search.none", { query: query.trim() })}</p>
        ) : (
          <ItemGrid sections={sections} label={gridLabel} inOrder={inOrder} onPick={pick} />
        )}
      </div>

      <OrderTicket
        tableName={tableName}
        lines={draft.lines}
        itemsById={itemsById}
        problemOf={problemOf}
        canGrow={room(draft) > 0}
        onQty={(key, qty) => edit((d) => setLineQty(d, key, qty))}
        onSeat={(key, seat) => edit((d) => setLineSeat(d, key, seat))}
        onNote={(key, note) => edit((d) => setLineNote(d, key, note))}
        onRemove={(key) => edit((d) => removeLine(d, key))}
        footer={footer}
      />

      <p className="sr-only" role="status" data-testid="order-announce">
        <span key={announce.seq}>{announce.text}</span>
      </p>

      {sheetItem && (
        <OptionsSheet
          item={itemsById.get(sheetItem.id) ?? sheetItem}
          maxQty={Math.max(1, room(draft))}
          onClose={() => setSheetItem(null)}
          onAdd={(line) => {
            add(sheetItem, line);
            setSheetItem(null);
          }}
        />
      )}
    </div>,
  );
}

function Blocking({ title, body, back, backLabel }: { title: string; body: string; back: string; backLabel: string }) {
  return (
    <div className="oe-blocking">
      <h2>{title}</h2>
      <p>{body}</p>
      <Link to={back} className="staff-btn primary">{backLabel}</Link>
    </div>
  );
}
