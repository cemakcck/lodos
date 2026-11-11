import { useId, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Info, Lock, Minus, Plus, QrCode, Trash2 } from "lucide-react";
import { TABLE_CAPACITY_MAX, TABLE_CAPACITY_MIN, TABLE_NAME_RE } from "@lodos/shared";
import { byName } from "../floor/lib";
import { clampInto, GRID, snap } from "./geometry";
import { samePrefix, shapeOption, type LayoutDraft } from "./useLayoutDraft";
import type { DraftTable, ShapeOption } from "./types";

const SHAPES: readonly ShapeOption[] = ["round", "square", "booth"];
const normalise = (s: string) => s.trim().toUpperCase();

export interface InspectorProps {
  draft: LayoutDraft;
  table: DraftTable;
  roomLabel: string;
  /** Active waiters for the section select. */
  waiters: { id: string; name: string }[];
  /** Everyone's names, for a stored section whose person is no longer a waiter. */
  nameOf: (id: string) => string | null;
  announce: (text: string) => void;
  /** Moves focus to a table on the canvas (the copy after Duplicate, the next table after Delete). */
  focusTable: (key: string | null) => void;
}

/**
 * The selected table: name, shape (Round / Square / Booth), seats 1–12, waiter, position nudges (the tap
 * alternative to dragging), Duplicate, Delete and its QR code. A table with an open check can still move; the
 * controls it can't use are disabled and point at the reason.
 */
export function Inspector({ draft, table, roomLabel, waiters, nameOf, announce, focusTable }: InspectorProps) {
  const { t } = useTranslation();
  const id = useId();
  const reasonId = `${id}-reason`;
  const nameErrId = `${id}-name-err`;
  const locked = table.openCheck;
  const option = shapeOption(table);
  // The field keeps what was typed (shown upper case by CSS) so the caret never jumps; the draft gets the
  // normalised name. A typed name with the other prefix is not applied; Shape crosses between table and booth.
  const [text, setText] = useState(table.name);
  const [shownName, setShownName] = useState(table.name);
  if (shownName !== table.name) {
    // Renamed from elsewhere (Shape → Booth): show the new name unless it is what is being typed.
    setShownName(table.name);
    if (normalise(text) !== table.name) setText(table.name);
  }
  const typed = normalise(text);
  const crossed = typed !== table.name && typed.length > 0 && !samePrefix(table.name, typed);
  const onName = (value: string) => {
    setText(value);
    draft.update(table.key, { name: normalise(value) });
  };
  const nameError = crossed
    ? t("floorPlan.inspector.namePrefix")
    : typed.length === 0 || !TABLE_NAME_RE.test(table.name)
    ? t("floorPlan.inspector.nameInvalid")
    : draft.tables.some((x) => x.key !== table.key && x.name === table.name)
      ? t("floorPlan.inspector.nameTaken", { name: table.name })
      : null;
  const stored = table.sectionStaffId;
  const strayWaiter = stored !== null && !waiters.some((w) => w.id === stored);

  const nudge = (dx: number, dy: number) => {
    if (!draft.room) return;
    // Only the axis moved along snaps (as with the arrow keys on the canvas).
    const at = clampInto({ ...table, x: dx ? snap(table.x + dx * GRID) : table.x, y: dy ? snap(table.y + dy * GRID) : table.y }, draft.room);
    if (at.x === table.x && at.y === table.y) return; // against the edge: nothing moved, nothing to announce
    draft.move(table.key, at.x, at.y);
    announce(t("floorPlan.moved", { name: table.name, x: at.x, y: at.y }));
  };

  return (
    <aside className="pp-panel fp-panel" aria-label={t("floorPlan.inspector.label", { name: table.name })}>
      <div className="pp-ph">
        <h2 className="pp-ph-title font-mono">{table.name}</h2>
        <span className="staff-label">{roomLabel}</span>
        <span className="staff-grow" />
        {locked && <span className="fp-pill">{t("floorPlan.inspector.openCheck")}</span>}
      </div>

      <div className="pp-ps fp-fields">
        <div className="fp-field">
          <label htmlFor={`${id}-name`}>{t("floorPlan.inspector.name")}</label>
          <span className="fp-name-wrap">
            <input
              id={`${id}-name`}
              className="mg-input font-mono fp-name"
              value={text}
              readOnly={locked}
              maxLength={4}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={[locked && reasonId, nameError && nameErrId].filter(Boolean).join(" ") || undefined}
              onChange={(e) => onName(e.target.value)}
              onBlur={() => setText(table.name)}
            />
            {locked && <Lock size={14} strokeWidth={1.75} aria-hidden="true" className="fp-lock" />}
          </span>
        </div>
        {nameError && <p id={nameErrId} className="fp-err">{nameError}</p>}

        <div className="fp-field">
          <span id={`${id}-shape`}>{t("floorPlan.inspector.shape")}</span>
          <div className="staff-seg" role="group" aria-labelledby={`${id}-shape`}>
            {SHAPES.map((s) => {
              const crossesPrefix = (s === "booth") !== (option === "booth");
              const disabled = locked && crossesPrefix;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={option === s}
                  disabled={disabled}
                  aria-describedby={disabled ? reasonId : undefined}
                  onClick={() => draft.setShape(table.key, s)}
                >
                  {t(`floorPlan.shape.${s}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="fp-field">
          <span id={`${id}-seats`}>{t("floorPlan.inspector.seats")}</span>
          <div className="fp-step" role="group" aria-labelledby={`${id}-seats`}>
            <button
              type="button"
              aria-label={t("floorPlan.inspector.fewer")}
              disabled={table.capacity <= TABLE_CAPACITY_MIN}
              onClick={() => draft.update(table.key, { capacity: table.capacity - 1 })}
            >
              <Minus size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <output className="font-mono" aria-live="polite">{table.capacity}</output>
            <button
              type="button"
              aria-label={t("floorPlan.inspector.more")}
              disabled={table.capacity >= TABLE_CAPACITY_MAX}
              onClick={() => draft.update(table.key, { capacity: table.capacity + 1 })}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="fp-field">
          <label htmlFor={`${id}-waiter`}>{t("floorPlan.inspector.waiter")}</label>
          <select
            id={`${id}-waiter`}
            className="mg-input fp-select"
            value={stored ?? ""}
            onChange={(e) => draft.update(table.key, { sectionStaffId: e.target.value || null })}
          >
            <option value="">{t("floorPlan.inspector.noWaiter")}</option>
            {waiters.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
            {strayWaiter && (
              <option value={stored}>{t("floorPlan.inspector.formerWaiter", { name: nameOf(stored) ?? "—" })}</option>
            )}
          </select>
        </div>

        <div className="fp-field">
          <span id={`${id}-pos`}>{t("floorPlan.inspector.position")}</span>
          <div className="fp-pos">
            <span className="font-mono fp-xy">x {table.x} · y {table.y}</span>
            <div className="fp-nudge" role="group" aria-labelledby={`${id}-pos`}>
              <button type="button" aria-label={t("floorPlan.inspector.moveLeft")} onClick={() => nudge(-1, 0)}>
                <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("floorPlan.inspector.moveUp")} onClick={() => nudge(0, -1)}>
                <ArrowUp size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("floorPlan.inspector.moveDown")} onClick={() => nudge(0, 1)}>
                <ArrowDown size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button type="button" aria-label={t("floorPlan.inspector.moveRight")} onClick={() => nudge(1, 0)}>
                <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {locked && (
        <p className="fp-warnbox" id={reasonId}>
          <Info size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>{t("floorPlan.inspector.openCheckReason")}</span>
        </p>
      )}

      <div className="pp-pf fp-pf">
        <button
          type="button"
          className="staff-btn"
          onClick={() => {
            const copy = draft.duplicate(table.key);
            if (!copy) return;
            announce(t("floorPlan.duplicated", { name: table.name, copy: copy.name }));
            focusTable(copy.key);
          }}
        >
          <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
          {t("floorPlan.inspector.duplicate")}
        </button>
        <button
          type="button"
          className="staff-btn"
          disabled={locked}
          aria-describedby={locked ? reasonId : undefined}
          onClick={() => {
            // The button goes with the table: focus the next table in name order (as the Delete key does).
            const sorted = [...draft.tables].sort(byName);
            const i = sorted.findIndex((x) => x.key === table.key);
            const next = sorted[i + 1]?.key ?? sorted[i - 1]?.key ?? null;
            if (!draft.remove(table.key)) return;
            announce(t("floorPlan.removed", { name: table.name }));
            focusTable(next);
          }}
        >
          <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
          {t("floorPlan.inspector.delete")}
        </button>
        {table.id ? (
          <Link to={`/staff/tables/qr?table=${table.id}`} className="staff-btn fp-qr">
            <QrCode size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("floorPlan.inspector.qr")}
          </Link>
        ) : (
          <p className="mg-hint fp-qr">{t("floorPlan.inspector.qrAfterSave")}</p>
        )}
      </div>
    </aside>
  );
}
