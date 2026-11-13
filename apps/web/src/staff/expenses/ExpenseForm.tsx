import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { serviceDayOf } from "@lodos/shared";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { loc } from "../kds/lib";
import { kurusToLira, liraToKurus } from "../manager/price";
import { refreshExpenses, type CategoryRow, type ExpenseInput, type ExpenseRow } from "./queries";

/** Add (no `expense`) or edit an expense. The amount is typed in lira and posted as kuruş. */
export function ExpenseForm({ expense, categories, onClose, onDone }: {
  expense: ExpenseRow | null;
  categories: CategoryRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const id = useId();
  const [amount, setAmount] = useState(expense ? kurusToLira(expense.amount, lang) : "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [date, setDate] = useState(expense?.date ?? serviceDayOf(new Date()));
  const [payee, setPayee] = useState(expense?.payee ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [errors, setErrors] = useState<Partial<Record<"amount" | "category" | "date", string>>>({});
  const [confirming, setConfirming] = useState(false);

  // A saved expense may sit in a category archived since; keep it pickable so the form can show it.
  const pickable = categories.filter((c) => !c.archived || c.id === expense?.categoryId);

  const save = useMutation({
    mutationFn: (body: ExpenseInput) =>
      expense ? api(`/api/expenses/${expense.id}`, { method: "PUT", body: JSON.stringify(body) }) : api("/api/expenses", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      refreshExpenses(qc);
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/expenses/${expense!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refreshExpenses(qc);
      onDone();
    },
  });
  const failure = save.isError ? errorMessage(t, save.error) : remove.isError ? errorMessage(t, remove.error) : "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const kurus = liraToKurus(amount);
    const next: typeof errors = {};
    if (kurus === null || kurus <= 0) next.amount = t("expenses.form.errors.amount");
    if (!categoryId) next.category = t("expenses.form.errors.category");
    if (!date) next.date = t("expenses.form.errors.date");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    save.mutate({ categoryId, amount: kurus!, date, payee: payee.trim() || null, note: note.trim() || null });
  };

  const err = (k: keyof typeof errors) =>
    errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${k}-err` } : {};
  const msg = (k: keyof typeof errors) =>
    errors[k] && <p id={`${id}-${k}-err`} className="mg-err">{errors[k]}</p>;

  return (
    <Dialog
      title={expense ? t("expenses.form.editTitle") : t("expenses.form.addTitle")}
      onClose={onClose}
      width={440}
      footer={
        confirming ? (
          <>
            <span className="mr-auto self-center text-[13px]">{t("expenses.form.confirm")}</span>
            <button type="button" className="staff-btn" onClick={() => setConfirming(false)}>{t("expenses.form.keep")}</button>
            <button type="button" className="staff-btn primary" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("expenses.form.yes")}</button>
          </>
        ) : (
          <>
            {expense && (
              <button type="button" className="staff-btn mr-auto" onClick={() => setConfirming(true)}>{t("expenses.form.delete")}</button>
            )}
            <button type="button" className="staff-btn" onClick={onClose}>{t("expenses.form.cancel")}</button>
            <button type="submit" form={`${id}-form`} className="staff-btn primary" disabled={save.isPending}>{t("expenses.form.save")}</button>
          </>
        )
      }
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice mb-3">{failure}</p>}
        <div className="mg-grid2">
          <div className="mg-field">
            <label htmlFor={`${id}-amount`}>{t("expenses.form.amount")}</label>
            <input id={`${id}-amount`} className="mg-input font-mono" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} {...err("amount")} />
            {msg("amount")}
          </div>
          <div className="mg-field">
            <label htmlFor={`${id}-date`}>{t("expenses.form.date")}</label>
            <input id={`${id}-date`} type="date" className="mg-input" max={serviceDayOf(new Date())} value={date} onChange={(e) => setDate(e.target.value)} {...err("date")} />
            {msg("date")}
          </div>
        </div>
        <div className="mg-field mt-3">
          <label htmlFor={`${id}-cat`}>{t("expenses.form.category")}</label>
          <select id={`${id}-cat`} className="mg-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} {...err("category")}>
            <option value="">{t("expenses.form.pick")}</option>
            {pickable.map((c) => (
              <option key={c.id} value={c.id}>{loc(c.name, lang)}</option>
            ))}
          </select>
          {msg("category")}
        </div>
        <div className="mg-field mt-3">
          <label htmlFor={`${id}-payee`}>{t("expenses.form.payee")}</label>
          <input id={`${id}-payee`} className="mg-input" maxLength={100} autoComplete="off" value={payee} onChange={(e) => setPayee(e.target.value)} />
        </div>
        <div className="mg-field mt-3">
          <label htmlFor={`${id}-note`}>{t("expenses.form.note")}</label>
          <input id={`${id}-note`} className="mg-input" maxLength={500} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
