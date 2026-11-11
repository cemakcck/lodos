import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserCheck, UserX } from "lucide-react";
import { canSignIn, tableRanges } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { initials } from "../auth";
import type { ManagerTable } from "../manager/types";
import { PIN_RE, PinFields } from "./PinFields";
import { TableChips, type ChipRoom } from "./TableChips";
import { refreshStaff } from "./queries";
import { PERSON_ROLES, type PersonRole, type StaffRow } from "./types";

interface Props {
  /** The person being edited; null adds a new one. */
  person: StaffRow | null;
  tables: ManagerTable[];
  rooms: ChipRoom[];
  owners: ReadonlyMap<string, { id: string; name: string }>;
  onClose: () => void;
  /** A message for the screen's status line. */
  onDone: (message: string) => void;
  onDeactivate: (p: StaffRow) => void;
  onResetPin: (p: StaffRow) => void;
}

interface Saved {
  staff: StaffRow;
  unassignedTables?: string[];
}

function PanelHeader({ person, heading }: { person: StaffRow | null; heading: string }) {
  const { t } = useTranslation();
  return (
    <div className="pp-ph">
      <span className="staff-avatar" aria-hidden="true">{person ? initials(person.name) : "+"}</span>
      <h2 className="pp-ph-title">{heading}</h2>
      <div className="staff-grow" />
      {person && <span className={`pp-status ${person.active ? "" : "is-off"}`}><i aria-hidden="true" />{t(person.active ? "people.active" : "people.inactive")}</span>}
    </div>
  );
}

/** An inactive person is read-only: the only way forward is to bring them back. */
export function InactivePanel({ person, onClose, onDone }: { person: StaffRow; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const reactivate = useMutation({
    mutationFn: () => api<{ staff: StaffRow }>(`/api/staff/${person.id}/reactivate`, { method: "POST" }),
    onSuccess: () => {
      refreshStaff(qc);
      onDone(t("people.status.reactivated", { name: person.name }));
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  return (
    <section className="pp-panel" aria-label={person.name}>
      <PanelHeader person={person} heading={person.name} />
      <div className="pp-ps">
        <p className="mg-hint">{t("people.form.inactiveHint")}</p>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
      </div>
      <div className="pp-pf">
        <button type="button" className="staff-btn" onClick={onClose}>{t("people.form.close")}</button>
        <button type="button" className="staff-btn primary" disabled={reactivate.isPending} onClick={() => { setFailure(null); reactivate.mutate(); }}>
          <UserCheck size={15} strokeWidth={1.75} aria-hidden="true" />
          {t("people.reactivate")}
        </button>
      </div>
    </section>
  );
}

/** Add or edit one person: name, role, PIN (only when they need one) and, for a waiter, their tables. */
export function StaffForm({ person, tables, rooms, owners, onClose, onDone, onDeactivate, onResetPin }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const originalIds = person ? person.tables.map((x) => x.id) : [];
  const [name, setName] = useState(person?.name ?? "");
  const [role, setRole] = useState<string>(person?.role ?? "waiter");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(originalIds));
  const [errors, setErrors] = useState<{ name?: string; pin?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const heading = person ? person.name : t("people.form.newTitle");
  const header = <PanelHeader person={person} heading={heading} />;

  const needsPin = canSignIn(role) && !(person && canSignIn(person.role));
  const isWaiter = role === "waiter";
  const sameSet = selected.size === originalIds.length && originalIds.every((id) => selected.has(id));
  const dirty = !person || name.trim() !== person.name || role !== person.role || pin !== "" || (isWaiter && !sameSet);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      person
        ? api<Saved>(`/api/staff/${person.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api<Saved>("/api/staff", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r) => {
      refreshStaff(qc);
      const un = r.unassignedTables ?? [];
      const msg = t(person ? "people.status.saved" : "people.status.added", { name: r.staff.name });
      onDone(un.length ? `${msg} ${t("people.status.unassigned", { count: un.length, ranges: tableRanges(un) })}` : msg);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "name_taken") {
        setErrors({ name: t("people.form.nameTaken") });
        nameRef.current?.focus();
      } else setFailure(errorMessage(t, e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const n = name.trim();
    const errs: typeof errors = {};
    if (!n) errs.name = t("people.form.nameRequired");
    if (needsPin || pin) {
      if (!PIN_RE.test(pin)) errs.pin = t("people.form.pinInvalid");
      else if (confirm !== pin) errs.confirm = t("people.form.pinMismatch");
    }
    setErrors(errs);
    if (errs.name) return nameRef.current?.focus();
    if (errs.pin) return pinRef.current?.focus();
    if (errs.confirm) return confirmRef.current?.focus();
    const body: Record<string, unknown> = {};
    if (!person || n !== person.name) body.name = n;
    if (!person || role !== person.role) body.role = role;
    if (canSignIn(role) && pin) body.pin = pin;
    // `tableIds` is the whole section: send the full resulting list, never a delta.
    if (isWaiter && (person ? !sameSet : selected.size > 0)) body.tableIds = [...selected];
    save.mutate(body);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const roleLabel = (r: string) => t(`staff.roles.${r}`);
  const why = person?.whyNot ? t(`people.why.${person.whyNot}`) : null;

  return (
    <form className="pp-panel" aria-label={heading} onSubmit={submit} noValidate>
      {header}
      <div className="pp-ps">
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
        <div className="mg-field">
          <label htmlFor={`${base}-name`}>{t("people.form.name")}</label>
          <input
            ref={nameRef}
            id={`${base}-name`}
            className="mg-input"
            autoComplete="off"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${base}-name-err` : undefined}
          />
          {errors.name && <p id={`${base}-name-err`} className="mg-err">{errors.name}</p>}
        </div>
      </div>

      <div className="pp-ps">
        <span className="staff-label" id={`${base}-role`}>{t("people.form.role")}</span>
        <div className="pp-seg" role="radiogroup" aria-labelledby={`${base}-role`}>
          {PERSON_ROLES.map((r: PersonRole) => (
            <label key={r}>
              <input type="radio" name={`${base}-role`} value={r} checked={role === r} onChange={() => setRole(r)} />
              <span>{roleLabel(r)}</span>
            </label>
          ))}
        </div>
        {!canSignIn(role) && <p className="mg-hint">{t("people.form.scheduleOnly", { role: roleLabel(role) })}</p>}
      </div>

      {(needsPin || (canSignIn(role) && pin)) && (
        <div className="pp-ps">
          <PinFields
            pin={pin}
            confirm={confirm}
            onPin={setPin}
            onConfirm={setConfirm}
            pinError={errors.pin}
            confirmError={errors.confirm}
            pinRef={pinRef}
            confirmRef={confirmRef}
          />
        </div>
      )}

      {isWaiter && (
        <div className="pp-ps">
          <span className="staff-label">{t("people.form.tables")}</span>
          <TableChips
            tables={tables}
            rooms={rooms}
            owners={owners}
            editedId={person?.id ?? null}
            editedName={name.trim()}
            selected={selected}
            onToggle={toggle}
          />
          <p className="mg-hint">{t("people.form.tablesHint", { name: name.trim() || t("people.chip.thisPerson") })}</p>
        </div>
      )}

      <div className="pp-pf">
        {person && canSignIn(person.role) && (
          <button type="button" className="staff-btn" onClick={() => onResetPin(person)}>
            <KeyRound size={15} strokeWidth={1.75} aria-hidden="true" />
            {t("people.resetPin")}
          </button>
        )}
        {person && (
          <span className="pp-why-wrap">
            <button type="button" className="staff-btn" disabled={!person.canDeactivate} aria-describedby={why ? `${base}-why` : undefined} onClick={() => onDeactivate(person)}>
              <UserX size={15} strokeWidth={1.75} aria-hidden="true" />
              {t("people.deactivate")}
            </button>
            {why && <span id={`${base}-why`} className="pp-why">{why}</span>}
          </span>
        )}
        <div className="staff-grow" />
        <button type="button" className="staff-btn" onClick={onClose}>{t("people.form.cancel")}</button>
        <button type="submit" className="staff-btn primary" disabled={save.isPending || !dirty}>
          {person ? t("people.form.save") : t("people.form.add")}
        </button>
      </div>
    </form>
  );
}
