import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { TableShape } from "./TableShape";
import { byName, roomName } from "./lib";
import type { FloorTable, TableState } from "./types";

/** The seeded layouts live in an ~800-unit-wide plan; the canvas scales that to its width. */
export const PLAN_WIDTH = 800;
const PLAN_MIN_HEIGHT = 420;
/** Room under the lowest table for the legend and zoom overlays. */
const PLAN_FOOT = 70;
export const ZOOMS = [75, 90, 100, 110, 125] as const;

export interface FloorCanvasProps {
  room: { id: string; name: string };
  /** The room's tables (any order; drawn and tabbed by name). */
  tables: FloorTable[];
  now: Date;
  selectedId: string | null;
  myId: string | null;
  myOnly: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  onSelect: (id: string) => void;
  /** "+ New order" is waiting for a table tap. */
  picking: boolean;
}

/** Width of an element, tracked; falls back to the plan width where there is no layout (tests). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PLAN_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const LEGEND: readonly TableState[] = ["free", "seated", "ready", "calling", "bill"];

/**
 * The room plan: tables at their API x/y/w/h scaled to fit the canvas width, on a dotted grid with the room's fixed
 * features (mirror wall, bars, railing). Zoom (75–125%) is visual only. Legend and zoom sit over the bottom edge.
 */
export function FloorCanvas({ room, tables, now, selectedId, myId, myOnly, zoom, onZoom, onSelect, picking }: FloorCanvasProps) {
  const { t } = useTranslation();
  const { ref, width } = useWidth();
  const scale = (width / PLAN_WIDTH) * (zoom / 100);
  const s = (n: number) => `${n * scale}px`;
  const planHeight = Math.max(PLAN_MIN_HEIGHT, ...tables.map((tb) => tb.y + tb.h + PLAN_FOOT));
  const sorted = [...tables].sort(byName);
  const kind = room.name.toLowerCase();
  const zi = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);

  return (
    <div className={`fl-canvas ${picking ? "is-picking" : ""}`}>
      <div className="fl-scroll" ref={ref}>
        <div
          className="fl-plane"
          role="group"
          aria-label={t("floor.canvas.label", { room: roomName(room.name, t) })}
          style={{ width: s(PLAN_WIDTH), height: s(planHeight), backgroundSize: `${16 * scale}px ${16 * scale}px` }}
        >
          {kind === "salon" && (
            <>
              <div className="fl-mirror" style={{ left: s(16), width: s(688), top: s(14), height: Math.max(4, 6 * scale) }} aria-hidden="true" />
              <span className="fl-zone" style={{ left: s(16), top: s(26) }} aria-hidden="true">
                {t("floor.decor.mirror")}
              </span>
              <div className="fl-counter" style={{ left: s(720), width: s(64), top: s(14), height: s(planHeight - 14 - PLAN_FOOT) }} aria-hidden="true" />
              <span className="fl-zone is-vertical" style={{ left: s(744), top: s(26) }} aria-hidden="true">
                {t("floor.decor.serviceBar")}
              </span>
            </>
          )}
          {kind === "bar" && (
            <>
              <div className="fl-counter" style={{ left: s(16), width: s(768), top: s(14), height: s(44) }} aria-hidden="true" />
              <span className="fl-zone" style={{ left: s(28), top: s(66) }} aria-hidden="true">
                {t("floor.decor.barCounter")}
              </span>
            </>
          )}
          {kind === "terrace" && (
            <>
              <div className="fl-railing" style={{ left: s(16), width: s(768), top: s(18) }} aria-hidden="true" />
              <span className="fl-zone" style={{ left: s(16), top: s(28) }} aria-hidden="true">
                {t("floor.decor.railing")}
              </span>
            </>
          )}
          {sorted.length === 0 && <p className="fl-hint p-4">{t("floor.canvas.empty")}</p>}
          {sorted.map((tb) => {
            const mine = myId !== null && tb.sectionStaffId === myId;
            return (
              <TableShape
                key={tb.id}
                table={tb}
                now={now}
                scale={scale}
                selected={tb.id === selectedId}
                mine={mine}
                dimmed={myOnly && !mine}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>

      <ul className="fl-legend" aria-label={t("floor.canvas.legend")}>
        {LEGEND.map((st) => (
          <li key={st}>
            <i className={`is-${st}`} aria-hidden="true" />
            {t(`floor.state.label.${st}`)}
          </li>
        ))}
      </ul>
      <div className="fl-zoom" role="group" aria-label={t("floor.canvas.zoomValue", { pct: zoom })}>
        <button type="button" aria-label={t("floor.canvas.zoomOut")} disabled={zi <= 0} onClick={() => onZoom(ZOOMS[zi - 1]!)}>
          <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="is-value font-mono" aria-label={t("floor.canvas.zoomReset", { pct: zoom })} onClick={() => onZoom(100)}>
          {t("floor.canvas.zoomValue", { pct: zoom })}
        </button>
        <button type="button" aria-label={t("floor.canvas.zoomIn")} disabled={zi >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[zi + 1]!)}>
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
