import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { MousePointerClick, Plus, UserRound } from "lucide-react";
import { api } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useMe } from "../auth";
import { Shell } from "../Shell";
import { nextOffset, useServerNow } from "../serverTime";
import { Chips } from "./Chips";
import { FloorCanvas } from "./FloorCanvas";
import { TableDetail, type SeatRequest } from "./TableDetail";
import { floorKey } from "./cache";
import { hm, roomName } from "./lib";
import type { FloorData, FloorSnapshot } from "./types";

export { floorKey, checkKey } from "./cache";

export interface FloorProps {
  /** Device clock in ms; injectable for tests. Elapsed times use it plus the server offset. */
  clock?: () => number;
}

/**
 * The waiter floor at `/staff/floor?room=<id>&table=<id>`: room tabs, attention chips, "+ New order" and the
 * "My tables" toggle; the stats strip; the room canvas; and the selected table's detail panel. Order entry (Task 18)
 * returns here with `?table=<id>`.
 */
export function Floor({ clock = Date.now }: FloorProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = useMe().data ?? null;
  const myId = me?.id ?? null;

  const offset = useRef<number | null>(null);
  const floor = useQuery({
    queryKey: floorKey,
    queryFn: async (): Promise<FloorData> => {
      const snap = await api<FloorSnapshot>("/api/floor");
      const ms = nextOffset(offset.current, Date.parse(snap.now) - clock());
      offset.current = ms;
      return { ...snap, offsetMs: ms };
    },
  });
  const data = floor.data;
  const now = useServerNow(data?.offsetMs ?? 0, clock);

  const [myOnly, setMyOnly] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [picking, setPicking] = useState(false);
  const [seatRequest, setSeatRequest] = useState<SeatRequest | null>(null);
  const seq = useRef(0);

  const rooms = data?.rooms ?? [];
  const tables = useMemo(() => data?.tables ?? [], [data]);
  const tableParam = params.get("table");
  const roomParam = params.get("room");
  const selected = tables.find((tb) => tb.id === tableParam) ?? null;
  const roomId = (roomParam && rooms.some((r) => r.id === roomParam) ? roomParam : null) ?? selected?.roomId ?? rooms[0]?.id ?? null;
  const room = rooms.find((r) => r.id === roomId) ?? null;
  const mineIds = useMemo(() => new Set(tables.filter((tb) => myId && tb.sectionStaffId === myId).map((tb) => tb.id)), [tables, myId]);

  const go = (next: { room?: string | null; table?: string | null }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const select = (id: string) => {
    const tb = tables.find((x) => x.id === id);
    if (!tb) return;
    if (picking) {
      setPicking(false);
      if (tb.state === "free") {
        seq.current += 1;
        setSeatRequest({ id: seq.current, thenOrder: true });
        go({ room: tb.roomId, table: id });
      } else void navigate(`/staff/order/${id}`);
      return;
    }
    setSeatRequest(null);
    // Pressing the selected table again clears the selection.
    go({ room: tb.roomId, table: id === tableParam ? null : id });
  };

  const newOrder = () => {
    if (!selected) {
      setPicking((p) => !p);
      return;
    }
    if (selected.state === "free") {
      seq.current += 1;
      setSeatRequest({ id: seq.current, thenOrder: true });
    } else void navigate(`/staff/order/${selected.id}`);
  };

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const callingRooms = new Set(tables.filter((tb) => tb.state === "calling").map((tb) => tb.roomId));

  const toolbar = rooms.length > 0 && (
    <div className="staff-seg ml-2" role="group" aria-label={t("floor.rooms.label")}>
      {rooms.map((r) => {
        const label = roomName(r.name, t);
        const dot = r.id !== roomId && callingRooms.has(r.id);
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={r.id === roomId}
            aria-label={dot ? t("floor.rooms.calling", { room: label }) : undefined}
            onClick={() => go({ room: r.id })}
          >
            {label}
            {dot && <span className="fl-room-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );

  const actions = (
    <>
      {data && (
        <Chips chips={data.chips} now={now} mine={mineIds} onPick={(id) => {
          setPicking(false);
          setSeatRequest(null);
          const tb = tables.find((x) => x.id === id);
          if (tb) go({ room: tb.roomId, table: id });
        }} />
      )}
      <button type="button" className="staff-btn fl-mine-toggle" aria-pressed={myOnly} onClick={() => setMyOnly((v) => !v)}>
        <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("floor.myTables")}
      </button>
      <button type="button" className="staff-btn primary" aria-pressed={picking ? true : undefined} onClick={newOrder}>
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("floor.newOrder")}
      </button>
    </>
  );

  const st = data?.stats;
  const stats = st && (
    <>
      <span>
        <b>{st.seated}</b>
        {t("floor.stats.seated", { total: st.totalTables })}
      </span>
      <span>
        <b>{st.covers}</b>
        {t("floor.stats.covers")}
      </span>
      <span>
        <b className="font-mono">{st.avgTurnMs > 0 ? hm(st.avgTurnMs, lang) : "–"}</b>
        {t("floor.stats.avgTurn")}
      </span>
      <span>
        <b className="font-mono">{money(st.openChecksTotal)}</b>
        {t("floor.stats.open")}
      </span>
    </>
  );
  const statsEnd = me && mineIds.size > 0 && (
    <span data-testid="my-section">
      {t("floor.stats.mySection")} <b>{me.name}</b>
      {" · "}
      {t("floor.stats.tables", { count: mineIds.size })}
    </span>
  );

  let canvas;
  if (floor.isError && !data) {
    canvas = (
      <div className="fl-empty">
        <p>{t("floor.loadError")}</p>
        <button type="button" className="staff-btn" onClick={() => void floor.refetch()}>
          {t("staff.retry")}
        </button>
      </div>
    );
  } else if (!data || !room) {
    canvas = <div className="fl-canvas" aria-busy="true" />;
  } else {
    canvas = (
      <FloorCanvas
        room={room}
        tables={tables.filter((tb) => tb.roomId === room.id)}
        now={now}
        selectedId={selected?.id ?? null}
        myId={myId}
        myOnly={myOnly}
        zoom={zoom}
        onZoom={setZoom}
        onSelect={select}
        picking={picking}
      />
    );
  }

  return (
    <Shell
      title={t("floor.title")}
      toolbar={toolbar}
      actions={actions}
      stats={stats || null}
      statsEnd={statsEnd || null}
      clock={false}
      railBadges={{ floor: data?.chips.some((c) => c.kind === "calling") ?? false }}
    >
      <div className="fl-body" lang={lang}>
        {canvas}
        {selected && !picking ? (
          <TableDetail key={selected.id} tableId={selected.id} table={selected} now={now} seatRequest={seatRequest} />
        ) : (
          <section className="fl-det" aria-label={picking ? t("floor.pickTable") : t("floor.detail.none")}>
            <div className="fl-none">
              <MousePointerClick size={20} strokeWidth={1.5} aria-hidden="true" />
              {picking ? (
                <>
                  <p className="fl-none-t" role="status">{t("floor.pickTable")}</p>
                  <button type="button" className="staff-btn" onClick={() => setPicking(false)}>
                    {t("floor.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <p className="fl-none-t">{t("floor.detail.none")}</p>
                  <p className="fl-hint">{t("floor.detail.noneHint")}</p>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
