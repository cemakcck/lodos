import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { SCHEDULE_GROUPS } from "@lodos/shared";
import { FileDown, Plus, TriangleAlert } from "lucide-react";
import { useFormat } from "../../lib/format";
import { dayLong, dayShort, hoursText, pdfHref, span, weekRange } from "./lib";
import type { Cell, SchedulePerson, ShiftRow, WeekView } from "./types";

/** A shift on the move: by keyboard (M, arrows, Enter), by tap (Move in the sheet, then a cell) or by pointer drag. */
export interface Moving {
  shift: ShiftRow;
  target: Cell;
  via: "keys" | "tap" | "drag";
}

export interface GridProps {
  view: WeekView;
  /** Per shift id: its warnings, as text. */
  warningsOf: ReadonlyMap<string, string[]>;
  moving: Moving | null;
  onAdd: (person: SchedulePerson, day: string) => void;
  onOpen: (shift: ShiftRow) => void;
  onMoveStart: (shift: ShiftRow, via: Moving["via"]) => void;
  /** Point the move at a cell (null: the pointer is outside the grid). */
  onMoveTarget: (cell: Cell | null) => void;
  /** Arrow keys: step the target by days (dx) and people (dy). */
  onMoveStep: (dx: number, dy: number) => void;
  /** Drop on a cell; null cancels. */
  onMoveCommit: (cell: Cell | null) => void;
}

const same = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a.staffId === b.staffId && a.day === b.day;
/** Long-press before a touch drag starts, so a swipe still scrolls the grid. */
const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;

/** The cell under a point, ignoring the dragged block itself. */
function cellAt(x: number, y: number, dragged: Element): Cell | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (dragged.contains(el)) continue;
    const td = el.closest<HTMLElement>("[data-cell]");
    if (td) return { staffId: td.dataset.staff!, day: td.dataset.day! };
  }
  return null;
}

/**
 * The week as a table: people (grouped Floor / Kitchen / Bar / Managers) as row headers, days as column headers,
 * person totals on the right with a PDF link, day totals in the foot. Every cell has an add button (the whole cell
 * when empty); shifts are buttons that open the sheet, start a move with M, and drag with a pointer.
 */
export function Grid({ view, warningsOf, moving, onAdd, onOpen, onMoveStart, onMoveTarget, onMoveStep, onMoveCommit }: GridProps) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const byCell = new Map<string, ShiftRow[]>();
  for (const s of view.shifts) {
    const k = `${s.staffId}|${s.serviceDay}`;
    byCell.set(k, [...(byCell.get(k) ?? []), s]);
  }
  const grand = Object.values(view.totals.byDay).reduce((a, b) => a + b, 0);
  const cols = view.days.length + 2;

  return (
    <div className="sc-scroll">
      <table className="sc-grid">
        <caption className="sr-only">{t("schedule.caption", { range: weekRange(view.week, lang) })}</caption>
        <thead>
          <tr>
            <th scope="col" className="sc-corner">{t("schedule.col.person")}</th>
            {view.days.map((d) => {
              const { weekday, date } = dayShort(d, lang);
              return (
                <th key={d} scope="col" className="sc-day">
                  <span className="sc-wd">{weekday}</span> <span className="sc-dt font-mono">{date}</span>
                </th>
              );
            })}
            <th scope="col" className="sc-tot-h">{t("schedule.col.total")}</th>
          </tr>
        </thead>
        {SCHEDULE_GROUPS.map((g) => {
          const people = view.people.filter((p) => p.group === g);
          if (people.length === 0) return null;
          return (
            <tbody key={g}>
              <tr className="sc-group">
                <th scope="rowgroup" colSpan={cols}>{t(`schedule.group.${g}`)}</th>
              </tr>
              {people.map((p) => (
                <tr key={p.id} className={p.active ? undefined : "is-inactive"}>
                  <th scope="row" className="sc-person">
                    <span className="sc-name">{p.name}</span>
                    {!p.active && <span className="mg-tag">{t("schedule.inactive")}</span>}
                  </th>
                  {view.days.map((d) => {
                    const cell = { staffId: p.id, day: d };
                    const shifts = byCell.get(`${p.id}|${d}`) ?? [];
                    const target = moving && same(moving.target, cell);
                    const label = { name: p.name, day: dayLong(d, lang) };
                    return (
                      <td key={d} data-cell="" data-staff={p.id} data-day={d} className={`sc-cell ${target ? "is-target" : ""}`}>
                        {shifts.map((s) => (
                          <Block
                            key={s.id}
                            shift={s}
                            warnings={warningsOf.get(s.id) ?? []}
                            moving={moving?.shift.id === s.id ? moving : null}
                            anyMoving={!!moving}
                            onOpen={onOpen}
                            onMoveStart={onMoveStart}
                            onMoveTarget={onMoveTarget}
                            onMoveStep={onMoveStep}
                            onMoveCommit={onMoveCommit}
                          />
                        ))}
                        <button
                          type="button"
                          className={`sc-add ${shifts.length === 0 ? "is-empty" : ""}`}
                          aria-label={moving ? t("schedule.moveHere", label) : t("schedule.addFor", label)}
                          onClick={() => (moving ? onMoveCommit(cell) : onAdd(p, d))}
                        >
                          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </td>
                    );
                  })}
                  <td className="sc-total">
                    <span className="font-mono">{hoursText(t, view.totals.byPerson[p.id] ?? 0, lang)}</span>
                    <a className="staff-icon-btn sc-pdf" href={pdfHref.person(p.id, view.week, lang)} download aria-label={t("schedule.pdf.person", { name: p.name })}>
                      <FileDown size={15} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <th scope="row">{t("schedule.dayTotal")}</th>
            {view.days.map((d) => (
              <td key={d} className="font-mono">{hoursText(t, view.totals.byDay[d] ?? 0, lang)}</td>
            ))}
            <td className="font-mono sc-grand">{hoursText(t, grand, lang)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface BlockProps {
  shift: ShiftRow;
  warnings: string[];
  /** This block's move, if it is the one moving. */
  moving: Moving | null;
  anyMoving: boolean;
  onOpen: GridProps["onOpen"];
  onMoveStart: GridProps["onMoveStart"];
  onMoveTarget: GridProps["onMoveTarget"];
  onMoveStep: GridProps["onMoveStep"];
  onMoveCommit: GridProps["onMoveCommit"];
}

type Press = { id: number; x: number; y: number; touch: boolean; active: boolean; timer?: ReturnType<typeof setTimeout> };

/**
 * One shift. Mouse and pen drag after a 4 px move; touch drags after a 350 ms long-press (a swipe before that
 * scrolls as usual), and once dragging, the page's touchmove is cancelled so the grid does not scroll under it.
 */
function Block({ shift, warnings, moving, anyMoving, onOpen, onMoveStart, onMoveTarget, onMoveStep, onMoveCommit }: BlockProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const press = useRef<Press | null>(null);
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragging = offset !== null;

  useEffect(() => {
    if (!dragging) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, [dragging]);

  // A move ended elsewhere (Escape, a commit): drop any drag in progress.
  useEffect(() => {
    if (!moving && press.current?.active) {
      swallowClick.current = true; // the pointerup's click must not open the sheet
      press.current = null;
      setOffset(null);
    }
  }, [moving]);

  const clear = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
    setOffset(null);
  };

  const begin = () => {
    const p = press.current;
    const el = ref.current;
    if (!p || !el) return;
    p.active = true;
    try {
      el.setPointerCapture(p.id);
    } catch {
      /* the pointer is already gone */
    }
    setOffset({ dx: 0, dy: 0 });
    onMoveStart(shift, "drag");
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    swallowClick.current = false; // a touch drag ends without a click, so reset here
    if (e.button !== 0 || anyMoving) return;
    const touch = e.pointerType === "touch";
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, active: false };
    if (touch) press.current.timer = setTimeout(begin, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.active) {
      const far = Math.hypot(dx, dy) > (p.touch ? TOUCH_SLOP : MOUSE_SLOP);
      if (!far) return;
      if (p.touch) return clear(); // a swipe: let the browser scroll
      begin();
    }
    setOffset({ dx, dy });
    onMoveTarget(cellAt(e.clientX, e.clientY, e.currentTarget));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (p.active) {
      swallowClick.current = true;
      onMoveCommit(cellAt(e.clientX, e.clientY, e.currentTarget));
    }
    clear();
  };

  const onPointerCancel = () => {
    if (press.current?.active) onMoveCommit(null);
    clear();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (moving) {
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const s = step[e.key];
      if (s) {
        e.preventDefault();
        onMoveStep(s[0], s[1]);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onMoveCommit(moving.target);
      }
      return;
    }
    if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey && !anyMoving) {
      e.preventDefault();
      onMoveStart(shift, "keys");
    }
  };

  const onClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (anyMoving) onMoveCommit(moving ? null : { staffId: shift.staffId, day: shift.serviceDay });
    else onOpen(shift);
  };

  const area = t(`schedule.area.${shift.area}`);

  return (
    <button
      ref={ref}
      type="button"
      data-shift-id={shift.id}
      className={`sc-block ${warnings.length ? "is-warn" : ""} ${moving ? "is-moving" : ""} ${dragging ? "is-dragging" : ""}`}
      style={offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined}
      aria-describedby="sc-move-hint"
      aria-pressed={moving ? true : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => press.current?.touch && e.preventDefault()}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {/* The visible text is the accessible name (WCAG 2.5.3); the warning is added as hidden text. */}
      <span className="sc-time font-mono">{span(shift.start, shift.end)}</span>{" "}
      <span className="sc-area">
        {area}
        {shift.note && <Fragment> · {shift.note}</Fragment>}
      </span>
      {warnings.length > 0 && (
        <>
          <TriangleAlert className="sc-warn-ic" size={13} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">. {t("schedule.warningPrefix", { text: warnings.join("; ") })}</span>
        </>
      )}
    </button>
  );
}
