import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, UserX } from "lucide-react";
import { tableRanges } from "@lodos/shared";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { Shell } from "../Shell";
import { initials } from "../auth";
import { useManagerFloor, useManagerTables } from "../manager/queries";
import { PIN_RE, PinFields } from "./PinFields";
import { InactivePanel, StaffForm } from "./StaffForm";
import { lastSeen } from "./lib";
import { refreshStaff, useStaffPeople } from "./queries";
import type { StaffRow } from "./types";

type Panel = { kind: "new" } | { kind: "edit"; id: string } | null;

/**
 * `/staff/people` (manager): everyone with role, tables, last sign-in and status; Add / edit in the side panel
 * (`StaffForm`); Deactivate behind a confirm that lists the tables that become unassigned; station accounts get
 * Reset PIN only.
 */
export function Staff() {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const list = useStaffPeople();
  const tables = useManagerTables();
  const floor = useManagerFloor();
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState("");
  const [deactivating, setDeactivating] = useState<StaffRow | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [now] = useState(() => new Date());

  const people = list.data?.people ?? [];
  const stations = list.data?.stations ?? [];
  const owners = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const p of list.data?.people ?? []) if (p.active) for (const x of p.tables) m.set(x.id, { id: p.id, name: p.name });
    return m;
  }, [list.data]);
  const active = people.filter((p) => p.active).length;
  const editing = panel?.kind === "edit" ? people.find((p) => p.id === panel.id) : undefined;

  const done = (message: string) => {
    setStatus(message);
    setPanel(null);
  };

  const actions = (
    <button type="button" className="staff-btn primary" onClick={() => setPanel({ kind: "new" })}>
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
      {t("people.add")}
    </button>
  );

  const ready = list.data && tables.data && floor.data;
  return (
    <Shell
      title={t("people.title")}
      subtitle={list.data ? t("people.counts", { active, inactive: people.length - active }) : undefined}
      actions={actions}
      clock={false}
    >
      {!ready ? (
        <div className="mg-blocking" role={list.isError ? "alert" : "status"}>
          {list.isError ? (
            <>
              <p>{t("people.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void list.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className={`pp-page ${panel ? "has-panel" : ""}`}>
          <div className="pp-main">
            <p role="status" className="mg-status">{status}</p>
            <table className="mg-table pp-table">
              <caption className="sr-only">{t("people.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("people.col.name")}</th>
                  <th scope="col">{t("people.col.role")}</th>
                  <th scope="col">{t("people.col.tables")}</th>
                  <th scope="col">{t("people.col.lastSignIn")}</th>
                  <th scope="col">{t("people.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className={`${p.active ? "" : "is-inactive"} ${editing?.id === p.id ? "is-sel" : ""}`}>
                    <td>
                      <button
                        type="button"
                        className="pp-name"
                        aria-pressed={editing?.id === p.id}
                        onClick={() => { setStatus(""); setPanel({ kind: "edit", id: p.id }); }}
                      >
                        <span className="staff-avatar" aria-hidden="true">{initials(p.name)}</span>
                        {p.name}
                      </button>
                    </td>
                    <td><span className={`pp-role ${p.role === "manager" ? "is-mgr" : ""}`}>{t(`staff.roles.${p.role}`)}</span></td>
                    <td className="font-mono pp-tables">
                      {p.role === "manager" ? <span className="mg-muted">{t("people.allTables")}</span> : p.tableRanges || <span className="mg-muted">—</span>}
                    </td>
                    <td className="font-mono pp-seen">{lastSeen(p.lastSignInAt, now, lang, t)}</td>
                    <td><span className={`pp-status ${p.active ? "" : "is-off"}`}><i aria-hidden="true" />{t(p.active ? "people.active" : "people.inactive")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <section className="pp-stations" aria-labelledby="pp-stations-h">
              <h2 id="pp-stations-h" className="staff-label">{t("people.stations")}</h2>
              <p className="mg-hint">{t("people.stationsHint")}</p>
              <ul>
                {stations.map((s) => (
                  <li key={s.id}>
                    <span className="staff-avatar" aria-hidden="true">{initials(s.name)}</span>
                    <span className="pp-station-name">{s.name}</span>
                    <span className="font-mono pp-seen">{lastSeen(s.lastSignInAt, now, lang, t)}</span>
                    <button type="button" className="staff-btn" aria-label={t("people.resetPinFor", { name: s.name })} onClick={() => setResetting(s)}>
                      <KeyRound size={15} strokeWidth={1.75} aria-hidden="true" />
                      {t("people.resetPin")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {panel?.kind === "new" && (
            <StaffForm
              key="new"
              person={null}
              tables={tables.data}
              rooms={floor.data.rooms}
              owners={owners}
              onClose={() => setPanel(null)}
              onDone={done}
              onDeactivate={setDeactivating}
              onResetPin={setResetting}
            />
          )}
          {editing && editing.active && (
            <StaffForm
              key={editing.id}
              person={editing}
              tables={tables.data}
              rooms={floor.data.rooms}
              owners={owners}
              onClose={() => setPanel(null)}
              onDone={done}
              onDeactivate={setDeactivating}
              onResetPin={setResetting}
            />
          )}
          {editing && !editing.active && <InactivePanel key={editing.id} person={editing} onClose={() => setPanel(null)} onDone={done} />}
        </div>
      )}
      {deactivating && (
        <DeactivateDialog
          person={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={(m) => {
            setDeactivating(null);
            done(m);
          }}
        />
      )}
      {resetting && (
        <ResetPinDialog
          person={resetting}
          onClose={() => setResetting(null)}
          onDone={(m) => {
            setResetting(null);
            setStatus(m);
          }}
        />
      )}
    </Shell>
  );
}

function DeactivateDialog({ person, onClose, onDone }: { person: StaffRow; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ staff: StaffRow; unassignedTables: string[] }>(`/api/staff/${person.id}/deactivate`, { method: "POST" }),
    onSuccess: (r) => {
      refreshStaff(qc);
      const un = r.unassignedTables;
      onDone(un.length ? t("people.status.unassigned", { count: un.length, ranges: tableRanges(un) }) : t("people.status.deactivated", { name: person.name }));
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  return (
    <Dialog
      title={t("people.dialog.deactivateTitle", { name: person.name })}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onClose}>{t("people.form.cancel")}</button>
          <button type="button" className="staff-btn primary" disabled={m.isPending} onClick={() => { setFailure(null); m.mutate(); }}>
            <UserX size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("people.deactivate")}
          </button>
        </>
      }
    >
      <div className="mg-confirm">
        <p>{t("people.dialog.deactivateBody")}</p>
        <p className="staff-label">{t("people.dialog.tablesLabel")}</p>
        {person.tables.length > 0 ? (
          <p className="font-mono pp-un">{person.tableRanges}</p>
        ) : (
          <p className="mg-muted">{t("people.dialog.noTables")}</p>
        )}
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
      </div>
    </Dialog>
  );
}

function ResetPinDialog({ person, onClose, onDone }: { person: StaffRow; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ pin?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/api/staff/${person.id}/pin`, { method: "POST", body: JSON.stringify({ pin }) }),
    onSuccess: () => onDone(t("people.status.pinReset", { name: person.name })),
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const errs: typeof errors = {};
    if (!PIN_RE.test(pin)) errs.pin = t("people.form.pinInvalid");
    else if (confirm !== pin) errs.confirm = t("people.form.pinMismatch");
    setErrors(errs);
    if (!errs.pin && !errs.confirm) m.mutate();
  };
  return (
    <Dialog
      title={t("people.dialog.resetTitle", { name: person.name })}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onClose}>{t("people.form.cancel")}</button>
          <button type="submit" form="pp-reset-form" className="staff-btn primary" disabled={m.isPending}>
            <KeyRound size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("people.resetPin")}
          </button>
        </>
      }
    >
      <form id="pp-reset-form" className="mg-form" onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
        <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} pinError={errors.pin} confirmError={errors.confirm} label={t("people.newPin")} />
      </form>
    </Dialog>
  );
}
