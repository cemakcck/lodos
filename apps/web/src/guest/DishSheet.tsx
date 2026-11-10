import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveOptions, type OptionSelection } from "@lodos/shared";
import { useFormat } from "../lib/format";
import { MAX_LINE_QTY, NOTE_MAX, type NewLine } from "./cart";
import { ArchPhoto, Ornament, Sheet, Stepper } from "./ui";
import { loc, type MenuItem } from "./types";

type Props = { item: MenuItem; onClose: () => void; onAdd: (line: NewLine) => void };

/** Dish detail: photo, story, full allergen list, options (validated with the shared resolveOptions), note and qty. */
export function DishSheet({ item, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const noteId = useId();
  const soldOut = item.availability.soldOut;

  const selection: OptionSelection[] = useMemo(
    () => item.optionGroups.map((g) => ({ groupId: g.id, optionIds: picked[g.id] ?? [] })).filter((s) => s.optionIds.length > 0),
    [item.optionGroups, picked],
  );
  const resolved = resolveOptions(item.optionGroups, selection);
  const missing = item.optionGroups.filter((g) => g.required && !(picked[g.id]?.length));
  const deltas = item.optionGroups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id)).map((o) => o.priceDelta));
  const unit = item.price + deltas.reduce((a, b) => a + b, 0);
  const canAdd = resolved.ok && !soldOut;

  const toggle = (groupId: string, optionId: string, single: boolean) =>
    setPicked((p) => {
      const cur = p[groupId] ?? [];
      if (single) return { ...p, [groupId]: [optionId] };
      return { ...p, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
    });

  const add = () => {
    if (!canAdd) return;
    onAdd({ itemId: item.id, qty, options: selection, note: note.trim() });
  };

  const story = loc(item.story, lang).trim();
  const name = loc(item.name, lang);

  return (
    <Sheet
      title={name}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <Stepper
            value={qty}
            onChange={setQty}
            max={MAX_LINE_QTY}
            decLabel={t("guest.sheet.decrease")}
            incLabel={t("guest.sheet.increase")}
            valueLabel={t("guest.sheet.quantity")}
          />
          <div className="flex-1">
            {missing.length > 0 && !soldOut && (
              <p id={`${noteId}-why`} className="mb-1.5 text-center text-[12px] text-guest-beige">
                {t("guest.sheet.choose", { group: missing.map((g) => loc(g.name, lang)).join(", ") })}
              </p>
            )}
            <button
              type="button"
              className="guest-primary w-full"
              disabled={!canAdd}
              aria-describedby={missing.length > 0 ? `${noteId}-why` : undefined}
              onClick={add}
            >
              {soldOut ? t("guest.sheet.soldOut") : <>{t("guest.sheet.addToOrder")} <span aria-hidden="true">·</span> {money(unit * qty)}</>}
            </button>
          </div>
        </div>
      }
    >
      <div className="guest-sheet-photo">
        <ArchPhoto src={item.photo} size={220} dim={soldOut} className="guest-arch-xl" />
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-guest-beige">{loc(item.description, lang)}</p>
      {item.dietary.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {item.dietary.map((d) => (
            <li key={d} className="guest-tag">{t(`guest.dietaryLong.${d}`)}</li>
          ))}
        </ul>
      )}

      {story && (
        <section className="mt-5">
          <h3 className="guest-label text-guest-brass">{t("guest.sheet.story")}</h3>
          <p className="mt-1.5 font-guest-dish text-[18px] leading-snug text-guest-cream italic">{story}</p>
        </section>
      )}

      <section className="mt-5">
        <h3 className="guest-label text-guest-brass">{t("guest.sheet.allergens")}</h3>
        {item.allergens.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {item.allergens.map((a) => (
              <li key={a} className="guest-tag guest-tag-allergen">{t(`guest.allergens.${a}`)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-guest-beige">{t("guest.sheet.noAllergens")}</p>
        )}
        <p className="mt-2 text-[12px] leading-snug text-[#cdb7bf]">{t("guest.sheet.allergenHint")}</p>
      </section>

      {item.optionGroups.map((g) => {
        const single = g.type === "single";
        const gName = loc(g.name, lang);
        return (
          <fieldset key={g.id} className="mt-5">
            <legend className="flex w-full items-baseline justify-between">
              <span className="font-guest-dish text-[20px] font-semibold text-guest-cream">{gName}</span>
              <span className={`guest-label ${g.required ? "text-guest-brass" : "text-[#cdb7bf]"}`}>
                {g.required ? t("guest.sheet.required") : t("guest.sheet.optional")} · {single ? t("guest.sheet.chooseOne") : t("guest.sheet.chooseAny")}
              </span>
            </legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {g.options.map((o) => {
                const on = picked[g.id]?.includes(o.id) ?? false;
                return (
                  <label key={o.id} className={`guest-option ${on ? "is-on" : ""}`}>
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={`${item.id}-${g.id}`}
                      checked={on}
                      disabled={soldOut}
                      onChange={() => toggle(g.id, o.id, single)}
                    />
                    <span className="guest-option-mark" aria-hidden="true" />
                    <span className="flex-1">{loc(o.name, lang)}</span>
                    {o.priceDelta !== 0 && <span className="text-[13px] font-semibold text-guest-beige">+{money(o.priceDelta)}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <label htmlFor={noteId} className="font-guest-dish text-[20px] font-semibold text-guest-cream">{t("guest.sheet.note")}</label>
          <span className="text-[12px] text-[#cdb7bf]" aria-live="polite">{t("guest.sheet.noteCount", { count: note.length, max: NOTE_MAX })}</span>
        </div>
        <textarea
          id={noteId}
          className="guest-input mt-2"
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          placeholder={t("guest.sheet.notePlaceholder")}
          disabled={soldOut}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
        />
      </div>
      <Ornament className="mx-auto mt-6 mb-1 block text-guest-brass" />
    </Sheet>
  );
}
