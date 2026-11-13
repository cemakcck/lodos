import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Tags } from "lucide-react";
import { useFormat } from "../../lib/format";
import { Shell } from "../Shell";
import { loc } from "../kds/lib";
import { Categories } from "./Categories";
import { ExpenseForm } from "./ExpenseForm";
import { expensesQuery, monthLabel, shiftMonth, useCategories, useExpenses, type ByCategory, type ExpenseRow, type ExpensesView } from "./queries";

function BudgetBars({ view }: { view: ExpensesView }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const id = useId();
  // The scale is the larger of spend and budget over every category, so a bar never overflows its track.
  const max = Math.max(1, ...view.byCategory.map((c) => Math.max(c.spent, c.budget)));
  return (
    <section className="sa-card ex-budget" aria-labelledby={id}>
      <div className="sa-card-h">
        <h2 id={id}>{t("expenses.budget.title")}</h2>
        <span className="font-mono text-[13px] text-staff-fg-2">
          {view.budgetTotal > 0
            ? t("expenses.budget.summary", { spent: money(view.total), budget: money(view.budgetTotal) })
            : t("expenses.budget.total", { spent: money(view.total) })}
        </span>
      </div>
      {view.byCategory.length === 0 ? (
        <p className="sa-empty">{t("expenses.budget.empty")}</p>
      ) : (
        <ul aria-label={t("expenses.budget.title")}>
          {view.byCategory.map((c) => (
            <Bar key={c.categoryId} c={c} max={max} lang={lang} money={money} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Bar({ c, max, lang, money }: { c: ByCategory; max: number; lang: "en" | "tr"; money: (k: number) => string }) {
  const { t } = useTranslation();
  const over = c.budget > 0 && c.spent > c.budget;
  // Status is always words; the bar and its colour only echo it.
  const status =
    c.budget === 0 ? t("expenses.budget.none") : over ? t("expenses.budget.over", { amount: money(c.spent - c.budget) }) : t("expenses.budget.under", { amount: money(c.budget - c.spent) });
  return (
    <li className={over ? "is-over" : undefined}>
      <span className="nm">{loc(c.name, lang)}</span>
      <span className="meter" aria-hidden="true">
        <span className="fill" style={{ width: `${(c.spent / max) * 100}%` }} />
        {c.budget > 0 && <span className="mark" style={{ left: `${(c.budget / max) * 100}%` }} />}
      </span>
      <span className="amt font-mono">{c.budget > 0 ? t("expenses.budget.of", { spent: money(c.spent), budget: money(c.budget) }) : money(c.spent)}</span>
      <span className="st">{status}</span>
    </li>
  );
}

/** `/staff/expenses` (manager): a month at a time, spend against budget per category, the expense list and its CSV. */
export function Expenses() {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const [month, setMonth] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const q = useExpenses(month, categoryId);
  const cats = useCategories();
  const view = q.data;
  const [form, setForm] = useState<ExpenseRow | "new" | null>(null);
  const [showCats, setShowCats] = useState(false);
  const [status, setStatus] = useState("");

  const catName = new Map((cats.data ?? []).map((c) => [c.id, loc(c.name, lang)]));
  const go = (m: string | null) => {
    setMonth(m);
    setStatus("");
  };

  const toolbar = view && (
    <div className="sc-week" role="group" aria-label={t("expenses.month.label")}>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("expenses.month.prev")} onClick={() => go(shiftMonth(view.month, -1))}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className="sc-range font-mono" aria-live="polite">{monthLabel(view.month, lang)}</span>
      <button type="button" className="staff-icon-btn sc-nav" aria-label={t("expenses.month.next")} onClick={() => go(shiftMonth(view.month, 1))}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="staff-btn" disabled={month === null} onClick={() => go(null)}>{t("expenses.month.this")}</button>
    </div>
  );
  const actions = view && (
    <>
      <a className="staff-btn" href={`/api/expenses.csv${expensesQuery(view.month, categoryId)}`} download>
        <Download size={16} aria-hidden="true" />
        {t("expenses.export")}
      </a>
      <button type="button" className="staff-btn" onClick={() => setShowCats(true)}>
        <Tags size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("expenses.categories")}
      </button>
      <button type="button" className="staff-btn primary" onClick={() => { setStatus(""); setForm("new"); }}>
        <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
        {t("expenses.add")}
      </button>
    </>
  );

  return (
    <Shell title={t("expenses.title")} toolbar={toolbar} actions={actions} clock={false}>
      {!view ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("expenses.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("expenses.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page sa-page" role="region" aria-label={t("expenses.title")} tabIndex={0}>
          <p role="status" className="mg-status">{status}</p>
          <BudgetBars view={view} />
          <section className="sa-card ex-list">
            <div className="sa-card-h">
              <h2>{t("expenses.list.title")}</h2>
              <div className="mg-field ex-filter">
                <label htmlFor="ex-filter">{t("expenses.list.filter")}</label>
                <select id="ex-filter" className="mg-input" value={categoryId} onChange={(e) => { setMonth((m) => m ?? view.month); setCategoryId(e.target.value); }}>
                  <option value="">{t("expenses.list.all")}</option>
                  {view.byCategory.map((c) => (
                    <option key={c.categoryId} value={c.categoryId}>{loc(c.name, lang)}</option>
                  ))}
                </select>
              </div>
            </div>
            {view.expenses.length === 0 ? (
              <p className="sa-empty">{t("expenses.list.empty")}</p>
            ) : (
              <table className="ex-table" aria-label={t("expenses.list.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("expenses.list.date")}</th>
                    <th scope="col">{t("expenses.list.category")}</th>
                    <th scope="col">{t("expenses.list.payee")}</th>
                    <th scope="col">{t("expenses.list.note")}</th>
                    <th scope="col" className="r">{t("expenses.list.amount")}</th>
                    <th scope="col"><span className="sr-only">{t("expenses.list.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {view.expenses.map((x) => {
                    const cat = catName.get(x.categoryId) ?? "";
                    return (
                      <tr key={x.id}>
                        <td className="font-mono">{x.date}</td>
                        <td>{cat}</td>
                        <td>{x.payee}</td>
                        <td className="text-staff-fg-2">{x.note}</td>
                        <td className="r font-mono">{money(x.amount)}</td>
                        <td className="r">
                          <button type="button" className="staff-icon-btn" aria-label={t("expenses.list.edit", { category: cat, date: x.date })} onClick={() => { setStatus(""); setForm(x); }}>
                            <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
      {form && (
        <ExpenseForm
          expense={form === "new" ? null : form}
          categories={cats.data ?? []}
          onClose={() => setForm(null)}
          onDone={() => setForm(null)}
        />
      )}
      {showCats && <Categories onClose={() => setShowCats(false)} />}
    </Shell>
  );
}
