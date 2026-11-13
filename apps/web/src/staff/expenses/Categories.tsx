import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { loc } from "../kds/lib";
import { kurusToLira, liraToKurus } from "../manager/price";
import { refreshExpenses, useCategories, type CategoryRow, type Kind } from "./queries";

/** Categories: one dialog that shows the list, or the form (new or edit) in its place. */
export function Categories({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const q = useCategories();
  const id = useId();
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);

  return (
    <Dialog
      title={editing ? (editing === "new" ? t("expenses.cats.newTitle") : t("expenses.cats.editTitle")) : t("expenses.cats.title")}
      onClose={onClose}
      width={editing ? 460 : 520}
      footer={
        editing ? (
          <>
            <button type="button" className="staff-btn" onClick={() => setEditing(null)}>{t("expenses.cats.back")}</button>
            <button type="submit" form={`${id}-form`} className="staff-btn primary">{t("expenses.cats.save")}</button>
          </>
        ) : (
          <>
            <button type="button" className="staff-btn mr-auto" onClick={() => setEditing("new")}>
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
              {t("expenses.cats.new")}
            </button>
            <button type="button" className="staff-btn primary" onClick={onClose}>{t("expenses.cats.close")}</button>
          </>
        )
      }
    >
      {editing ? (
        <CategoryForm key={editing === "new" ? "new" : editing.id} formId={`${id}-form`} category={editing === "new" ? null : editing} onBack={() => setEditing(null)} />
      ) : (
        <>
          {q.isError && <p role="alert" className="staff-notice">{t("expenses.loadError")}</p>}
          {q.data?.length === 0 && <p className="mg-hint">{t("expenses.cats.empty")}</p>}
          <ul className="ex-cats">
            {(q.data ?? []).map((c) => (
              <li key={c.id}>
                <span className="nm">
                  {loc(c.name, lang)}
                  {c.archived && <span className="ex-tag">{t("expenses.cats.archivedBadge")}</span>}
                </span>
                <span className="text-xs text-staff-fg-3">{t(`expenses.budget.kind.${c.kind}`)}</span>
                <span className="font-mono text-[13px]">{c.monthlyBudget > 0 ? money(c.monthlyBudget) : t("expenses.budget.none")}</span>
                <button type="button" className="staff-icon-btn" aria-label={t("expenses.cats.edit", { name: loc(c.name, lang) })} onClick={() => setEditing(c)}>
                  <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

function CategoryForm({ category, formId, onBack }: { category: CategoryRow | null; formId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const id = useId();
  const [nameEn, setNameEn] = useState(category?.name.en ?? "");
  const [nameTr, setNameTr] = useState(category?.name.tr ?? "");
  const [kind, setKind] = useState<Kind>(category?.kind ?? "other");
  const [budget, setBudget] = useState(category ? kurusToLira(category.monthlyBudget, lang) : "");
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [errors, setErrors] = useState<{ name?: string; budget?: string }>({});

  const save = useMutation({
    mutationFn: (body: object) =>
      category
        ? api(`/api/expense-categories/${category.id}`, { method: "PUT", body: JSON.stringify(body) })
        : api("/api/expense-categories", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      refreshExpenses(qc);
      onBack();
    },
  });
  const failure = !save.isError
    ? ""
    : save.error instanceof ApiClientError && save.error.status === 409
      ? t("expenses.cats.kindLocked")
      : errorMessage(t, save.error);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const kurus = liraToKurus(budget, { emptyIsZero: true });
    const next: typeof errors = {};
    if (!nameEn.trim() || !nameTr.trim()) next.name = t("expenses.cats.errors.name");
    if (kurus === null) next.budget = t("expenses.cats.errors.budget");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    save.mutate({
      name: { en: nameEn.trim(), tr: nameTr.trim() },
      kind,
      monthlyBudget: kurus,
      ...(category ? { archived } : {}),
    });
  };

  return (
    <form id={formId} onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice mb-3">{failure}</p>}
        <div className="mg-grid2">
          <div className="mg-field">
            <label htmlFor={`${id}-en`}>{t("expenses.cats.nameEn")}</label>
            <input id={`${id}-en`} className="mg-input" maxLength={80} autoComplete="off" lang="en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} {...(errors.name ? { "aria-invalid": true, "aria-describedby": `${id}-name-err` } : {})} />
          </div>
          <div className="mg-field">
            <label htmlFor={`${id}-tr`}>{t("expenses.cats.nameTr")}</label>
            <input id={`${id}-tr`} className="mg-input" maxLength={80} autoComplete="off" lang="tr" value={nameTr} onChange={(e) => setNameTr(e.target.value)} {...(errors.name ? { "aria-invalid": true, "aria-describedby": `${id}-name-err` } : {})} />
          </div>
        </div>
        {errors.name && <p id={`${id}-name-err`} className="mg-err mt-1">{errors.name}</p>}
        <div className="mg-grid2 mt-3">
          <div className="mg-field">
            <label htmlFor={`${id}-kind`}>{t("expenses.cats.kind")}</label>
            <select id={`${id}-kind`} className="mg-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="food_drink">{t("expenses.budget.kind.food_drink")}</option>
              <option value="other">{t("expenses.budget.kind.other")}</option>
            </select>
          </div>
          <div className="mg-field">
            <label htmlFor={`${id}-budget`}>{t("expenses.cats.budget")}</label>
            <input id={`${id}-budget`} className="mg-input font-mono" inputMode="decimal" autoComplete="off" value={budget} onChange={(e) => setBudget(e.target.value)} aria-describedby={`${id}-budget-hint${errors.budget ? ` ${id}-budget-err` : ""}`} {...(errors.budget ? { "aria-invalid": true } : {})} />
          </div>
        </div>
        <p id={`${id}-budget-hint`} className="mg-hint mt-1">{t("expenses.cats.budgetHint")}</p>
        {errors.budget && <p id={`${id}-budget-err`} className="mg-err">{errors.budget}</p>}
        {category && (
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {t("expenses.cats.archived")}
          </label>
        )}
    </form>
  );
}
