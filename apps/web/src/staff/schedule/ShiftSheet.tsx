import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clockSpanMinutes, SHIFT_AREAS, type ShiftArea } from "@lodos/shared";
import { Move, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { dayLong, DEFAULT_AREA, hoursText, shiftError, span, tooLong } from "./lib";
import { refreshShifts } from "./queries";
import type { SchedulePerson, ShiftRow, ShiftTemplate } from "./types";

export interface ShiftSheetProps {
  person: SchedulePerson;
  day: string;
  /** The shift being edited; absent for a new one. */
  shift?: ShiftRow;
  templates: readonly ShiftTemplate[];
  onClose: () => void;
  /** After a save or delete, with the status message. */
  onDone: (message: string) => void;
  /** "Move": the tap/keyboard equivalent of dragging this shift. */
  onMove?: (shift: ShiftRow) => void;
}

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Add or edit one shift, in the staff Dialog: template chips or start/end times, area, note; Save, and for an
 * existing shift Delete and Move. A shift that ends at or before its start ends the next day.
 */
export function ShiftSheet({ person, day, shift, templates, onClose, onDone, onMove }: ShiftSheetProps) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const id = useId();
  const [start, setStart] = useState(shift?.start ?? "");
  const [end, setEnd] = useState(shift?.end ?? "");
  const [area, setArea] = useState<ShiftArea>(shift?.area ?? DEFAULT_AREA[person.group]);
  const [note, setNote] = useState(shift?.note ?? "");
  const [failure, setFailure] = useState<string | null>(null);

  const valid = CLOCK_RE.test(start) && CLOCK_RE.test(end);
  const length = valid ? clockSpanMinutes(start, end) : 0;

  const save = useMutation({
    mutationFn: () => {
      const body = { start, end, area, note: note.trim() || null };
      return shift
        ? api(`/api/shifts/${shift.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api("/api/shifts", { method: "POST", body: JSON.stringify({ staffId: person.id, serviceDay: day, ...body }) });
    },
    onSuccess: () => {
      refreshShifts(qc);
      onDone(t(shift ? "schedule.status.saved" : "schedule.status.added", { name: person.name, span: span(start, end) }));
    },
    onError: (e) => setFailure(shiftError(t, e, person.name)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/shifts/${shift!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refreshShifts(qc);
      onDone(t("schedule.status.deleted", { name: person.name, span: span(shift!.start, shift!.end) }));
    },
    onError: (e) => setFailure(shiftError(t, e, person.name)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    if (!valid) return setFailure(t("schedule.sheet.timesRequired"));
    if (tooLong(start, end)) return setFailure(t("errors.shift_too_long"));
    save.mutate();
  };

  const pick = (tp: ShiftTemplate) => {
    setStart(tp.start);
    setEnd(tp.end);
    setArea(tp.area);
  };
  const busy = save.isPending || remove.isPending;

  return (
    <Dialog
      title={t(shift ? "schedule.sheet.editTitle" : "schedule.sheet.newTitle")}
      onClose={onClose}
      width={480}
      footer={
        <div className="sc-sheet-f">
          {shift && (
            <>
              <button type="button" className="staff-btn" disabled={busy} onClick={() => remove.mutate()}>
                <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                {t("schedule.sheet.delete")}
              </button>
              {onMove && (
                <button type="button" className="staff-btn" disabled={busy} onClick={() => onMove(shift)}>
                  <Move size={15} strokeWidth={1.75} aria-hidden="true" />
                  {t("schedule.sheet.move")}
                </button>
              )}
            </>
          )}
          <div className="staff-grow" />
          <button type="button" className="staff-btn" onClick={onClose}>{t("schedule.sheet.cancel")}</button>
          <button type="submit" form={`${id}-form`} className="staff-btn primary" disabled={busy}>{t("schedule.sheet.save")}</button>
        </div>
      }
    >
      <form id={`${id}-form`} className="mg-form sc-sheet" onSubmit={submit} noValidate>
        <p className="sc-sheet-who">
          {person.name} · {dayLong(day, lang)}
        </p>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}

        {templates.length > 0 && (
          <div className="mg-field">
            <p className="sc-flabel" id={`${id}-tpl`}>{t("schedule.sheet.templates")}</p>
            <div className="sc-chips" role="group" aria-labelledby={`${id}-tpl`}>
              {templates.map((tp) => {
                const on = tp.start === start && tp.end === end && tp.area === area;
                return (
                  <button key={tp.id} type="button" className="sc-chip" aria-pressed={on} onClick={() => pick(tp)}>
                    <b>{tp.name}</b>
                    <span className="font-mono">{span(tp.start, tp.end)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="sc-times">
          <div className="mg-field">
            <label htmlFor={`${id}-start`}>{t("schedule.sheet.start")}</label>
            <input id={`${id}-start`} type="time" className="mg-input font-mono" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div className="mg-field">
            <label htmlFor={`${id}-end`}>{t("schedule.sheet.end")}</label>
            <input id={`${id}-end`} type="time" className="mg-input font-mono" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </div>
          <p className="sc-len" aria-live="polite">
            {valid && (
              <>
                {hoursText(t, length, lang)}
                {end <= start && <span className="mg-muted"> · {t("schedule.sheet.nextDay")}</span>}
              </>
            )}
          </p>
        </div>

        <fieldset className="mg-field">
          <legend>{t("schedule.sheet.area")}</legend>
          <div className="pp-seg">
            {SHIFT_AREAS.map((a) => (
              <label key={a}>
                <input type="radio" name={`${id}-area`} value={a} checked={area === a} onChange={() => setArea(a)} />
                <span>{t(`schedule.area.${a}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mg-field">
          <label htmlFor={`${id}-note`}>{t("schedule.sheet.note")}</label>
          <input id={`${id}-note`} type="text" className="mg-input" autoComplete="off" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
