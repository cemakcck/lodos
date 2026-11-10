import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { hm, since, tableLabel } from "./lib";
import type { FloorTable } from "./types";

export interface TableShapeProps {
  table: FloorTable;
  /** Server time (snapshot `now` plus the held offset), never the device clock. */
  now: Date;
  /** Layout units to pixels: canvas fit times the visual zoom. */
  scale: number;
  selected: boolean;
  /** In my section: a subtle plum underline under the name. */
  mine: boolean;
  /** "My tables" is on and this table is in another section. */
  dimmed: boolean;
  onSelect: (id: string) => void;
}

/** Below this the name and "covers · time" no longer fit; the position still scales, the shape keeps a floor. */
const MIN = { round: 60, rect: { w: 64, h: 44 } };

/**
 * One table on the floor canvas: a button with its name, `covers · elapsed` (or capacity when free) and a status dot.
 * Free is dashed, seated plum tint, food ready black, calling a red ring and dot, bill amber. The colour is always
 * paired with the state word in the accessible name.
 */
export function TableShape({ table, now, scale, selected, mine, dimmed, onSelect }: TableShapeProps) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const round = table.shape === "round";
  const w = round ? Math.max(table.w * scale, MIN.round) : Math.max(table.w * scale, MIN.rect.w);
  const h = round ? Math.max(table.h * scale, MIN.round) : Math.max(table.h * scale, MIN.rect.h);
  // Keep the centre where the layout put it when the floor size kicks in.
  const left = table.x * scale - (w - table.w * scale) / 2;
  const top = table.y * scale - (h - table.h * scale) / 2;
  const free = table.state === "free";
  const meta = free ? String(table.capacity) : `${table.covers ?? "–"} · ${hm(since(table.seatedAt, now), lang)}`;
  const dot = table.state === "seated" || table.state === "calling" || table.state === "bill";
  const cls = ["fl-tbl", round ? "is-round" : "is-rect", `is-${table.state}`, selected && "is-sel", mine && "is-mine", dimmed && "is-dim"]
    .filter(Boolean)
    .join(" ");

  const label = tableLabel(table, now, t, mine);
  const spokenRest = label.startsWith(table.name) ? label.slice(table.name.length) : `, ${label}`;
  return (
    <button
      type="button"
      className={cls}
      style={{ left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` }}
      aria-pressed={selected}
      onClick={() => onSelect(table.id)}
    >
      {/* The name comes from the content: the visible table name, then the spoken state (WCAG 2.5.3, label in
          name). The meta line is the visual shorthand of the same facts ("4 · 1h 12m"). */}
      {dot && <span className="st" aria-hidden="true" />}
      <span className="no">
        {table.name}
        <span className="sr-only">{spokenRest}</span>
      </span>
      <span className="m" aria-hidden="true">{meta}</span>
    </button>
  );
}
