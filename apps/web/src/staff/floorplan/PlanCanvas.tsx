import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { byName } from "../floor/lib";
import { clampInto, GRID, guidesFor, snap } from "./geometry";
import type { DraftTable, LayoutRoom } from "./types";

export interface PlanCanvasProps {
  room: LayoutRoom;
  /** Localised room name for the canvas label. */
  roomLabel: string;
  tables: DraftTable[];
  selected: string | null;
  /** Problems per table key from the last refused save. */
  problems: ReadonlyMap<string, string[]>;
  /** Id of the visible keyboard hint. */
  hintId: string;
  onSelect: (key: string) => void;
  onMove: (key: string, x: number, y: number) => void;
  /** Returns false when the table can't be removed (open check). */
  onRemove: (key: string) => boolean;
}

const KEYS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** Pixels of pointer travel before a press becomes a drag (a tap only selects). */
const DRAG_SLOP = 3;

type Drag = { key: string; pointerId: number; startX: number; startY: number; origX: number; origY: number; moved: boolean };

/**
 * The room as an SVG at its own size (scaled down to fit) on a 16 px dot grid. Each table is a focusable button:
 * pointer drag with capture (mouse, pen, touch) snaps on the grid and shows alignment guides and an x/y readout;
 * arrow keys move one grid step, Shift + arrow four; Delete removes. Only the tables take `touch-action: none`, so
 * the page still scrolls from anywhere else on the canvas.
 */
export function PlanCanvas({ room, roomLabel, tables, selected, problems, hintId, onSelect, onMove, onRemove }: PlanCanvasProps) {
  const { t } = useTranslation();
  const dotsId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ key: string; x: number; y: number } | null>(null);
  const els = useRef(new Map<string, SVGGElement>());
  const focusNext = useRef<string | null>(null);
  const sorted = [...tables].sort(byName);

  // After a keyboard delete, focus the table that took its place in the tab order.
  useEffect(() => {
    if (focusNext.current === null) return;
    els.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const scale = () => {
    const w = svg.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? w / room.width : 1;
  };

  const onPointerDown = (e: PointerEvent<SVGGElement>, tb: DraftTable) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    onSelect(tb.key);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { key: tb.key, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: tb.x, origY: tb.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGGElement>, tb: DraftTable) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || d.key !== tb.key) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    d.moved = true;
    const s = scale();
    const at = clampInto({ ...tb, x: snap(d.origX + dx / s), y: snap(d.origY + dy / s) }, room);
    setLive({ key: tb.key, x: at.x, y: at.y });
  };
  const endDrag = (e: PointerEvent<SVGGElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (commit && d.moved && live && live.key === d.key && (live.x !== d.origX || live.y !== d.origY)) onMove(d.key, live.x, live.y);
    setLive(null);
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>, tb: DraftTable) => {
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      const step = e.shiftKey ? GRID * 4 : GRID;
      onMove(tb.key, snap(tb.x + dir[0] * step), snap(tb.y + dir[1] * step));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const i = sorted.findIndex((x) => x.key === tb.key);
      if (onRemove(tb.key)) focusNext.current = sorted[i + 1]?.key ?? sorted[i - 1]?.key ?? null;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(tb.key);
    }
  };

  const moving = live ? tables.find((x) => x.key === live.key) : undefined;
  const movingRect = moving && live ? { ...moving, x: live.x, y: live.y } : null;
  const guides = movingRect ? guidesFor(movingRect, tables.filter((x) => x.key !== movingRect.key)) : [];

  return (
    <div className="fp-scroll">
      <svg
        ref={svg}
        className="fp-svg"
        viewBox={`0 0 ${room.width} ${room.height}`}
        width={room.width}
        height={room.height}
        role="group"
        aria-label={t("floorPlan.canvas.label", { room: roomLabel })}
        aria-describedby={hintId}
      >
        <defs>
          <pattern id={dotsId} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1.1} className="fp-dot" />
          </pattern>
        </defs>
        <rect className="fp-floor" x={0} y={0} width={room.width} height={room.height} rx={10} aria-hidden="true" />
        <rect x={0} y={0} width={room.width} height={room.height} fill={`url(#${dotsId})`} aria-hidden="true" />
        {sorted.length === 0 && (
          <text className="fp-empty" x={room.width / 2} y={room.height / 2} textAnchor="middle">
            {t("floorPlan.canvas.empty")}
          </text>
        )}
        {moving && (
          <TableGlyph table={moving} className="fp-ghost" />
        )}
        {sorted.map((tb) => {
          const at = live?.key === tb.key ? { ...tb, x: live.x, y: live.y } : tb;
          const issues = problems.get(tb.key) ?? [];
          const parts = [
            t("floorPlan.table.label", { name: tb.name, seats: t("floorPlan.table.seats", { count: tb.capacity }), shape: t(`floorPlan.shape.${tb.name.startsWith("B") ? "booth" : tb.shape === "round" ? "round" : "square"}`), x: at.x, y: at.y }),
          ];
          if (tb.openCheck) parts.push(t("floorPlan.table.openCheck"));
          if (!tb.id) parts.push(t("floorPlan.table.new"));
          if (issues.length) parts.push(t("floorPlan.table.invalid", { problems: issues.join("; ") }));
          const cls = ["fp-tbl", tb.key === selected && "is-sel", !tb.id && "is-new", issues.length > 0 && "is-invalid", live?.key === tb.key && "is-dragging"]
            .filter(Boolean)
            .join(" ");
          return (
            <g
              key={tb.key}
              ref={(el) => {
                if (el) els.current.set(tb.key, el);
                else els.current.delete(tb.key);
              }}
              className={cls}
              role="button"
              tabIndex={0}
              aria-label={parts.join(", ")}
              aria-pressed={tb.key === selected}
              aria-invalid={issues.length > 0 ? true : undefined}
              transform={`translate(${at.x} ${at.y})`}
              onFocus={() => onSelect(tb.key)}
              onKeyDown={(e) => onKeyDown(e, tb)}
              onPointerDown={(e) => onPointerDown(e, tb)}
              onPointerMove={(e) => onPointerMove(e, tb)}
              onPointerUp={(e) => endDrag(e, true)}
              onPointerCancel={(e) => endDrag(e, false)}
            >
              <TableGlyph table={{ ...tb, x: 0, y: 0 }} />
              <text className="fp-no" x={tb.w / 2} y={tb.h / 2 - 2} textAnchor="middle" aria-hidden="true">{tb.name}</text>
              <text className="fp-m" x={tb.w / 2} y={tb.h / 2 + 12} textAnchor="middle" aria-hidden="true">{tb.capacity}</text>
              {issues.length > 0 && (
                <g className="fp-warn" transform={`translate(${tb.w - 6} -6)`} aria-hidden="true">
                  <circle r={8} />
                  <text y={4} textAnchor="middle">!</text>
                </g>
              )}
            </g>
          );
        })}
        {guides.map((g, i) =>
          g.x !== undefined ? (
            <line key={`x${i}`} className="fp-guide" x1={g.x} x2={g.x} y1={0} y2={room.height} aria-hidden="true" />
          ) : (
            <line key={`y${i}`} className="fp-guide" y1={g.y} y2={g.y} x1={0} x2={room.width} aria-hidden="true" />
          ),
        )}
        {movingRect && <Readout x={movingRect.x} y={movingRect.y} room={room} />}
      </svg>
    </div>
  );
}

function TableGlyph({ table, className = "fp-shape" }: { table: Pick<DraftTable, "shape" | "x" | "y" | "w" | "h">; className?: string }) {
  const { x, y, w, h } = table;
  return (
    <g aria-hidden="true">
      {table.shape === "round" ? (
        <>
          <ellipse className="fp-ring" cx={x + w / 2} cy={y + h / 2} rx={w / 2 + 4} ry={h / 2 + 4} />
          <ellipse className={className} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
        </>
      ) : (
        <>
          <rect className="fp-ring" x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={11} />
          <rect className={className} x={x} y={y} width={w} height={h} rx={8} />
        </>
      )}
    </g>
  );
}

/** "x 416 · y 256" above the moving table (below it at the top edge). */
function Readout({ x, y, room }: { x: number; y: number; room: LayoutRoom }) {
  const text = `x ${x} · y ${y}`;
  const w = text.length * 6.6 + 12;
  const left = Math.min(Math.max(0, x), room.width - w);
  const top = y >= 26 ? y - 24 : y + 4;
  return (
    <g className="fp-coord" transform={`translate(${left} ${top})`} aria-hidden="true">
      <rect width={w} height={18} rx={5} />
      <text x={6} y={13}>{text}</text>
    </g>
  );
}
