import { useId, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { dayLong, span } from "../schedule/lib";
import { WeekPicker } from "../schedule/WeekPicker";
import { Shell } from "../Shell";
import { durationText, fromLocalInput, toLocalInput } from "./lib";
import { refreshTimesheets, useClockPeople, useTimesheets, type TimesheetEntry, type TimesheetPerson, type TimesheetView } from "./queries";

type Editing = { kind: "add"; staffId: string | null } | { kind: "edit"; person: TimesheetPerson; entry: TimesheetEntry };

/**
 * `/staff/timesheets` (manager): a week at a time, a table per person with each day's planned shift next to the
 * clocked entries, an "edited" badge, overtime and cost. Add entry and Edit open a dialog that needs a reason.
 */
export function Timesheets() {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const [params, setParams] = useSearchParams();
  const week = params.get("week");
  const q = useTimesheets(week);
  const view = q.data;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState("");

  const go = (w: string | null) => {
    setStatus("");
    setParams(w ? { week: w } : {});
  };

  const toolbar = view && <WeekPicker week={view.week} isCurrent={week === null} onGo={go} />;
  const actions = view && (
    <button type="button" className="staff-btn" onClick={() => { setStatus(""); setEditing({ kind: "add", staffId: null }); }}>
      <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
      {t("timeclock.sheets.add")}
    </button>
  );

  return (
    <Shell title={t("timeclock.sheets.title")} toolbar={toolbar} actions={actions} clock={false}>
      {!view ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("timeclock.sheets.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="sc-page">
          <p role="status" className="mg-status">{status}</p>
          {view.people.length === 0 && <p className="mg-hint">{t("timeclock.sheets.empty")}</p>}
          {view.people.map((p) => (
            <PersonTable
              key={p.staffId}
              person={p}
              view={view}
              lang={lang}
              money={money}
              onAdd={() => { setStatus(""); setEditing({ kind: "add", staffId: p.staffId }); }}
              onEdit={(entry) => { setStatus(""); setEditing({ kind: "edit", person: p, entry }); }}
            />
          ))}
        </div>
      )}
      {editing && view && (
        <EntryDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={(m) => { setEditing(null); setStatus(m); }}
        />
      )}
    </Shell>
  );
}

function PersonTable({ person, view, lang, money, onAdd, onEdit }: {
  person: TimesheetPerson;
  view: TimesheetView;
  lang: "en" | "tr";
  money: (k: number) => string;
  onAdd: () => void;
  onEdit: (e: TimesheetEntry) => void;
}) {
  const { t } = useTranslation();
  const { clock } = useFormat();
  const id = useId();
  const rows = view.days.flatMap((day) => {
    const entries = person.entries.filter((e) => e.serviceDay === day);
    const planned = person.shifts.filter((s) => s.serviceDay === day).map((s) => span(s.start, s.end)).join(", ");
    if (entries.length === 0) return planned ? [{ day, planned, entry: null as TimesheetEntry | null, first: true }] : [];
    return entries.map((entry, i) => ({ day, planned: i === 0 ? planned : "", entry, first: i === 0 }));
  });

  return (
    <section aria-labelledby={id} className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} className="text-[15px] font-semibold">{person.name}</h2>
        <span className="text-xs text-staff-fg-3">{t(`staff.roles.${person.role}`)}</span>
        <span className="text-[13px] text-staff-fg-2">
          {t("timeclock.sheets.totals", {
            hours: durationText(t, person.minutes),
            overtime: durationText(t, person.overtimeMinutes),
            cost: money(person.cost),
          })}
        </span>
        <div className="staff-grow" />
        <button type="button" className="staff-btn" aria-label={t("timeclock.sheets.addFor", { name: person.name })} onClick={onAdd}>
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
          {t("timeclock.sheets.add")}
        </button>
      </div>
      <table className="mg-table">
        <caption className="sr-only">{t("timeclock.sheets.caption", { name: person.name })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("timeclock.sheets.col.day")}</th>
            <th scope="col">{t("timeclock.sheets.col.planned")}</th>
            <th scope="col">{t("timeclock.sheets.col.clocked")}</th>
            <th scope="col" className="c-num">{t("timeclock.sheets.col.hours")}</th>
            <th scope="col" className="c-num">{t("timeclock.sheets.col.overtime")}</th>
            <th scope="col" className="c-num">{t("timeclock.sheets.col.cost")}</th>
            <th scope="col"><span className="sr-only">{t("timeclock.sheets.col.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ day, planned, entry, first }) => (
            <tr key={entry?.id ?? `${day}-planned`}>
              <td>{first ? dayLong(day, lang) : ""}</td>
              <td className="font-mono">{planned || <span className="mg-muted">—</span>}</td>
              <td className="font-mono">
                {entry ? (
                  <>
                    {clock(new Date(entry.in))}–{entry.out ? clock(new Date(entry.out)) : t("timeclock.sheets.open")}
                    {entry.edited && <span className="mg-chip is-hidden ml-2">{t("timeclock.sheets.edited")}</span>}
                    {entry.forgot && <span className="mg-chip is-low ml-2">{t("timeclock.sheets.forgot")}</span>}
                  </>
                ) : (
                  <span className="mg-muted">{t("timeclock.sheets.noEntry")}</span>
                )}
              </td>
              <td className="c-num">{entry?.minutes != null ? durationText(t, entry.minutes) : "—"}</td>
              <td className="c-num">{entry && entry.overtimeMinutes > 0 ? durationText(t, entry.overtimeMinutes) : "—"}</td>
              <td className="c-num">{entry && entry.minutes != null ? money(entry.cost) : "—"}</td>
              <td>
                {entry && (
                  <button
                    type="button"
                    className="staff-btn"
                    aria-label={t("timeclock.sheets.editFor", { name: person.name, day: dayLong(day, lang) })}
                    onClick={() => onEdit(entry)}
                  >
                    <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                    {t("timeclock.sheets.edit")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function EntryDialog({ editing, onClose, onDone }: { editing: Editing; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const id = useId();
  const people = useClockPeople();
  const entry = editing.kind === "edit" ? editing.entry : null;
  const [staffId, setStaffId] = useState(editing.kind === "add" ? (editing.staffId ?? "") : editing.person.staffId);
  const [inAt, setInAt] = useState(entry ? toLocalInput(entry.in) : "");
  const [outAt, setOutAt] = useState(entry?.out ? toLocalInput(entry.out) : "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ staff?: string; inAt?: string; outAt?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const name = editing.kind === "edit" ? editing.person.name : (people.data?.find((p) => p.id === staffId)?.name ?? "");

  const save = useMutation({
    mutationFn: (b: { in: string; out: string }) =>
      editing.kind === "edit"
        ? api(`/api/timesheets/entries/${editing.entry.id}`, { method: "PUT", body: JSON.stringify({ ...b, reason: reason.trim() }) })
        : api("/api/timesheets/entries", { method: "POST", body: JSON.stringify({ staffId, ...b, reason: reason.trim() }) }),
    onSuccess: () => {
      refreshTimesheets(qc);
      onDone(t(editing.kind === "edit" ? "timeclock.sheets.saved" : "timeclock.sheets.added", { name }));
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const inIso = fromLocalInput(inAt);
    const outIso = fromLocalInput(outAt);
    const errs: typeof errors = {};
    if (editing.kind === "add" && !staffId) errs.staff = t("timeclock.sheets.errors.person");
    if (!inIso) errs.inAt = t("timeclock.sheets.errors.time");
    if (!outIso) errs.outAt = t("timeclock.sheets.errors.time");
    else if (inIso && Date.parse(outIso) <= Date.parse(inIso)) errs.outAt = t("timeclock.sheets.errors.order");
    if (!reason.trim()) errs.reason = t("timeclock.sheets.errors.reason");
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    save.mutate({ in: inIso!, out: outIso! });
  };

  const field = (key: "inAt" | "outAt", label: string, value: string, set: (v: string) => void) => (
    <div className="mg-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        type="datetime-local"
        className="mg-input font-mono"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-err` : undefined}
      />
      {errors[key] && <p id={`${id}-${key}-err`} className="mg-err">{errors[key]}</p>}
    </div>
  );

  return (
    <Dialog
      title={editing.kind === "edit" ? t("timeclock.sheets.editTitle", { name }) : t("timeclock.sheets.addTitle")}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onClose}>{t("people.form.cancel")}</button>
          <button type="submit" form={`${id}-form`} className="staff-btn primary" disabled={save.isPending}>{t("timeclock.sheets.save")}</button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice mb-3">{failure}</p>}
        {editing.kind === "add" && (
          <div className="mg-field">
            <label htmlFor={`${id}-staff`}>{t("timeclock.sheets.person")}</label>
            <select
              id={`${id}-staff`}
              className="mg-input"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              aria-invalid={errors.staff ? true : undefined}
              aria-describedby={errors.staff ? `${id}-staff-err` : undefined}
            >
              <option value="">{t("timeclock.sheets.pickPerson")}</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.staff && <p id={`${id}-staff-err`} className="mg-err">{errors.staff}</p>}
          </div>
        )}
        <div className="mg-grid2">
          {field("inAt", t("timeclock.sheets.in"), inAt, setInAt)}
          {field("outAt", t("timeclock.sheets.out"), outAt, setOutAt)}
        </div>
        <p className="mg-hint">{t("timeclock.sheets.timeHint")}</p>
        <div className="mg-field">
          <label htmlFor={`${id}-reason`}>{t("timeclock.sheets.reason")}</label>
          <input
            id={`${id}-reason`}
            className="mg-input"
            maxLength={200}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-required="true"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? `${id}-reason-err` : undefined}
          />
          {errors.reason && <p id={`${id}-reason-err`} className="mg-err">{errors.reason}</p>}
        </div>
      </form>
    </Dialog>
  );
}
