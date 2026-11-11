import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Circle, Pencil, Plus, RectangleHorizontal, Square, TriangleAlert, type LucideIcon } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useLive } from "../../lib/useLive";
import { Dialog } from "../Dialog";
import { Shell } from "../Shell";
import { roomName } from "../floor/lib";
import { useManagerFloor } from "../manager/queries";
import { managerFloorKey } from "../manager/types";
import { useStaffPeople } from "../people/queries";
import { clampInto } from "./geometry";
import { Inspector } from "./Inspector";
import { PlanCanvas } from "./PlanCanvas";
import { useLayoutDraft } from "./useLayoutDraft";
import type { LayoutRoom, ShapeOption } from "./types";

const ADD: readonly { option: ShapeOption; icon: LucideIcon }[] = [
  { option: "round", icon: Circle },
  { option: "square", icon: Square },
  { option: "booth", icon: RectangleHorizontal },
];

/**
 * `/staff/floor-plan` (manager, spec §7): one room at a time. Tables are dragged (or moved with the keyboard or
 * the inspector's arrows) on a 16 px grid; edits stay local until Save layout sends the whole room with its
 * version. Leaving or switching rooms with unsaved changes asks first.
 */
export function FloorPlan() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const hintId = useId();
  const floor = useManagerFloor();
  const people = useStaffPeople();
  const [params, setParams] = useSearchParams();
  const rooms = useMemo(() => floor.data?.rooms ?? [], [floor.data]);
  const roomParam = params.get("room");
  const roomId = (roomParam && rooms.some((r) => r.id === roomParam) ? roomParam : rooms[0]?.id) ?? null;
  const draft = useLayoutDraft(roomId);
  const [announcement, setAnnouncement] = useState("");
  /** A table the canvas should focus once it is rendered (after the inspector's Duplicate or Delete). */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [roomDialog, setRoomDialog] = useState<"add" | "rename" | null>(null);

  const room = draft.room;
  // The name from the room list, so a rename shows without reloading (and dropping) the draft.
  const listed = rooms.find((r) => r.id === room?.id);
  const roomLabel = room ? roomName(listed?.name ?? room.name, t) : "";
  const selected = draft.tables.find((x) => x.key === draft.selected) ?? null;
  const waiters = (people.data?.people ?? []).filter((p) => p.role === "waiter" && p.active).map((p) => ({ id: p.id, name: p.name }));
  const nameOf = (id: string) => people.data?.people.find((p) => p.id === id)?.name ?? null;
  const dirty = draft.changes > 0;

  // Problems from a refused save, per table key, worded; plus their list (a removed table is named from the server).
  const problems = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of draft.problems) m.set(p.key, [...(m.get(p.key) ?? []), t(`floorPlan.problem.${p.code}`)]);
    return m;
  }, [draft.problems, t]);
  const problemName = (key: string) =>
    draft.tables.find((x) => x.key === key)?.name ?? draft.query.data?.tables.find((x) => x.id === key)?.name ?? key;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Another manager saved this room (or this is the echo of our own save): take that version only if, when it
  // arrives, there is still nothing here to lose.
  useLive({ audience: "staff" }, (e) => {
    if (e.type === "layout.saved" && roomId && e.ids.includes(roomId)) draft.reloadIfClean();
  });

  const setRoom = (id: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("room", id);
      return n;
    });

  const move = (key: string, x: number, y: number) => {
    const tb = draft.tables.find((v) => v.key === key);
    if (!tb || !room) return;
    const at = clampInto({ ...tb, x, y }, room);
    // Pressed against the edge: nothing moved, so nothing to say.
    if (at.x === tb.x && at.y === tb.y) return;
    draft.move(key, at.x, at.y);
    setAnnouncement(t("floorPlan.moved", { name: tb.name, x: at.x, y: at.y }));
  };
  const remove = (key: string) => {
    const tb = draft.tables.find((v) => v.key === key);
    if (!tb) return false;
    const ok = draft.remove(key);
    setAnnouncement(ok ? t("floorPlan.removed", { name: tb.name }) : t("floorPlan.cantRemove", { name: tb.name }));
    return ok;
  };
  const add = (option: ShapeOption) => {
    const tb = draft.add(option);
    if (tb) setAnnouncement(t("floorPlan.added", { name: tb.name }));
  };

  const toolbar = rooms.length > 0 && (
    <div className="fp-rooms">
      <div className="staff-seg" role="group" aria-label={t("floorPlan.rooms")}>
        {rooms.map((r) => (
          <button key={r.id} type="button" aria-pressed={r.id === roomId} onClick={() => r.id !== roomId && setRoom(r.id)}>
            {roomName(r.name, t)}
          </button>
        ))}
      </div>
      <button type="button" className="staff-btn" aria-label={t("floorPlan.room.add")} onClick={() => setRoomDialog("add")}>
        <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("floorPlan.room.addShort")}
      </button>
      {room && (
        <button type="button" className="staff-btn" onClick={() => setRoomDialog("rename")}>
          <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
          {t("floorPlan.room.rename")}
        </button>
      )}
    </div>
  );

  const actions = (
    <>
      {dirty && (
        <span className="fp-dirty">
          <i aria-hidden="true" />
          {t("floorPlan.unsaved", { count: draft.changes })}
        </span>
      )}
      <button type="button" className="staff-btn" disabled={!dirty || draft.saving} onClick={() => draft.discard()}>
        {t("floorPlan.discard")}
      </button>
      <button type="button" className="staff-btn primary" disabled={!dirty || draft.saving} onClick={() => draft.save()}>
        {draft.saving ? t("floorPlan.saving") : t("floorPlan.save")}
      </button>
    </>
  );

  const loadError = floor.isError || draft.query.isError;
  return (
    <Shell title={t("floorPlan.title")} toolbar={toolbar} actions={actions} clock={false}>
      <p role="status" className="sr-only">{announcement}</p>
      {!floor.data || (roomId && !room) ? (
        <div className="mg-blocking" role={loadError ? "alert" : "status"}>
          {loadError ? (
            <>
              <p>{t("floorPlan.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void (floor.isError ? floor.refetch() : draft.query.refetch())}>
                {t("manager.retry")}
              </button>
            </>
          ) : (
            <p>{t("floorPlan.loading")}</p>
          )}
        </div>
      ) : !room ? (
        <div className="mg-blocking">
          <p>{t("floorPlan.noRooms")}</p>
          <button type="button" className="staff-btn primary" onClick={() => setRoomDialog("add")}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("floorPlan.room.add")}
          </button>
        </div>
      ) : (
        <div className="fp-page">
          <div className="fp-main">
            <p role="status" className="mg-status">{draft.notice?.kind === "saved" ? draft.notice.text : ""}</p>
            <div role="alert" className="fp-alerts">
              {draft.notice && draft.notice.kind !== "saved" && (
                <div className="staff-notice">
                  <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" className="flex-none mt-0.5" />
                  <div>
                    <p>{draft.notice.text}</p>
                    {draft.problems.length > 0 && (
                      <ul className="fp-problems">
                        {draft.problems.map((p) => (
                          <li key={`${p.key}-${p.code}`}>
                            {t("floorPlan.problemItem", { name: problemName(p.key), problem: t(`floorPlan.problem.${p.code}`) })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="fp-canvas">
              <PlanCanvas
                focusKey={focusKey}
                onFocused={() => setFocusKey(null)}
                room={room}
                roomLabel={roomLabel}
                tables={draft.tables}
                selected={draft.selected}
                problems={problems}
                hintId={hintId}
                onSelect={draft.select}
                onMove={move}
                onRemove={remove}
              />
              <div className="fp-tools" role="group" aria-label={t("floorPlan.add")}>
                {ADD.map(({ option, icon: Icon }) => (
                  <button key={option} type="button" className="staff-btn" onClick={() => add(option)}>
                    <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    {t(`floorPlan.shape.${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <p id={hintId} className="mg-hint">{t("floorPlan.canvas.hint")}</p>
          </div>
          {selected ? (
            <Inspector
              key={selected.key}
              draft={draft}
              table={selected}
              roomLabel={roomLabel}
              waiters={waiters}
              nameOf={nameOf}
              announce={setAnnouncement}
              focusTable={setFocusKey}
            />
          ) : (
            <aside className="pp-panel fp-panel fp-panel-empty">
              <p className="mg-hint">{t("floorPlan.inspector.empty")}</p>
            </aside>
          )}
        </div>
      )}

      {roomDialog && (
        <RoomDialog
          mode={roomDialog}
          room={roomDialog === "rename" && room ? { id: room.id, name: listed?.name ?? room.name } : null}
          empty={draft.query.data?.tables.length === 0}
          onClose={() => setRoomDialog(null)}
          onDone={(next, message) => {
            setRoomDialog(null);
            setAnnouncement(message);
            void qc.invalidateQueries({ queryKey: managerFloorKey });
            void qc.invalidateQueries({ queryKey: ["floor"] });
            if (next === null) setParams(new URLSearchParams());
            else if (next !== roomId) setRoom(next);
          }}
        />
      )}

      {blocker.state === "blocked" && (
        <Dialog
          title={t("floorPlan.leave.title")}
          onClose={() => blocker.reset()}
          footer={
            <>
              <button type="button" className="staff-btn" onClick={() => blocker.reset()}>{t("floorPlan.leave.stay")}</button>
              <button type="button" className="staff-btn primary" onClick={() => blocker.proceed()}>{t("floorPlan.leave.go")}</button>
            </>
          }
        >
          <p>{t("floorPlan.leave.body", { count: draft.changes })}</p>
        </Dialog>
      )}
    </Shell>
  );
}

/** Add a room, or rename / delete the current one (delete only when it has no tables). */
function RoomDialog({
  mode,
  room,
  empty,
  onClose,
  onDone,
}: {
  mode: "add" | "rename";
  room: { id: string; name: string } | null;
  empty: boolean;
  onClose: () => void;
  /** The room to show next (null: the first), and what to announce. */
  onDone: (roomId: string | null, message: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(room?.name ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      room
        ? api<LayoutRoom>(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) })
        : api<LayoutRoom>("/api/rooms", { method: "POST", body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: (r) => onDone(r.id, t(room ? "floorPlan.room.renamed" : "floorPlan.room.added", { name: r.name })),
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/rooms/${room!.id}`, { method: "DELETE" }),
    onSuccess: () => onDone(null, t("floorPlan.room.deleted", { name: room!.name })),
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };
  const busy = save.isPending || del.isPending;

  return (
    <Dialog
      title={t(mode === "add" ? "floorPlan.room.addTitle" : "floorPlan.room.renameTitle")}
      onClose={onClose}
      footer={
        <>
          {room && (
            <button
              type="button"
              className="staff-btn mr-auto"
              disabled={!empty || busy}
              aria-describedby={empty ? undefined : `${id}-del`}
              onClick={() => del.mutate()}
            >
              {t("floorPlan.room.delete")}
            </button>
          )}
          <button type="button" className="staff-btn" onClick={onClose}>{t("floorPlan.room.cancel")}</button>
          <button type="submit" form={`${id}-form`} className="staff-btn primary" disabled={!name.trim() || busy}>
            {t(mode === "add" ? "floorPlan.room.add" : "floorPlan.room.save")}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="mg-field" onSubmit={submit}>
        <label htmlFor={`${id}-name`}>{t("floorPlan.room.name")}</label>
        <input id={`${id}-name`} className="mg-input" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        {room && !empty && <p id={`${id}-del`} className="mg-hint">{t("floorPlan.room.deleteHint")}</p>}
        {failure && <p role="alert" className="fp-err">{failure}</p>}
      </form>
    </Dialog>
  );
}
