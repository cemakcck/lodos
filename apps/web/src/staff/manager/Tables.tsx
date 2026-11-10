import { useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Printer, RefreshCw } from "lucide-react";
import { TABLE_NAME_RE } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Dialog } from "../Dialog";
import { Shell } from "../Shell";
import { initials } from "../auth";
import { byName, roomName } from "../floor/lib";
import { useManagerFloor, useManagerTables, useStaffList } from "./queries";
import { managerTablesKey, type ManagerTable } from "./types";

/** Tables in room order, then by name (T2 before T10). */
export function useTableRows() {
  const { t } = useTranslation();
  const tables = useManagerTables();
  const floor = useManagerFloor();
  const rooms = floor.data?.rooms ?? [];
  const roomIndex = new Map(rooms.map((r, i) => [r.id, i]));
  const rows = [...(tables.data ?? [])]
    .filter((x) => x.active)
    .sort((a, b) => (roomIndex.get(a.roomId) ?? 99) - (roomIndex.get(b.roomId) ?? 99) || byName(a, b));
  const roomOf = (id: string) => {
    const r = rooms.find((x) => x.id === id);
    return r ? roomName(r.name, t) : "";
  };
  return { tables, floor, rooms, rows, roomOf };
}

/**
 * `/staff/tables`: every table with room, capacity and section waiter; rename / capacity edits and
 * "Regenerate QR" behind a confirm (the old printed code stops working). "Print QR sheet" opens the A4 sheet.
 */
export function Tables() {
  const { t } = useTranslation();
  const { tables, floor, rooms, rows, roomOf } = useTableRows();
  const staff = useStaffList();
  const [editing, setEditing] = useState<ManagerTable | null>(null);
  const [regen, setRegen] = useState<ManagerTable | null>(null);
  const [status, setStatus] = useState("");

  const sectionOf = (tableId: string) => {
    const sid = floor.data?.tables.find((x) => x.id === tableId)?.sectionStaffId;
    return sid ? (staff.data?.find((s) => s.id === sid)?.name ?? null) : null;
  };

  const actions = (
    <Link to="/staff/tables/qr" className="staff-btn primary">
      <Printer size={16} strokeWidth={1.75} aria-hidden="true" />
      {t("manager.tables.printSheet")}
    </Link>
  );
  const stats = tables.data && (
    <>
      <span><b>{rows.length}</b>{t("manager.tables.stats.tables")}</span>
      <span><b>{rows.reduce((n, r) => n + r.capacity, 0)}</b>{t("manager.tables.stats.seats")}</span>
      <span><b>{rooms.length}</b>{t("manager.tables.stats.rooms")}</span>
    </>
  );

  return (
    <Shell title={t("manager.tables.title")} actions={actions} stats={stats ?? null} clock={false}>
      {!tables.data ? (
        <div className="mg-blocking" role={tables.isError ? "alert" : "status"}>
          {tables.isError ? (
            <>
              <p>{t("manager.tables.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void tables.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page">
          <p role="status" className="mg-status">{status}</p>
          <table className="mg-table mg-tables">
            <caption className="sr-only">{t("manager.tables.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("manager.tables.col.name")}</th>
                <th scope="col">{t("manager.tables.col.room")}</th>
                <th scope="col" className="c-num">{t("manager.tables.col.capacity")}</th>
                <th scope="col">{t("manager.tables.col.section")}</th>
                <th scope="col">{t("manager.tables.col.code")}</th>
                <th scope="col"><span className="sr-only">{t("manager.tables.col.actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const waiter = sectionOf(r.id);
                const tail = r.token.slice(-6);
                return (
                  <tr key={r.id}>
                    <td className="c-table">{r.name}</td>
                    <td>{roomOf(r.roomId)}</td>
                    <td className="c-num font-mono">{r.capacity}</td>
                    <td>
                      {waiter ? (
                        <span className="mg-person">
                          <span className="staff-avatar" aria-hidden="true">{initials(waiter)}</span>
                          {waiter}
                        </span>
                      ) : (
                        <span className="mg-muted">{t("manager.tables.noSection")}</span>
                      )}
                    </td>
                    <td>
                      <span className="mg-code">
                        <span className="sr-only">{t("manager.tables.codeEnding", { tail })}</span>
                        <span aria-hidden="true" className="font-mono">…{tail}</span>
                      </span>
                    </td>
                    <td className="c-actions">
                      <button type="button" className="staff-btn" aria-label={t("manager.tables.edit", { name: r.name })} onClick={() => setEditing(r)}>
                        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                        {t("manager.tables.editShort")}
                      </button>
                      <button type="button" className="staff-btn" aria-label={t("manager.tables.regenerate", { name: r.name })} onClick={() => setRegen(r)}>
                        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                        {t("manager.tables.regenerateShort")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <TableDialog
          table={editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setStatus(t("manager.tables.saved", { name }));
          }}
        />
      )}
      {regen && (
        <RegenerateDialog
          table={regen}
          onClose={() => setRegen(null)}
          onDone={() => {
            setStatus(t("manager.tables.regenerated", { name: regen.name }));
            setRegen(null);
          }}
        />
      )}
    </Shell>
  );
}

function RegenerateDialog({ table, onClose, onDone }: { table: ManagerTable; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ id: string; token: string }>(`/api/manager/tables/${table.id}/token`, { method: "POST" }),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: managerTablesKey });
      onDone();
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  return (
    <Dialog
      title={t("manager.tables.confirmTitle", { name: table.name })}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onClose}>{t("manager.item.cancel")}</button>
          <button type="button" className="staff-btn primary" disabled={m.isPending} onClick={() => { setFailure(null); m.mutate(); }}>
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
            {m.isPending ? t("manager.tables.regenerating") : t("manager.tables.regenerateShort")}
          </button>
        </>
      }
    >
      <div className="mg-confirm">
        <p>{t("manager.tables.confirmBody", { name: table.name })}</p>
        <p className="mg-muted">{t("manager.tables.confirmNext")}</p>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
      </div>
    </Dialog>
  );
}

function TableDialog({ table, onClose, onSaved }: { table: ManagerTable; onClose: () => void; onSaved: (name: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = useId();
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(table.name);
  const [cap, setCap] = useState(String(table.capacity));
  const [errors, setErrors] = useState<{ name?: string; capacity?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: (body: { name: string; capacity: number }) =>
      api<{ id: string; name: string; capacity: number }>(`/api/manager/tables/${table.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: managerTablesKey });
      void qc.invalidateQueries({ queryKey: ["floor"] });
      onSaved(r.name);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 409) {
        setErrors({ name: t("manager.tables.duplicate") });
        first.current?.focus();
      } else setFailure(errorMessage(t, e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const n = name.trim().toUpperCase();
    const c = Number(cap);
    const errs: typeof errors = {};
    if (!TABLE_NAME_RE.test(n)) errs.name = t("manager.tables.nameError");
    if (!Number.isInteger(c) || c < 1 || c > 50) errs.capacity = t("manager.tables.capacityError");
    setErrors(errs);
    if (errs.name) first.current?.focus();
    else if (errs.capacity) document.getElementById(`${base}-cap`)?.focus();
    if (errs.name || errs.capacity) return;
    m.mutate({ name: n, capacity: c });
  };

  const described = (k: "name" | "capacity") => [`${base}-${k}-hint`, errors[k] ? `${base}-${k}-err` : ""].filter(Boolean).join(" ");

  return (
    <Dialog
      title={t("manager.tables.editTitle", { name: table.name })}
      onClose={onClose}
      initialFocus={first}
      width={400}
      footer={
        <>
          <button type="button" className="staff-btn" onClick={onClose}>{t("manager.item.cancel")}</button>
          <button type="submit" form={`${base}-form`} className="staff-btn primary" disabled={m.isPending}>{t("manager.tables.save")}</button>
        </>
      }
    >
      <form id={`${base}-form`} className="mg-form" onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
        <div className="mg-grid2">
          <div className="mg-field">
            <label htmlFor={`${base}-name`}>{t("manager.tables.name")}</label>
            <input
              ref={first}
              id={`${base}-name`}
              className="mg-input font-mono"
              autoCapitalize="characters"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={described("name")}
            />
            <p id={`${base}-name-hint`} className="mg-hint">{t("manager.tables.nameHint")}</p>
            {errors.name && <p id={`${base}-name-err`} className="mg-err">{errors.name}</p>}
          </div>
          <div className="mg-field">
            <label htmlFor={`${base}-cap`}>{t("manager.tables.capacity")}</label>
            <input
              id={`${base}-cap`}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              className="mg-input font-mono"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              aria-invalid={errors.capacity ? true : undefined}
              aria-describedby={described("capacity")}
            />
            <p id={`${base}-capacity-hint`} className="mg-hint">{t("manager.tables.capacityHint")}</p>
            {errors.capacity && <p id={`${base}-capacity-err`} className="mg-err">{errors.capacity}</p>}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
