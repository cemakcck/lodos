import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Upload } from "lucide-react";
import { ALLERGENS, DIETARY, MenuItemInput } from "@lodos/shared";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { Dialog } from "../Dialog";
import { loc } from "../kds/lib";
import { OptionGroupsEditor, draftsToPayload, groupsToDrafts, type FieldA11y, type GroupDraft } from "./OptionGroupsEditor";
import { kurusToLira, liraToKurus } from "./price";
import { upsertItem } from "./queries";
import { managerMenuKey, type CategoryView, type ItemView, type Station } from "./types";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

interface FormState {
  categoryId: string;
  nameEn: string;
  nameTr: string;
  descEn: string;
  descTr: string;
  /** Lira as typed. */
  price: string;
  station: Station;
  dietary: string[];
  allergens: string[];
  active: boolean;
  groups: GroupDraft[];
}

const initial = (item: ItemView | null, lang: "en" | "tr", categoryId: string): FormState => ({
  categoryId: item?.categoryId ?? categoryId,
  nameEn: item?.name.en ?? "",
  nameTr: item?.name.tr ?? "",
  descEn: item?.description.en ?? "",
  descTr: item?.description.tr ?? "",
  price: item ? kurusToLira(item.price, lang) : "",
  station: item?.station ?? "kitchen",
  dietary: item?.dietary ?? [],
  allergens: item?.allergens ?? [],
  active: item?.active ?? true,
  groups: item ? groupsToDrafts(item.optionGroups, lang) : [],
});

/** The photo upload failed after the item itself was saved. */
class PhotoRefused extends Error {
  constructor(readonly item: ItemView, readonly reason: unknown) {
    super("photo refused");
  }
}

export interface ItemFormProps {
  /** The item to edit, or null for a new one. */
  item: ItemView | null;
  categories: CategoryView[];
  /** Category for a new item. */
  defaultCategoryId: string;
  onSaved: (item: ItemView, created: boolean) => void;
  onClose: () => void;
}

/**
 * The menu item editor, as a dialog. EN/TR name and description, category, price in lira (stored as kuruş),
 * station, dietary tags, allergens, photo (JPEG/PNG/WebP up to 2 MB, previewed, uploaded after the item saves),
 * visibility and option groups. Validated with the shared `MenuItemInput` before sending; errors sit under
 * their fields (`aria-describedby`) and focus moves to the first one.
 */
export function ItemForm({ item, categories, defaultCategoryId, onSaved, onClose }: ItemFormProps) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const qc = useQueryClient();
  const base = useId();
  const formId = `${base}-form`;
  const formRef = useRef<HTMLFormElement>(null);
  const [f, setF] = useState<FormState>(() => initial(item, lang, defaultCategoryId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  /** Set once a new item exists on the server, so a retry PATCHes instead of creating a second one. */
  const [savedId, setSavedId] = useState<string | undefined>(item?.id);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  useEffect(() => () => {
    if (photo && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(photo.url);
  }, [photo]);
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const idOf = (key: string) => `${base}-${key.replace(/\./g, "-")}`;
  const field = (key: string, hint = false): FieldA11y => {
    const id = idOf(key);
    const by = [hint ? `${id}-hint` : "", errors[key] ? `${id}-err` : ""].filter(Boolean).join(" ");
    return { id, ...(errors[key] ? { "aria-invalid": true as const } : {}), ...(by ? { "aria-describedby": by } : {}) };
  };
  const error = (key: string): ReactNode =>
    errors[key] ? (
      <p id={`${idOf(key)}-err`} className="mg-err">
        {errors[key]}
      </p>
    ) : null;
  const hint = (key: string, text: string) => (
    <p id={`${idOf(key)}-hint`} className="mg-hint">
      {text}
    </p>
  );

  const save = useMutation({
    mutationFn: async (payload: MenuItemInput): Promise<ItemView> => {
      const body = JSON.stringify(payload);
      const view = savedId
        ? await api<ItemView>(`/api/manager/items/${savedId}`, { method: "PATCH", body })
        : await api<ItemView>("/api/manager/items", { method: "POST", body });
      if (!photo) return view;
      const fd = new FormData();
      fd.append("file", photo.file);
      try {
        const r = await api<{ photo: string }>(`/api/manager/items/${view.id}/photo`, { method: "POST", body: fd });
        return { ...view, photo: r.photo };
      } catch (e) {
        throw new PhotoRefused(view, e);
      }
    },
    onSuccess: (view) => {
      upsertItem(qc, view);
      void qc.invalidateQueries({ queryKey: managerMenuKey });
      onSaved(view, !item);
    },
    onError: (e) => {
      if (e instanceof PhotoRefused) {
        setSavedId(e.item.id);
        upsertItem(qc, e.item);
        void qc.invalidateQueries({ queryKey: managerMenuKey });
        setPhotoErr(t("manager.item.photoFailed", { reason: errorMessage(t, e.reason) }));
      } else {
        setFormError(errorMessage(t, e));
      }
    },
  });

  const validate = (): { payload: MenuItemInput; errors: Record<string, string> } => {
    const errs: Record<string, string> = {};
    const price = liraToKurus(f.price);
    if (price === null) errs.price = t("manager.item.errors.price");
    const g = draftsToPayload(f.groups);
    const payload: MenuItemInput = {
      categoryId: f.categoryId,
      name: { en: f.nameEn, tr: f.nameTr },
      description: { en: f.descEn, tr: f.descTr },
      ...(item ? { story: item.story } : {}),
      price: price ?? 1,
      station: f.station,
      dietary: f.dietary as MenuItemInput["dietary"],
      allergens: f.allergens as MenuItemInput["allergens"],
      optionGroups: g.groups,
      active: f.active,
    };
    const r = MenuItemInput.safeParse(payload);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const key = issue.path.map(String).join(".");
        if (errs[key]) continue;
        errs[key] =
          key === "price"
            ? t("manager.item.errors.price")
            : issue.code === "too_small"
              ? t("manager.item.errors.required")
              : issue.code === "too_big"
                ? t("manager.item.errors.tooLong")
                : t("manager.item.errors.invalid");
      }
    }
    for (const [key, kind] of Object.entries(g.errors)) errs[key] ??= t(`manager.item.errors.${kind}`);
    return { payload, errors: errs };
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setFormError(null);
    setPhotoErr(null);
    const v = validate();
    setErrors(v.errors);
    setAttempt((n) => n + 1);
    if (Object.keys(v.errors).length > 0) return;
    save.mutate(v.payload);
  };

  const pickPhoto = (file: File | undefined) => {
    setPhotoErr(null);
    if (!file) return;
    const bad = !(PHOTO_TYPES as readonly string[]).includes(file.type)
      ? t("manager.item.photoType")
      : file.size > MAX_PHOTO_BYTES
        ? t("manager.item.photoTooBig")
        : null;
    if (bad) {
      setPhotoErr(bad);
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setPhoto({ file, url: URL.createObjectURL(file) });
  };
  const discardPhoto = () => {
    setPhoto(null);
    setPhotoErr(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const invalidCount = Object.keys(errors).length;
  const photoId = idOf("photo");
  const photoBy = [`${photoId}-hint`, photoErr ? `${photoId}-err` : ""].filter(Boolean).join(" ");
  const currentPhoto = item?.photo ?? null;

  return (
    <Dialog
      title={item ? t("manager.item.editTitle", { name: loc(item.name, lang) }) : t("manager.item.newTitle")}
      onClose={onClose}
      width={760}
      footer={
        <div className="mg-form-f">
          {invalidCount > 0 && <p className="mg-err" role="status">{t("manager.item.errors.summary")}</p>}
          <div className="staff-grow" />
          <button type="button" className="staff-btn" onClick={onClose}>
            {t("manager.item.cancel")}
          </button>
          <button type="submit" form={formId} className="staff-btn primary" disabled={save.isPending}>
            {save.isPending ? t("manager.item.saving") : item ? t("manager.item.save") : t("manager.item.create")}
          </button>
        </div>
      }
    >
      <form id={formId} ref={formRef} className="mg-form" onSubmit={submit} noValidate>
        {formError && (
          <p role="alert" className="staff-notice">
            {formError}
          </p>
        )}

        <section className="mg-section" aria-labelledby={`${base}-details`}>
          <div className="mg-section-h">
            <h3 id={`${base}-details`}>{t("manager.item.details")}</h3>
          </div>
          <div className="mg-grid2">
            <div className="mg-field">
              <label htmlFor={idOf("name.en")}>{t("manager.item.nameEn")}</label>
              <input className="mg-input" {...field("name.en")} value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} />
              {error("name.en")}
            </div>
            <div className="mg-field">
              <label htmlFor={idOf("name.tr")}>{t("manager.item.nameTr")}</label>
              <input className="mg-input" lang="tr" {...field("name.tr")} value={f.nameTr} onChange={(e) => set({ nameTr: e.target.value })} />
              {error("name.tr")}
            </div>
            <div className="mg-field">
              <label htmlFor={idOf("description.en")}>{t("manager.item.descEn")}</label>
              <textarea className="mg-input" rows={3} {...field("description.en")} value={f.descEn} onChange={(e) => set({ descEn: e.target.value })} />
              {error("description.en")}
            </div>
            <div className="mg-field">
              <label htmlFor={idOf("description.tr")}>{t("manager.item.descTr")}</label>
              <textarea className="mg-input" lang="tr" rows={3} {...field("description.tr")} value={f.descTr} onChange={(e) => set({ descTr: e.target.value })} />
              {error("description.tr")}
            </div>
          </div>

          <div className="mg-grid3">
            <div className="mg-field">
              <label htmlFor={idOf("categoryId")}>{t("manager.item.category")}</label>
              <select className="mg-input" {...field("categoryId")} value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {loc(c.name, lang)}
                    {c.active ? "" : ` (${t("manager.category.hiddenTag")})`}
                  </option>
                ))}
              </select>
              {error("categoryId")}
            </div>
            <div className="mg-field">
              <label htmlFor={idOf("price")}>{t("manager.item.price")}</label>
              <span className="mg-money">
                <span aria-hidden="true">₺</span>
                <input
                  className="mg-input font-mono"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="640"
                  {...field("price", true)}
                  value={f.price}
                  onChange={(e) => set({ price: e.target.value })}
                />
              </span>
              {hint("price", t("manager.item.priceHint"))}
              {error("price")}
            </div>
            <fieldset className="mg-field">
              <legend>{t("manager.item.station")}</legend>
              <div className="mg-radios" aria-describedby={`${idOf("station")}-hint`}>
                {(["kitchen", "bar"] as const).map((s) => (
                  <label key={s} className={f.station === s ? "is-on" : undefined}>
                    <input type="radio" name={`${base}-station`} checked={f.station === s} onChange={() => set({ station: s })} />
                    {t(`manager.menu.station.${s}`)}
                  </label>
                ))}
              </div>
              {hint("station", t("manager.item.stationHint"))}
            </fieldset>
          </div>
        </section>

        <section className="mg-section" aria-labelledby={`${base}-tags`}>
          <div className="mg-section-h">
            <h3 id={`${base}-tags`}>
              {t("manager.item.dietary")} · {t("manager.item.allergens")}
            </h3>
          </div>
          <fieldset className="mg-field">
            <legend>{t("manager.item.dietary")}</legend>
            <div className="mg-chips">
              {DIETARY.map((d) => (
                <label key={d} className={f.dietary.includes(d) ? "is-on" : undefined}>
                  <input type="checkbox" checked={f.dietary.includes(d)} onChange={() => set({ dietary: toggle(f.dietary, d) })} />
                  {t(`manager.item.dietaryNames.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mg-field" aria-describedby={`${idOf("allergens")}-hint`}>
            <legend>{t("manager.item.allergens")}</legend>
            <div className="mg-chips is-allergens">
              {ALLERGENS.map((a) => (
                <label key={a} className={f.allergens.includes(a) ? "is-on" : undefined}>
                  <input type="checkbox" checked={f.allergens.includes(a)} onChange={() => set({ allergens: toggle(f.allergens, a) })} />
                  {t(`guest.allergens.${a}`)}
                </label>
              ))}
            </div>
            {hint("allergens", t("manager.item.allergensHint"))}
          </fieldset>
        </section>

        <section className="mg-section">
          <div className="mg-photo">
            <div className="mg-photo-frame">
              {photo ? (
                <img src={photo.url} alt={t("manager.item.photoNew")} />
              ) : currentPhoto ? (
                <img src={currentPhoto} alt={t("manager.item.photoCurrent")} />
              ) : (
                <span className="mg-photo-none">
                  <ImageOff size={18} strokeWidth={1.5} aria-hidden="true" />
                  {t("manager.item.photoNone")}
                </span>
              )}
            </div>
            <div className="mg-field">
              <label htmlFor={photoId}>{t("manager.item.photo")}</label>
              <span className="mg-file">
                <Upload size={15} strokeWidth={1.75} aria-hidden="true" />
                <input
                  ref={fileRef}
                  id={photoId}
                  type="file"
                  accept={PHOTO_TYPES.join(",")}
                  aria-describedby={photoBy}
                  aria-invalid={photoErr ? true : undefined}
                  onChange={(e) => pickPhoto(e.target.files?.[0])}
                />
              </span>
              <p id={`${photoId}-hint`} className="mg-hint">
                {t("manager.item.photoHint")}
                {photo ? (
                  <> · {t("manager.item.photoNew")}</>
                ) : (
                  currentPhoto && (
                    <>
                      {" · "}
                      {t("manager.item.photoCurrent")}: <code className="font-mono">{currentPhoto}</code>
                    </>
                  )
                )}
              </p>
              {photoErr && (
                <p id={`${photoId}-err`} className="mg-err" role="alert">
                  {photoErr}
                </p>
              )}
              {photo && (
                <button type="button" className="staff-btn mg-photo-discard" onClick={discardPhoto}>
                  {t("manager.item.photoDiscard")}
                </button>
              )}
            </div>
          </div>
        </section>

        <OptionGroupsEditor groups={f.groups} onChange={(groups) => set({ groups })} field={field} error={error} />

        <section className="mg-section mg-vis">
          <button
            type="button"
            role="switch"
            aria-checked={f.active}
            aria-describedby={`${idOf("active")}-hint`}
            className="mg-switch is-ok"
            onClick={() => set({ active: !f.active })}
          >
            <span className="track" aria-hidden="true">
              <span className="thumb" />
            </span>
            <span className="lbl">{t("manager.item.visibility")}</span>
            <span className="state">{f.active ? t("manager.item.visOn") : t("manager.item.visOff")}</span>
          </button>
          {hint("active", t("manager.item.visHint"))}
        </section>
      </form>
    </Dialog>
  );
}
