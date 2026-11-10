import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { liraToKurus, kurusToLira } from "./price";
import type { OptionGroupView } from "./types";

export interface OptionDraft {
  /** Local React key; never sent. */
  key: string;
  /** The server id, echoed back on save so it stays stable. Absent for a new option. */
  id?: string;
  nameEn: string;
  nameTr: string;
  /** Lira as typed; empty means no change. */
  delta: string;
}
export interface GroupDraft {
  key: string;
  id?: string;
  nameEn: string;
  nameTr: string;
  type: "single" | "multi";
  required: boolean;
  options: OptionDraft[];
}

let seq = 0;
const nextKey = () => `k${++seq}`;

export const newOption = (): OptionDraft => ({ key: nextKey(), nameEn: "", nameTr: "", delta: "" });
export const newGroup = (): GroupDraft => ({ key: nextKey(), nameEn: "", nameTr: "", type: "single", required: false, options: [] });

export function groupsToDrafts(groups: OptionGroupView[], lang: "en" | "tr"): GroupDraft[] {
  return groups.map((g) => ({
    key: nextKey(),
    id: g.id,
    nameEn: g.name.en,
    nameTr: g.name.tr,
    type: g.type,
    required: g.required,
    options: g.options.map((o) => ({
      key: nextKey(),
      id: o.id,
      nameEn: o.name.en,
      nameTr: o.name.tr,
      delta: o.priceDelta === 0 ? "" : kurusToLira(o.priceDelta, lang),
    })),
  }));
}

export type GroupPayload = {
  id?: string;
  name: { en: string; tr: string };
  type: "single" | "multi";
  required: boolean;
  options: { id?: string; name: { en: string; tr: string }; priceDelta: number }[];
};

/**
 * Drafts → the `optionGroups` body. Existing ids are kept, new entries go without one (the server makes them).
 * Price changes that don't parse, and groups without options, are reported by field key.
 */
export function draftsToPayload(groups: GroupDraft[]): { groups: GroupPayload[]; errors: Record<string, "delta" | "noOptions"> } {
  const errors: Record<string, "delta" | "noOptions"> = {};
  const out = groups.map((g, gi) => {
    if (g.options.length === 0) errors[`optionGroups.${gi}.options`] = "noOptions";
    return {
      ...(g.id ? { id: g.id } : {}),
      name: { en: g.nameEn, tr: g.nameTr },
      type: g.type,
      required: g.required,
      options: g.options.map((o, oi) => {
        const d = liraToKurus(o.delta, { signed: true, emptyIsZero: true });
        if (d === null) errors[`optionGroups.${gi}.options.${oi}.priceDelta`] = "delta";
        return { ...(o.id ? { id: o.id } : {}), name: { en: o.nameEn, tr: o.nameTr }, priceDelta: d ?? 0 };
      }),
    };
  });
  return { groups: out, errors };
}

export interface FieldA11y {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export interface OptionGroupsEditorProps {
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
  /** Accessibility props for a field key (id, aria-invalid, aria-describedby). */
  field: (key: string) => FieldA11y;
  /** The error text element for a field key, or null. */
  error: (key: string) => React.ReactNode;
}

/** Add, edit and remove option groups (single or multi, required or optional) and their options with price changes. */
export function OptionGroupsEditor({ groups, onChange, field, error }: OptionGroupsEditorProps) {
  const { t } = useTranslation();
  const setGroup = (gi: number, patch: Partial<GroupDraft>) => onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setOption = (gi: number, oi: number, patch: Partial<OptionDraft>) =>
    setGroup(gi, { options: groups[gi]!.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });

  return (
    <section className="mg-section" aria-labelledby="mg-groups-h">
      <div className="mg-section-h">
        <h3 id="mg-groups-h">{t("manager.groups.title")}</h3>
        <p>{t("manager.groups.hint")}</p>
      </div>
      {groups.length === 0 && <p className="mg-muted">{t("manager.groups.empty")}</p>}
      {groups.map((g, gi) => {
        const n = gi + 1;
        const p = `optionGroups.${gi}`;
        return (
          <fieldset key={g.key} className="mg-group">
            <legend className="staff-label">{t("manager.groups.group", { n })}</legend>
            <button
              type="button"
              className="staff-icon-btn mg-group-x"
              aria-label={t("manager.groups.remove", { n })}
              onClick={() => onChange(groups.filter((_, i) => i !== gi))}
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <div className="mg-grid2">
              <div className="mg-field">
                <label htmlFor={field(`${p}.name.en`).id}>{t("manager.groups.nameEn")}</label>
                <input className="mg-input" {...field(`${p}.name.en`)} value={g.nameEn} onChange={(e) => setGroup(gi, { nameEn: e.target.value })} />
                {error(`${p}.name.en`)}
              </div>
              <div className="mg-field">
                <label htmlFor={field(`${p}.name.tr`).id}>{t("manager.groups.nameTr")}</label>
                <input className="mg-input" lang="tr" {...field(`${p}.name.tr`)} value={g.nameTr} onChange={(e) => setGroup(gi, { nameTr: e.target.value })} />
                {error(`${p}.name.tr`)}
              </div>
            </div>
            <div className="mg-group-rules">
              <fieldset className="mg-radios">
                <legend className="sr-only">{t("manager.groups.type")}</legend>
                {(["single", "multi"] as const).map((type) => (
                  <label key={type} className={g.type === type ? "is-on" : undefined}>
                    <input type="radio" name={`type-${g.key}`} checked={g.type === type} onChange={() => setGroup(gi, { type })} />
                    {t(`manager.groups.${type}`)}
                  </label>
                ))}
              </fieldset>
              <label className="mg-check">
                <input type="checkbox" checked={g.required} onChange={(e) => setGroup(gi, { required: e.target.checked })} />
                {t("manager.groups.required")}
              </label>
            </div>

            {g.options.length > 0 && (
              <div className="mg-opt-head" aria-hidden="true">
                <span>{t("manager.groups.optNameEn")}</span>
                <span>{t("manager.groups.optNameTr")}</span>
                <span>{t("manager.groups.delta")}</span>
                <span />
              </div>
            )}
            <ol className="mg-opts">
              {g.options.map((o, oi) => {
                const op = `${p}.options.${oi}`;
                const m = oi + 1;
                return (
                  <li key={o.key} role="group" aria-label={t("manager.groups.option", { n: m })} className="mg-opt">
                    <input className="mg-input" aria-label={t("manager.groups.optNameEn")} {...field(`${op}.name.en`)} value={o.nameEn} onChange={(e) => setOption(gi, oi, { nameEn: e.target.value })} />
                    <input className="mg-input" lang="tr" aria-label={t("manager.groups.optNameTr")} {...field(`${op}.name.tr`)} value={o.nameTr} onChange={(e) => setOption(gi, oi, { nameTr: e.target.value })} />
                    <span className="mg-money">
                      <span aria-hidden="true">₺</span>
                      <input
                        className="mg-input font-mono"
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={t("manager.groups.delta")}
                        {...field(`${op}.priceDelta`)}
                        value={o.delta}
                        onChange={(e) => setOption(gi, oi, { delta: e.target.value })}
                      />
                    </span>
                    <button
                      type="button"
                      className="staff-icon-btn"
                      aria-label={t("manager.groups.removeOption", { n: m })}
                      onClick={() => setGroup(gi, { options: g.options.filter((_, i) => i !== oi) })}
                    >
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <div className="mg-opt-errs">
                      {error(`${op}.name.en`)}
                      {error(`${op}.name.tr`)}
                      {error(`${op}.priceDelta`)}
                    </div>
                  </li>
                );
              })}
            </ol>
            {error(`${p}.options`)}
            <button
              type="button"
              className="staff-btn mg-add-opt"
              id={field(`${p}.options`).id}
              aria-describedby={field(`${p}.options`)["aria-describedby"]}
              onClick={() => setGroup(gi, { options: [...g.options, newOption()] })}>
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
              {t("manager.groups.addOption")}
            </button>
          </fieldset>
        );
      })}
      <button type="button" className="staff-btn" onClick={() => onChange([...groups, newGroup()])}>
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("manager.groups.add")}
      </button>
    </section>
  );
}
