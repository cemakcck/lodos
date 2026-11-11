import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LayoutBody } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { clampInto, findFree, GRID, nextName, sizeFor } from "./geometry";
import { layoutKey, type DraftTable, type LayoutProblem, type LayoutTable, type LayoutView, type ShapeOption } from "./types";

/** Fields a save compares; any difference makes the table one unsaved change. */
const FIELDS = ["name", "shape", "x", "y", "w", "h", "capacity", "sectionStaffId"] as const;

export const shapeOption = (t: Pick<DraftTable, "name" | "shape">): ShapeOption =>
  t.name.startsWith("B") ? "booth" : t.shape === "round" ? "round" : "square";

const fromServer = (v: LayoutView): DraftTable[] => v.tables.map(({ id, ...rest }) => ({ ...rest, id, key: id }));

/** Added, removed and changed tables, one each; moving a table back to where it was is no change. */
export function countChanges(base: readonly LayoutTable[], draft: readonly DraftTable[]): number {
  const byId = new Map(draft.flatMap((d) => (d.id ? [[d.id, d] as const] : [])));
  let n = draft.filter((d) => !d.id).length;
  for (const b of base) {
    const d = byId.get(b.id);
    if (!d || FIELDS.some((f) => d[f] !== b[f])) n++;
  }
  return n;
}

/** Whether a typed name keeps the table's prefix (T or B). */
export const samePrefix = (current: string, next: string) => next.length > 0 && next[0] === current[0];

export type Notice = { kind: "conflict" | "saved" | "error"; text: string } | null;
type Editable = Partial<Pick<DraftTable, "name" | "capacity" | "sectionStaffId">>;

/**
 * The server layout of one room plus local edits, until Save layout sends the whole room with the version it was
 * loaded at. A `409 version_conflict` says so and reloads the other person's version; a `400 layout_invalid` keeps
 * the draft and reports each problem table. The layout query is never refreshed behind the editor's back (no live
 * invalidation, no refetch on focus), so a reload only ever happens on purpose.
 */
export function useLayoutDraft(roomId: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: layoutKey(roomId ?? ""),
    queryFn: () => api<LayoutView>(`/api/rooms/${roomId}/layout`),
    enabled: roomId !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Every fetch is a new version to load, even when it equals the last one (a reload after a conflict).
    structuralSharing: false,
  });
  const server = query.data;
  const [state, setState] = useState<{ source: LayoutView | undefined; tables: DraftTable[]; selected: string | null }>({
    source: undefined,
    tables: [],
    selected: null,
  });
  const [problems, setProblems] = useState<LayoutProblem[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const seq = useRef(0);
  // Read when a background reload lands, not when it was asked for: edits made meanwhile must survive.
  const busy = useRef({ dirty: false, saving: false });

  // A new server version (first load, room switch, save, reload) replaces the draft. Selection survives by name.
  if (server !== state.source) {
    const tables = server ? fromServer(server) : [];
    const was = state.tables.find((x) => x.key === state.selected);
    const selected = (was && tables.find((x) => x.key === was.key || x.name === was.name)?.key) ?? null;
    setState({ source: server, tables, selected });
  }
  const tables = state.source === server ? state.tables : server ? fromServer(server) : [];
  const room = server?.room;
  const changes = server ? countChanges(server.tables, tables) : 0;

  const edit = (fn: (ts: DraftTable[]) => DraftTable[], selected?: string | null) =>
    setState((s) => ({ ...s, tables: fn(s.tables), selected: selected === undefined ? s.selected : selected }));
  const patch = (key: string, fn: (x: DraftTable) => DraftTable) => edit((ts) => ts.map((x) => (x.key === key ? fn(x) : x)));
  const find = (key: string) => tables.find((x) => x.key === key);
  const nameFor = (prefix: "T" | "B") => nextName(prefix, server!.nextNames, tables.map((x) => x.name));

  const save = useMutation({
    mutationFn: (body: LayoutBody) => api<LayoutView>(`/api/rooms/${roomId}/layout`, { method: "PUT", body: JSON.stringify(body) }),
    onMutate: () => {
      setProblems([]);
      setNotice(null);
    },
    onSuccess: (view) => {
      qc.setQueryData(layoutKey(view.room.id), view);
      void qc.invalidateQueries({ queryKey: ["floor"] });
      void qc.invalidateQueries({ queryKey: ["manager"] });
      setNotice({ kind: "saved", text: t("floorPlan.saved") });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === "version_conflict") {
        setNotice({ kind: "conflict", text: t("floorPlan.conflict") });
        void query.refetch();
      } else if (err instanceof ApiClientError && err.code === "layout_invalid") {
        setProblems((err.details as { problems?: LayoutProblem[] } | undefined)?.problems ?? []);
        setNotice({ kind: "error", text: t("floorPlan.invalid") });
      } else {
        setNotice({ kind: "error", text: errorMessage(t, err) });
      }
    },
  });

  useEffect(() => {
    busy.current = { dirty: changes > 0, saving: save.isPending };
  });

  return {
    query,
    room,
    tables,
    nextNames: server?.nextNames,
    changes,
    problems,
    notice,
    saving: save.isPending,
    selected: state.selected,
    select: (key: string | null) => setState((s) => (s.selected === key ? s : { ...s, selected: key })),

    move(key: string, x: number, y: number) {
      if (!room) return;
      patch(key, (tb) => clampInto({ ...tb, x: Math.round(x), y: Math.round(y) }, room));
    },

    /** A new table with the next name of its prefix, at the first free spot; it becomes the selection. */
    add(option: ShapeOption): DraftTable | null {
      if (!room || !server) return null;
      const shape = option === "round" ? "round" : "rect";
      const capacity = option === "round" ? 2 : 4;
      const size = sizeFor(shape, capacity);
      const at = findFree(size, tables, room);
      const key = `new-${++seq.current}`;
      const tb: DraftTable = { key, name: nameFor(option === "booth" ? "B" : "T"), shape, ...size, ...at, capacity, sectionStaffId: null, openCheck: false };
      edit((ts) => [...ts, tb], key);
      return tb;
    },

    /**
     * Name, seats or waiter. A name keeps its prefix: one that doesn't start with the table's T or B is refused
     * (false), since crossing between table and booth is `setShape`'s job. A table with an open check keeps its name.
     */
    update(key: string, changes: Editable): boolean {
      const tb = find(key);
      if (!tb) return false;
      if (changes.name !== undefined && changes.name !== tb.name) {
        if (tb.openCheck || !samePrefix(tb.name, changes.name)) return false;
      }
      patch(key, (x) => ({ ...x, ...changes }));
      return true;
    },

    /**
     * Round / Square / Booth. Crossing between tables and booths renames to the next free number of the new prefix
     * (refused for a table with an open check). The size follows the new shape's preset for its seats.
     */
    setShape(key: string, option: ShapeOption) {
      const tb = find(key);
      if (!tb || !room || shapeOption(tb) === option) return;
      const prefix = option === "booth" ? "B" : "T";
      if (tb.name[0] !== prefix && tb.openCheck) return;
      const name = tb.name[0] === prefix ? tb.name : nameFor(prefix);
      const shape = option === "round" ? "round" : "rect";
      patch(key, (x) => clampInto({ ...x, name, shape, ...sizeFor(shape, x.capacity) }, room));
    },

    duplicate(key: string): DraftTable | null {
      const tb = find(key);
      if (!tb || !room) return null;
      const at = findFree(tb, tables, room, { x: tb.x + tb.w + GRID, y: tb.y });
      const copy: DraftTable = { ...tb, id: undefined, key: `new-${++seq.current}`, name: nameFor(tb.name.startsWith("B") ? "B" : "T"), ...at, openCheck: false };
      delete copy.id;
      edit((ts) => [...ts, copy], copy.key);
      return copy;
    },

    /** False (and nothing removed) for a table with an open check. */
    remove(key: string): boolean {
      const tb = find(key);
      if (!tb || tb.openCheck) return false;
      edit((ts) => ts.filter((x) => x.key !== key), state.selected === key ? null : undefined);
      return true;
    },

    discard() {
      if (!server) return;
      setProblems([]);
      setNotice(null);
      setState((s) => ({ ...s, tables: fromServer(server), selected: server.tables.some((x) => x.id === s.selected) ? s.selected : null }));
    },

    save() {
      if (!server) return;
      save.mutate({
        version: server.room.version,
        tables: tables.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          key: x.key,
          name: x.name,
          shape: x.shape,
          x: x.x,
          y: x.y,
          w: x.w,
          h: x.h,
          capacity: x.capacity,
          sectionStaffId: x.sectionStaffId,
        })),
      });
    },

    /**
     * Another manager saved this room: fetch their version and take it only if, when it arrives, this draft still
     * has nothing unsaved and no save in flight. Otherwise it is dropped; Save will then meet `409` and say so.
     */
    reloadIfClean() {
      if (!roomId || busy.current.dirty || busy.current.saving) return;
      const id = roomId;
      void api<LayoutView>(`/api/rooms/${id}/layout`)
        .then((view) => {
          if (busy.current.dirty || busy.current.saving) return;
          qc.setQueryData(layoutKey(id), view);
        })
        .catch(() => undefined);
    },
  };
}

export type LayoutDraft = ReturnType<typeof useLayoutDraft>;
