import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, FileDown, LayoutTemplate, TriangleAlert, X } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { usePopover } from "../../lib/usePopover";
import { Shell } from "../Shell";
import { Grid, type Moving } from "./Grid";
import { ShiftSheet } from "./ShiftSheet";
import { Templates } from "./Templates";
import { dayLong, pdfHref, shiftError, span, warningText } from "./lib";
import { WeekPicker } from "./WeekPicker";
import { refreshShifts, useTemplates, useWeek } from "./queries";
import { weekKey, type Cell, type SchedulePerson, type ShiftRow, type WeekView } from "./types";

type Sheet = { person: SchedulePerson; day: string; shift?: ShiftRow } | null;

/**
 * `/staff/schedule` (manager, spec §6.2): the week grid with a week picker, Copy last week, Templates and the PDF
 * menu. Changes save at once. Moving a shift works by pointer drag, by keyboard (M, arrows, Enter, Esc) and by tap
 * (Move in the sheet, then a cell); a polite live region names the target cell.
 */
export function Schedule() {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const week = params.get("week");
  const q = useWeek(week);
  const templates = useTemplates();
  const view = q.data;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const refocus = useRef<string | null>(null);

  const go = (w: string | null) => {
    setMoving(null);
    setStatus("");
    setFailure(null);
    setParams(w ? { week: w } : {});
  };

  const people = view?.people ?? [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";

  const warningsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!view) return m;
    for (const w of view.warnings) {
      const text = warningText(t, w, view, lang);
      for (const id of w.shiftIds) m.set(id, [...(m.get(id) ?? []), text]);
    }
    return m;
  }, [view, t, lang]);

  const copy = useMutation({
    mutationFn: (w: string) => api<{ copied: number; skipped: number }>("/api/shifts/copy-last-week", { method: "POST", body: JSON.stringify({ week: w }) }),
    onSuccess: (r) => {
      refreshShifts(qc);
      setStatus(t("schedule.status.copied", { copied: r.copied, skipped: r.skipped }));
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });

  const move = useMutation({
    mutationFn: ({ shift, to }: { shift: ShiftRow; to: Cell }) =>
      api(`/api/shifts/${shift.id}`, { method: "PATCH", body: JSON.stringify({ staffId: to.staffId, serviceDay: to.day }) }),
    onMutate: async ({ shift, to }) => {
      const key = weekKey(week);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<WeekView>(key);
      if (prev) {
        qc.setQueryData<WeekView>(key, {
          ...prev,
          shifts: prev.shifts.map((s) => (s.id === shift.id ? { ...s, staffId: to.staffId, serviceDay: to.day } : s)),
        });
      }
      return { prev };
    },
    onSuccess: (_r, { shift, to }) =>
      setStatus(t("schedule.status.moved", { span: span(shift.start, shift.end), name: nameOf(to.staffId), day: dayLong(to.day, lang) })),
    onError: (e, { to }, ctx) => {
      if (ctx?.prev) qc.setQueryData(weekKey(week), ctx.prev);
      setFailure(shiftError(t, e, nameOf(to.staffId)));
    },
    onSettled: () => refreshShifts(qc),
  });

  const startMove = (shift: ShiftRow, via: Moving["via"]) => {
    setStatus("");
    setFailure(null);
    setMoving({ shift, target: { staffId: shift.staffId, day: shift.serviceDay }, via });
  };

  const commit = (to: Cell | null) => {
    const m = moving;
    setMoving(null);
    if (!m) return;
    refocus.current = m.shift.id;
    if (!to || (to.staffId === m.shift.staffId && to.day === m.shift.serviceDay)) return;
    move.mutate({ shift: m.shift, to });
  };

  const step = (dx: number, dy: number) =>
    setMoving((m) => {
      if (!m || !view) return m;
      const di = Math.min(view.days.length - 1, Math.max(0, view.days.indexOf(m.target.day) + dx));
      const pi = Math.min(people.length - 1, Math.max(0, people.findIndex((p) => p.id === m.target.staffId) + dy));
      return { ...m, target: { staffId: people[pi]!.id, day: view.days[di]! } };
    });

  // Escape cancels a move wherever focus is.
  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      refocus.current = moving.shift.id;
      setMoving(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moving]);

  // Keep the keyboard target on screen.
  const targetKey = moving ? `${moving.target.staffId}|${moving.target.day}` : null;
  useEffect(() => {
    if (!targetKey || moving?.via !== "keys") return;
    const [staffId, day] = targetKey.split("|");
    document.querySelector(`[data-cell][data-staff="${staffId}"][data-day="${day}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [targetKey, moving?.via]);

  // After a move the block re-mounts in its new cell: give it focus back.
  useLayoutEffect(() => {
    if (moving || !refocus.current) return;
    const el = document.querySelector<HTMLElement>(`[data-shift-id="${refocus.current}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    if (el || !move.isPending) refocus.current = null;
  });

  const moveText = moving
    ? t(moving.via === "keys" ? "schedule.move.keys" : "schedule.move.tap", {
        span: span(moving.shift.start, moving.shift.end),
        target: `${nameOf(moving.target.staffId)}, ${dayLong(moving.target.day, lang)}`,
      })
    : "";

  const sheetPerson = sheet?.person;
  const actions = view && (
    <>
      <button type="button" className="staff-btn" disabled={copy.isPending} onClick={() => { setStatus(""); setFailure(null); copy.mutate(view.week); }}>
        <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("schedule.copyLastWeek")}
      </button>
      <button type="button" className="staff-btn" onClick={() => setEditingTemplates(true)}>
        <LayoutTemplate size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("schedule.templates.button")}
      </button>
      <PdfMenu week={view.week} />
    </>
  );

  const toolbar = view && <WeekPicker week={view.week} isCurrent={week === null} onGo={go} />;

  return (
    <Shell title={t("schedule.title")} toolbar={toolbar} actions={actions} clock={false}>
      {!view ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("schedule.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="sc-page">
          <p role="status" className="mg-status">{status}</p>
          {failure && <p role="alert" className="staff-notice">{failure}</p>}
          {view.warnings.length > 0 && (
            <section className="sc-warnings" aria-labelledby="sc-warnings-h">
              <h2 id="sc-warnings-h" className="sc-warnings-h">
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                {t("schedule.warningsTitle", { count: view.warnings.length })}
              </h2>
              <ul>
                {view.warnings.map((w, i) => (
                  <li key={`${w.kind}-${w.staffId}-${i}`}>{`${nameOf(w.staffId)}: ${warningText(t, w, view, lang)}`}</li>
                ))}
              </ul>
            </section>
          )}
          <p id="sc-move-hint" className="sr-only">{t("schedule.move.hint")}</p>
          <Grid
            view={view}
            warningsOf={warningsOf}
            moving={moving}
            onAdd={(person, day) => { setStatus(""); setFailure(null); setSheet({ person, day }); }}
            onOpen={(shift) => {
              const person = people.find((p) => p.id === shift.staffId);
              if (person) { setStatus(""); setFailure(null); setSheet({ person, day: shift.serviceDay, shift }); }
            }}
            onMoveStart={startMove}
            onMoveTarget={(cell) => setMoving((m) => (m && cell ? { ...m, target: cell } : m))}
            onMoveStep={step}
            onMoveCommit={commit}
          />
          {/* After the grid and sticky, so showing it never shifts the cells under a drag. */}
          <div className={`sc-movebar ${moving ? "is-on" : ""}`}>
            <p role="status" aria-label={t("schedule.move.region")} className="sc-movebar-t">{moveText}</p>
            {moving && (
              <button type="button" className="staff-btn" onClick={() => { refocus.current = moving.shift.id; setMoving(null); }}>
                <X size={15} strokeWidth={1.75} aria-hidden="true" />
                {t("schedule.move.cancel")}
              </button>
            )}
          </div>
        </div>
      )}
      {sheet && sheetPerson && (
        <ShiftSheet
          person={sheetPerson}
          day={sheet.day}
          shift={sheet.shift}
          templates={templates.data ?? []}
          onClose={() => setSheet(null)}
          onDone={(m) => { setSheet(null); setStatus(m); }}
          onMove={(shift) => { setSheet(null); startMove(shift, "tap"); }}
        />
      )}
      {editingTemplates && <Templates templates={templates.data ?? []} onClose={() => setEditingTemplates(false)} />}
    </Shell>
  );
}

/** Week roster and All personal PDFs, as plain download links in the UI language. */
function PdfMenu({ week }: { week: string }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const pop = usePopover();
  return (
    <div className="relative">
      <button type="button" className="staff-btn" {...pop.triggerProps}>
        <FileDown size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("schedule.pdf.button")}
      </button>
      {pop.open && (
        <div {...pop.panelProps} className="staff-popover absolute right-0 top-[calc(100%+6px)] z-30 w-[220px] p-1.5">
          <a className="staff-menu-item" href={pdfHref.week(week, lang)} download onClick={pop.close}>{t("schedule.pdf.week")}</a>
          <a className="staff-menu-item" href={pdfHref.people(week, lang)} download onClick={pop.close}>{t("schedule.pdf.people")}</a>
        </div>
      )}
    </div>
  );
}
