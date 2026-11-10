import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { RotateCcw, Search } from "lucide-react";
import { ticketAgeState } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useLive, type LiveEvent } from "../../lib/useLive";
import { Shell } from "../Shell";
import { AllDay } from "./AllDay";
import { EightySix } from "./EightySix";
import { Ticket } from "./Ticket";
import { matchesSearch } from "./lib";
import { EnableSoundButton, useChime } from "./useChime";
import { nextOffset, useServerNow } from "../serverTime";

export { nextOffset };
import type { KdsData, KdsSnapshot, KdsTab, KdsTicket, Station } from "./types";

const TABS: readonly KdsTab[] = ["active", "held", "done"];
/** The API returns at most this many done tickets. */
const DONE_CAP = 50;
const MESSAGE_MS = 2500;

export const kdsKey = (station: Station, tab?: KdsTab) => (tab ? (["kds", station, tab] as const) : (["kds", station] as const));

export interface KdsProps {
  station: Station;
  /** Device clock in ms; injectable for tests. The board corrects it by the server offset. */
  clock?: () => number;
}

type Mapper = (tickets: KdsTicket[]) => KdsTicket[];
const patch = (qc: QueryClient, key: readonly unknown[], fn: Mapper) =>
  qc.setQueryData<KdsData>(key, (d) => (d ? { ...d, tickets: fn(d.tickets) } : d));

/** The kitchen or bar display: toolbar, stats strip, the ticket grid, and the All day / 86 column. */
export function Kds({ station, clock = Date.now }: KdsProps) {
  const { t } = useTranslation();
  const { lang, elapsed } = useFormat();
  const qc = useQueryClient();
  const chime = useChime();
  const [tab, setTab] = useState<KdsTab>("active");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // The held offset, shared by the three tab queries. A plain mutable holder: written only when a response arrives.
  const [offset] = useState<{ ms: number | null }>(() => ({ ms: null }));
  const fetchTab = (tb: KdsTab) => async (): Promise<KdsData> => {
    const snap = await api<KdsSnapshot>(`/api/kds/${station}?tab=${tb}`);
    const ms = nextOffset(offset.ms, Date.parse(snap.now) - clock());
    offset.ms = ms;
    return { ...snap, offsetMs: ms };
  };
  const active = useQuery({ queryKey: kdsKey(station, "active"), queryFn: fetchTab("active") });
  const held = useQuery({ queryKey: kdsKey(station, "held"), queryFn: fetchTab("held") });
  const done = useQuery({ queryKey: kdsKey(station, "done"), queryFn: fetchTab("done") });
  const byTab = { active, held, done };
  const current = byTab[tab];

  const snapshot = active.data;
  const thresholds = snapshot?.thresholds ?? current.data?.thresholds;
  const now = useServerNow(snapshot?.offsetMs ?? current.data?.offsetMs ?? 0, clock);

  // ---- New-ticket chime and announcement --------------------------------------------------------------
  // Events carry ids only, so remember the ids a ticket.created named and look for them in the refetched list.
  const pending = useRef(new Set<string>());
  const seen = useRef<Set<string> | null>(null);
  const lastServerNow = useRef(0);
  const { play } = chime;
  const onEvent = useCallback((e: LiveEvent) => {
    if (e.type !== "ticket.created") return;
    if (pending.current.size > 500) pending.current.clear();
    for (const id of e.ids) pending.current.add(id);
  }, []);
  useLive({ audience: "staff" }, onEvent);

  useEffect(() => {
    for (const d of [held.data, done.data]) for (const tk of d?.tickets ?? []) seen.current?.add(tk.id);
  }, [held.data, done.data]);

  useEffect(() => {
    if (!snapshot) return;
    const prevNow = lastServerNow.current;
    lastServerNow.current = Date.parse(snapshot.now);
    if (!seen.current) {
      seen.current = new Set(snapshot.tickets.map((tk) => tk.id));
      return;
    }
    const known = seen.current;
    // New to this board: named by a ticket.created, or sent after the last snapshot (missed while offline).
    // Recalled or resumed tickets were seen before, so they never chime.
    const fresh = snapshot.tickets.filter(
      (tk) => !known.has(tk.id) && (pending.current.has(tk.id) || Date.parse(tk.sentAt) >= prevNow - 2000),
    );
    for (const tk of snapshot.tickets) known.add(tk.id);
    if (fresh.length === 0) return;
    for (const tk of fresh) pending.current.delete(tk.id);
    play();
    if (liveRef.current) {
      liveRef.current.textContent = t("kds.announce.new", { count: fresh.length, tables: fresh.map((tk) => tk.tableName).join(", ") });
    }
  }, [snapshot, play, t]);

  // ---- "/" focuses the search -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Inline messages and busy state -----------------------------------------------------------------
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  const flash = useCallback((id: string, text: string, then?: () => void) => {
    setMessages((m) => ({ ...m, [id]: text }));
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        setMessages((m) => {
          const rest = { ...m };
          delete rest[id];
          return rest;
        });
        then?.();
      }, MESSAGE_MS),
    );
  }, []);
  const setBusyFor = (id: string, on: boolean) =>
    setBusy((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const refetchAll = () => qc.invalidateQueries({ queryKey: kdsKey(station) });
  const isConflict = (err: unknown) => err instanceof ApiClientError && err.status === 409;

  /** Inline message on the ticket. A 409 refetches only after the message has been read. */
  const errorFor = (err: unknown, id: string) => {
    if (isConflict(err)) flash(id, t("kds.conflict"), () => void refetchAll());
    else flash(id, t("kds.failed"));
  };
  /** onSettled: reconcile with the server at once, except after a 409 (errorFor refetches after the message). */
  const settle = (err: unknown) => {
    if (!isConflict(err)) void refetchAll();
  };

  // Tickets whose bump is in flight stay off the board, even if a refetch lands meanwhile and still has them.
  const [bumping, setBumping] = useState<ReadonlySet<string>>(new Set());
  const markBumping = (id: string, on: boolean) =>
    setBumping((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Standard TanStack optimistic updates: cancel, snapshot, patch; restore the snapshot on error; refetch when settled.
  const bump = useMutation({
    mutationFn: (tk: KdsTicket) => api<{ ticket: KdsTicket }>(`/api/tickets/${tk.id}/bump`, { method: "POST" }),
    onMutate: async (tk) => {
      markBumping(tk.id, true);
      const key = kdsKey(station, "active");
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<KdsData>(key);
      patch(qc, key, (ts) => ts.filter((x) => x.id !== tk.id));
      return { previous };
    },
    onError: (err, tk, ctx) => {
      if (ctx?.previous) qc.setQueryData(kdsKey(station, "active"), ctx.previous);
      errorFor(err, tk.id);
    },
    onSettled: (_r, err, tk) => {
      markBumping(tk.id, false);
      settle(err);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ tk, index }: { tk: KdsTicket; index: number; tab: KdsTab }) =>
      api<{ ticket: KdsTicket }>(`/api/tickets/${tk.id}/items/${index}/toggle`, { method: "POST" }),
    onMutate: async ({ tk, index, tab: tb }) => {
      const key = kdsKey(station, tb);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<KdsData>(key);
      patch(qc, key, (ts) =>
        ts.map((x) => (x.id === tk.id ? { ...x, items: x.items.map((i) => (i.index === index ? { ...i, checked: !i.checked } : i)) } : x)),
      );
      return { previous };
    },
    onError: (err, { tk, tab: tb }, ctx) => {
      if (ctx?.previous) qc.setQueryData(kdsKey(station, tb), ctx.previous);
      errorFor(err, tk.id);
    },
    onSuccess: ({ ticket }, { tab: tb }) => patch(qc, kdsKey(station, tb), (ts) => ts.map((x) => (x.id === ticket.id ? ticket : x))),
    onSettled: (_r, err) => settle(err),
  });

  const move = useMutation({
    mutationFn: ({ tk, action }: { tk: KdsTicket; action: "hold" | "unhold" }) =>
      api<{ ticket: KdsTicket }>(`/api/tickets/${tk.id}/${action}`, { method: "POST" }),
    onMutate: ({ tk }) => setBusyFor(tk.id, true),
    onError: (err, { tk }) => errorFor(err, tk.id),
    onSettled: (_r, err, { tk }) => {
      setBusyFor(tk.id, false);
      settle(err);
    },
  });

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(timers.current.get("__notice"));
    timers.current.set("__notice", setTimeout(() => setNotice(null), MESSAGE_MS + 500));
  }, []);
  const recall = useMutation({
    mutationFn: () => api<{ ticket: KdsTicket }>(`/api/kds/${station}/recall`, { method: "POST" }),
    onSuccess: ({ ticket }) => {
      seen.current?.add(ticket.id);
      showNotice(t("kds.recall.done", { table: ticket.tableName }));
      setTab("active");
      void refetchAll();
    },
    onError: (err) => showNotice(err instanceof ApiClientError && err.status === 404 ? t("kds.recall.none") : t("kds.failed")),
  });

  // ---- Derived --------------------------------------------------------------------------------------
  const notBumping = (tk: KdsTicket) => !bumping.has(tk.id);
  const activeTickets = (snapshot?.tickets ?? []).filter(notBumping);
  const shown = (current.data?.tickets ?? []).filter((tk) => notBumping(tk) && matchesSearch(tk, query));
  const lateCount = thresholds
    ? activeTickets.filter((tk) => ticketAgeState(new Date(tk.sentAt), now, thresholds) === "late").length
    : 0;
  const itemCount = activeTickets.reduce((n, tk) => n + tk.items.reduce((m, i) => m + i.qty, 0), 0);
  const counts: Record<KdsTab, string> = {
    active: active.data ? String(activeTickets.length) : "–",
    held: held.data ? String(held.data.tickets.length) : "–",
    done: done.data ? (done.data.tickets.length >= DONE_CAP ? `${DONE_CAP}+` : String(done.data.tickets.length)) : "–",
  };

  const toolbar = (
    <div className="staff-seg ml-2" role="group" aria-label={t("kds.tabs.label")}>
      {TABS.map((tb) => (
        <button key={tb} type="button" aria-pressed={tab === tb} onClick={() => setTab(tb)}>
          {t(`kds.tabs.${tb}`)} <em className="kds-count">{counts[tb]}</em>
        </button>
      ))}
    </div>
  );

  const actions = (
    <>
      {notice && (
        <span className="kds-notice" role="status">
          {notice}
        </span>
      )}
      <label className="kds-search">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{t("kds.search.label")}</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t("kds.search.placeholder")}
          aria-keyshortcuts="/"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
        />
        <kbd aria-hidden="true">/</kbd>
      </label>
      <EnableSoundButton chime={chime} />
      <button type="button" className="staff-btn" disabled={recall.isPending} onClick={() => recall.mutate()} aria-label={t("kds.recall.aria")}>
        <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("kds.recall.label")}
      </button>
    </>
  );

  const stats = (
    <>
      <span>
        <b>{activeTickets.length}</b>
        {t("kds.stats.open")}
      </span>
      <span>
        <b>{itemCount}</b>
        {t("kds.stats.items")}
      </span>
      <span>
        <b className="font-mono">{snapshot?.stats.avgTicketMs ? elapsed(snapshot.stats.avgTicketMs) : "–"}</b>
        {t("kds.stats.avg")}
      </span>
      <span className={lateCount > 0 ? "warn" : undefined}>
        <b>{lateCount}</b>
        {t("kds.stats.over", { count: thresholds?.lateMin ?? 15 })}
      </span>
    </>
  );

  let body: ReactNode;
  if (current.isError && !current.data) {
    body = (
      <div className="kds-empty">
        <p>{t("kds.loadError")}</p>
        <button type="button" className="staff-btn" onClick={() => void current.refetch()}>
          {t("staff.retry")}
        </button>
      </div>
    );
  } else if (!current.data || !thresholds) {
    body = <div className="kds-empty" aria-busy="true" />;
  } else if (shown.length === 0) {
    body = <p className="kds-empty">{query.trim() ? t("kds.empty.search", { query: query.trim() }) : t(`kds.empty.${tab}`)}</p>;
  } else {
    body = shown.map((tk) => (
      <Ticket
        key={tk.id}
        ticket={tk}
        now={now}
        thresholds={thresholds}
        busy={busy.has(tk.id)}
        message={messages[tk.id] ?? null}
        onBump={() => bump.mutate(tk)}
        onHold={() => move.mutate({ tk, action: "hold" })}
        onUnhold={() => move.mutate({ tk, action: "unhold" })}
        onToggle={(index) => toggle.mutate({ tk, index, tab })}
      />
    ));
  }

  return (
    <Shell
      title={t(`kds.title.${station}`)}
      subtitle={station === "kitchen" ? t("kds.title.hotLine") : undefined}
      toolbar={toolbar}
      actions={actions}
      stats={stats}
    >
      <div className="kds-body" lang={lang}>
        <section className="kds-tickets" aria-label={t(`kds.tabs.${tab}`)}>
          {body}
        </section>
        <aside className="kds-side">
          <AllDay rows={snapshot?.allDay ?? []} />
          <EightySix rows={snapshot?.eightySix ?? []} />
        </aside>
      </div>
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
    </Shell>
  );
}
