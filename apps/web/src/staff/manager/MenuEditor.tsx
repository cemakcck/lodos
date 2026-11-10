import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Flame, ImageOff, Pencil, Plus, Search, Wine } from "lucide-react";
import { CategoryInput, fold } from "@lodos/shared";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { Shell } from "../Shell";
import { loc } from "../kds/lib";
import { Availability } from "./Availability";
import { ItemForm } from "./ItemForm";
import { useManagerMenu } from "./queries";
import { managerMenuKey, type CategoryView, type ItemView, type ManagerMenu } from "./types";

const bySort = <T extends { sort: number; id: string }>(a: T, b: T) => a.sort - b.sort || a.id.localeCompare(b.id);

/**
 * `/staff/menu`: categories on the left (add, rename, reorder with up/down), the items on the right with photo,
 * EN/TR name, price, station, a status chip and the inline 86 switch and "N left". Selecting an item opens
 * the item editor. `?category=<id>` keeps the selected category.
 */
export function MenuEditor() {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const qc = useQueryClient();
  const menu = useManagerMenu();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<ItemView | "new" | null>(null);
  const [catDialog, setCatDialog] = useState<CategoryView | "new" | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const categories = useMemo(() => [...(menu.data?.categories ?? [])].sort(bySort), [menu.data]);
  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const selected = categories.find((c) => c.id === params.get("category")) ?? null;
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set("category", id);
      else n.delete("category");
      return n;
    }, { replace: true });

  const countIn = (id: string) => items.filter((i) => i.categoryId === id).length;
  const needle = fold(q.trim());
  const visible = items.filter(
    (i) => (!selected || i.categoryId === selected.id) && (!needle || fold(i.name.en).includes(needle) || fold(i.name.tr).includes(needle)),
  );
  const sections = categories
    .filter((c) => !selected || c.id === selected.id)
    .map((c) => ({ cat: c, rows: visible.filter((i) => i.categoryId === c.id).sort(bySort) }))
    .filter((s) => selected || s.rows.length > 0);

  const reorder = useMutation({
    mutationFn: (changes: { id: string; sort: number }[]) =>
      Promise.all(changes.map((c) => api(`/api/manager/categories/${c.id}`, { method: "PATCH", body: JSON.stringify({ sort: c.sort }) }))),
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: managerMenuKey });
      const prev = qc.getQueryData<ManagerMenu>(managerMenuKey);
      const next = new Map(changes.map((c) => [c.id, c.sort]));
      qc.setQueryData<ManagerMenu>(managerMenuKey, (m) =>
        m ? { ...m, categories: m.categories.map((c) => (next.has(c.id) ? { ...c, sort: next.get(c.id)! } : c)) } : m,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(managerMenuKey, ctx.prev);
      setStatus(t("manager.menu.moveFailed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: managerMenuKey }),
  });

  /** Swap with the neighbour; when sorts collide, renumber everything in tens so the order is unambiguous. */
  const move = (index: number, dir: -1 | 1) => {
    const a = categories[index];
    const b = categories[index + dir];
    if (!a || !b || reorder.isPending) return;
    if (a.sort !== b.sort) {
      reorder.mutate([{ id: a.id, sort: b.sort }, { id: b.id, sort: a.sort }]);
      return;
    }
    const order = [...categories];
    order[index] = b;
    order[index + dir] = a;
    reorder.mutate(order.map((c, i) => ({ id: c.id, sort: (i + 1) * 10 })).filter((c, i) => order[i]!.sort !== c.sort));
  };

  const stats = menu.data && (
    <>
      <span><b>{items.length}</b>{t("manager.menu.stats.items")}</span>
      <span><b>{items.filter((i) => i.availability.soldOut).length}</b>{t("manager.menu.stats.soldOut")}</span>
      <span><b>{items.filter((i) => !i.availability.soldOut && i.availability.remaining !== null).length}</b>{t("manager.menu.stats.low")}</span>
      <span><b>{items.filter((i) => !i.active).length}</b>{t("manager.menu.stats.hidden")}</span>
    </>
  );

  const actions = (
    <>
      <label className="kds-search mg-search">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("manager.menu.search")} placeholder={t("manager.menu.search")} />
      </label>
      <button type="button" className="staff-btn primary" onClick={() => setEditing("new")} disabled={categories.length === 0}>
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("manager.menu.newItem")}
      </button>
    </>
  );

  return (
    <Shell title={t("manager.menu.title")} actions={actions} stats={stats ?? null} clock={false}>
      {!menu.data ? (
        <div className="mg-blocking" role={menu.isError ? "alert" : "status"}>
          {menu.isError ? (
            <>
              <p>{t("manager.menu.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void menu.refetch()}>{t("manager.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-menu">
          <nav className="mg-cats" aria-label={t("manager.menu.categories")}>
            <div className="mg-cats-h">
              <h2 className="staff-label">{t("manager.menu.categories")}</h2>
              <button type="button" className="staff-btn mg-cat-add" onClick={() => setCatDialog("new")}>
                <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                {t("manager.menu.addCategory")}
              </button>
            </div>
            <button type="button" className="mg-cat-pick is-all" aria-pressed={!selected} onClick={() => select(null)}>
              <span className="nm">{t("manager.menu.all")}</span>
              <span className="n">{items.length}</span>
            </button>
            <ul>
              {categories.map((c, i) => {
                const name = loc(c.name, lang);
                return (
                  <li key={c.id} className="mg-cat">
                    <button type="button" className="mg-cat-pick" aria-pressed={selected?.id === c.id} onClick={() => select(c.id)}>
                      <span className="nm">{name}</span>
                      {!c.active && <span className="mg-tag">{t("manager.category.hiddenTag")}</span>}
                      <span className="n">{countIn(c.id)}</span>
                    </button>
                    <span className="mg-cat-tools">
                      <button type="button" className="staff-icon-btn" aria-label={t("manager.menu.moveUp", { name })} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <button type="button" className="staff-icon-btn" aria-label={t("manager.menu.moveDown", { name })} disabled={i === categories.length - 1} onClick={() => move(i, 1)}>
                        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <button type="button" className="staff-icon-btn" aria-label={t("manager.menu.rename", { name })} onClick={() => setCatDialog(c)}>
                        <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mg-items">
            <p role="status" className="mg-status">{status}</p>
            <table className="mg-table">
              <caption className="sr-only">{selected ? t("manager.menu.itemsIn", { name: loc(selected.name, lang) }) : t("manager.menu.items")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="c-photo"><span className="sr-only">{t("manager.menu.col.photo")}</span></th>
                  <th scope="col">{t("manager.menu.col.name")}</th>
                  <th scope="col" className="c-num">{t("manager.menu.col.price")}</th>
                  <th scope="col">{t("manager.menu.col.station")}</th>
                  <th scope="col">{t("manager.menu.col.status")}</th>
                  <th scope="col">{t("manager.menu.col.eightySix")}</th>
                </tr>
              </thead>
              {sections.map(({ cat, rows }) => (
                <tbody key={cat.id}>
                  {!selected && (
                    <tr className="mg-sec">
                      <th scope="colgroup" colSpan={6}>{loc(cat.name, lang)}</th>
                    </tr>
                  )}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="mg-empty">{needle ? t("manager.menu.noMatch", { q }) : t("manager.menu.empty")}</td>
                    </tr>
                  )}
                  {rows.map((i) => (
                    <ItemRow key={i.id} item={i} lang={lang} price={money(i.price)} onEdit={() => setEditing(i)} />
                  ))}
                </tbody>
              ))}
              {sections.length === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={6} className="mg-empty">{needle ? t("manager.menu.noMatch", { q }) : t("manager.menu.empty")}</td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </div>
      )}

      {editing && menu.data && (
        <ItemForm
          item={editing === "new" ? null : editing}
          categories={categories}
          defaultCategoryId={selected?.id ?? categories[0]?.id ?? ""}
          onClose={() => setEditing(null)}
          onSaved={(view, created) => {
            setEditing(null);
            setStatus(t(created ? "manager.item.created" : "manager.item.saved", { name: loc(view.name, lang) }));
          }}
        />
      )}
      {catDialog && (
        <CategoryDialog
          category={catDialog === "new" ? null : catDialog}
          nextSort={(categories.at(-1)?.sort ?? 0) + 10}
          onClose={() => setCatDialog(null)}
          onDeleted={(id) => {
            setCatDialog(null);
            if (selected?.id === id) select(null);
          }}
        />
      )}
    </Shell>
  );
}

function ItemRow({ item, lang, price, onEdit }: { item: ItemView; lang: "en" | "tr"; price: string; onEdit: () => void }) {
  const { t } = useTranslation();
  const name = loc(item.name, lang);
  const other = loc(item.name, lang === "en" ? "tr" : "en");
  const { soldOut, remaining } = item.availability;
  const chip = !item.active
    ? { cls: "is-hidden", text: t("manager.menu.status.hidden") }
    : soldOut
      ? { cls: "is-out", text: t("manager.menu.status.soldOut") }
      : remaining !== null
        ? { cls: "is-low", text: t("manager.menu.status.left", { count: remaining }) }
        : { cls: "is-ok", text: t("manager.menu.status.available") };
  const StationIcon = item.station === "bar" ? Wine : Flame;
  return (
    <tr className={item.active ? undefined : "is-inactive"}>
      <td className="c-photo">
        {item.photo ? (
          <img src={item.photo} alt="" loading="lazy" className="mg-thumb" />
        ) : (
          <span className="mg-thumb is-none" title={t("manager.menu.noPhoto")}>
            <ImageOff size={14} strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
      </td>
      <td className="c-name">
        <button type="button" className="mg-item-btn" aria-label={t("manager.menu.edit", { name })} onClick={onEdit}>
          <span className="nm">{name}</span>
          {other !== name && <span className="alt" lang={lang === "en" ? "tr" : "en"}>{other}</span>}
          {item.optionGroups.length > 0 && <span className="meta">{t("manager.menu.options", { count: item.optionGroups.length })}</span>}
        </button>
      </td>
      <td className="c-num font-mono">{price}</td>
      <td className="c-station">
        <span>
          <StationIcon size={14} strokeWidth={1.75} aria-hidden="true" />
          {t(`manager.menu.station.${item.station}`)}
        </span>
      </td>
      <td>
        <span className={`mg-chip ${chip.cls}`}>{chip.text}</span>
      </td>
      <td className="c-avail">
        <Availability itemId={item.id} />
      </td>
    </tr>
  );
}

function CategoryDialog({
  category, nextSort, onClose, onDeleted,
}: { category: CategoryView | null; nextSort: number; onClose: () => void; onDeleted: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = useId();
  const first = useRef<HTMLInputElement>(null);
  const [en, setEn] = useState(category?.name.en ?? "");
  const [tr, setTr] = useState(category?.name.tr ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const [errors, setErrors] = useState<{ en?: string; tr?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: CategoryInput) =>
      category
        ? api<CategoryView>(`/api/manager/categories/${category.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api<CategoryView>("/api/manager/categories", { method: "POST", body: JSON.stringify({ ...body, sort: nextSort }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: managerMenuKey });
      onClose();
    },
    onError: (e) => setFailure(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/manager/categories/${category!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: managerMenuKey });
      onDeleted(category!.id);
    },
    onError: (e) =>
      setFailure(e instanceof ApiClientError && e.status === 409 ? t("manager.category.deleteConflict") : errorMessage(t, e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const r = CategoryInput.safeParse({ name: { en, tr }, active });
    if (!r.success) {
      const errs: { en?: string; tr?: string } = {};
      for (const i of r.error.issues) {
        const k = i.path[1] as "en" | "tr";
        errs[k] ??= i.code === "too_big" ? t("manager.item.errors.tooLong") : t("manager.item.errors.required");
      }
      setErrors(errs);
      (errs.en ? first.current : document.getElementById(`${base}-tr`))?.focus();
      return;
    }
    setErrors({});
    save.mutate(r.data);
  };

  const input = (k: "en" | "tr", label: string, value: string, onChange: (v: string) => void) => (
    <div className="mg-field">
      <label htmlFor={`${base}-${k}`}>{label}</label>
      <input
        ref={k === "en" ? first : undefined}
        id={`${base}-${k}`}
        className="mg-input"
        lang={k}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `${base}-${k}-err` : undefined}
      />
      {errors[k] && <p id={`${base}-${k}-err`} className="mg-err">{errors[k]}</p>}
    </div>
  );

  return (
    <Dialog
      title={category ? t("manager.category.editTitle") : t("manager.category.addTitle")}
      onClose={onClose}
      initialFocus={first}
      width={440}
      footer={
        <div className="mg-form-f">
          {category && (
            <button type="button" className="staff-btn mg-danger" disabled={remove.isPending} onClick={() => { setFailure(null); remove.mutate(); }}>
              {t("manager.category.delete")}
            </button>
          )}
          <div className="staff-grow" />
          <button type="button" className="staff-btn" onClick={onClose}>{t("manager.item.cancel")}</button>
          <button type="submit" form={`${base}-form`} className="staff-btn primary" disabled={save.isPending}>
            {category ? t("manager.category.save") : t("manager.category.create")}
          </button>
        </div>
      }
    >
      <form id={`${base}-form`} className="mg-form" onSubmit={submit} noValidate>
        {failure && <p role="alert" className="staff-notice">{failure}</p>}
        {input("en", t("manager.category.nameEn"), en, setEn)}
        {input("tr", t("manager.category.nameTr"), tr, setTr)}
        <button type="button" role="switch" aria-checked={active} className="mg-switch is-ok" onClick={() => setActive((a) => !a)}>
          <span className="track" aria-hidden="true"><span className="thumb" /></span>
          <span className="lbl">{t("manager.category.shown")}</span>
          <span className="state">{active ? t("manager.item.visOn") : t("manager.item.visOff")}</span>
        </button>
      </form>
    </Dialog>
  );
}
