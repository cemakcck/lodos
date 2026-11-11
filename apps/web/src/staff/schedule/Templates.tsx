import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SHIFT_AREAS, type ShiftArea } from "@lodos/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { hoursText, span, tooLong } from "./lib";
import { templatesKey, type ShiftTemplate } from "./types";

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
type Draft = { id: string | null; name: string; start: string; end: string; area: ShiftArea };
const blank: Draft = { id: null, name: "", start: "", end: "", area: "salon" };

/** Manage the shift templates (name, start, end, area): list with edit and delete, and one form for add / edit. */
export function Templates({ templates, onClose }: { templates: readonly ShiftTemplate[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(blank);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: templatesKey });
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = JSON.stringify({ name: d.name.trim(), start: d.start, end: d.end, area: d.area });
      return d.id ? api(`/api/shift-templates/${d.id}`, { method: "PATCH", body }) : api("/api/shift-templates", { method: "POST", body });
    },
    onSuccess: (_r, d) => {
      refresh();
      setStatus(t("schedule.templates.saved", { name: d.name.trim() }));
      setDraft(blank);
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: (tp: ShiftTemplate) => api(`/api/shift-templates/${tp.id}`, { method: "DELETE" }),
    onSuccess: (_r, tp) => {
      refresh();
      setStatus(t("schedule.templates.deleted", { name: tp.name }));
      if (draft.id === tp.id) setDraft(blank);
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    setStatus("");
    if (!draft.name.trim()) return setFailure(t("schedule.templates.nameRequired"));
    if (!CLOCK_RE.test(draft.start) || !CLOCK_RE.test(draft.end)) return setFailure(t("schedule.sheet.timesRequired"));
    if (tooLong(draft.start, draft.end)) return setFailure(t("errors.shift_too_long"));
    save.mutate(draft);
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog
      title={t("schedule.templates.title")}
      onClose={onClose}
      width={560}
      footer={<button type="button" className="staff-btn" onClick={onClose}>{t("schedule.templates.done")}</button>}
    >
      <div className="mg-form sc-tpl">
        <p role="status" className="mg-status">{status}</p>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
        {templates.length === 0 ? (
          <p className="mg-muted">{t("schedule.templates.empty")}</p>
        ) : (
          <ul className="sc-tpl-list">
            {templates.map((tp) => (
              <li key={tp.id} className={draft.id === tp.id ? "is-sel" : undefined}>
                <span className="sc-tpl-name">{tp.name}</span>
                <span className="font-mono">{span(tp.start, tp.end)}</span>
                <span className="mg-muted">{t(`schedule.area.${tp.area}`)} · {hoursText(t, tp.minutes, lang)}</span>
                <button
                  type="button"
                  className="staff-icon-btn"
                  aria-label={t("schedule.templates.edit", { name: tp.name })}
                  onClick={() => { setFailure(null); setDraft({ id: tp.id, name: tp.name, start: tp.start, end: tp.end, area: tp.area }); }}
                >
                  <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="staff-icon-btn"
                  aria-label={t("schedule.templates.delete", { name: tp.name })}
                  disabled={remove.isPending}
                  onClick={() => { setFailure(null); remove.mutate(tp); }}
                >
                  <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="sc-tpl-form" onSubmit={submit} noValidate aria-label={t(draft.id ? "schedule.templates.editTitle" : "schedule.templates.newTitle")}>
          <h3 className="sc-tpl-h">{t(draft.id ? "schedule.templates.editTitle" : "schedule.templates.newTitle")}</h3>
          <div className="mg-field">
            <label htmlFor={`${id}-name`}>{t("schedule.templates.name")}</label>
            <input id={`${id}-name`} className="mg-input" autoComplete="off" maxLength={40} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="mg-grid2">
            <div className="mg-field">
              <label htmlFor={`${id}-start`}>{t("schedule.sheet.start")}</label>
              <input id={`${id}-start`} type="time" className="mg-input font-mono" value={draft.start} onChange={(e) => set({ start: e.target.value })} />
            </div>
            <div className="mg-field">
              <label htmlFor={`${id}-end`}>{t("schedule.sheet.end")}</label>
              <input id={`${id}-end`} type="time" className="mg-input font-mono" value={draft.end} onChange={(e) => set({ end: e.target.value })} />
            </div>
          </div>
          <div className="mg-field">
            <label htmlFor={`${id}-area`}>{t("schedule.sheet.area")}</label>
            <select id={`${id}-area`} className="mg-input" value={draft.area} onChange={(e) => set({ area: e.target.value as ShiftArea })}>
              {SHIFT_AREAS.map((a) => (
                <option key={a} value={a}>{t(`schedule.area.${a}`)}</option>
              ))}
            </select>
          </div>
          <div className="mg-form-f">
            {draft.id && (
              <button type="button" className="staff-btn" onClick={() => { setFailure(null); setDraft(blank); }}>{t("schedule.sheet.cancel")}</button>
            )}
            <div className="staff-grow" />
            <button type="submit" className="staff-btn primary" disabled={save.isPending}>
              {!draft.id && <Plus size={15} strokeWidth={1.75} aria-hidden="true" />}
              {t(draft.id ? "schedule.templates.save" : "schedule.templates.add")}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
