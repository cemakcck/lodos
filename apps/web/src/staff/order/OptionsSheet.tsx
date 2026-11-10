import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { useFormat } from "../../lib/format";
import { useOptionPicks } from "../../lib/useOptionPicks";
import { Dialog } from "../Dialog";
import { loc } from "../kds/lib";
import type { MenuItem } from "../../guest/types";
import type { NewDraftLine } from "./draft";

export interface OptionsSheetProps {
  item: MenuItem;
  /** The most that still fits in this order (1–20). */
  maxQty: number;
  onAdd: (line: NewDraftLine) => void;
  onClose: () => void;
}

/**
 * Options for one item, in the staff Dialog (focus trapped, Esc closes, focus returns to the tile). Validation is the
 * shared `resolveOptions`, through the same hook as the guest DishSheet; a required group blocks Add and says which.
 */
export function OptionsSheet({ item, maxQty, onAdd, onClose }: OptionsSheetProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const { selection, valid, missing, delta, isOn, toggle } = useOptionPicks(item.optionGroups);
  const [qty, setQty] = useState(1);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  const unit = item.price + delta;
  const canAdd = valid && !item.availability.soldOut;

  const add = () => {
    if (canAdd) onAdd({ itemId: item.id, qty: Math.min(qty, maxQty), options: selection });
  };

  return (
    <Dialog
      title={loc(item.name, lang)}
      onClose={onClose}
      initialFocus={first}
      width={460}
      footer={
        <div className="oe-sheet-f">
          {missing.length > 0 && (
            <p id={`${id}-why`} className="oe-why">
              {t("order.sheet.choose", { group: missing.map((g) => loc(g.name, lang)).join(", ") })}
            </p>
          )}
          <div className="oe-stepper" role="group" aria-label={t("order.sheet.quantity")}>
            <button type="button" className="staff-btn" aria-label={t("order.sheet.less")} disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
              <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <output className="oe-qty" aria-live="polite">{qty}</output>
            <button type="button" className="staff-btn" aria-label={t("order.sheet.more")} disabled={qty >= maxQty} onClick={() => setQty((q) => q + 1)}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="staff-grow" />
          <button type="button" className="staff-btn" onClick={onClose}>{t("order.sheet.cancel")}</button>
          <button
            type="button"
            className="staff-btn primary"
            disabled={!canAdd}
            aria-describedby={missing.length > 0 ? `${id}-why` : undefined}
            onClick={add}
          >
            {t("order.sheet.add")} <span aria-hidden="true">·</span> <span className="font-mono">{money(unit * qty)}</span>
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        {item.optionGroups.map((g, gi) => {
          const single = g.type === "single";
          return (
            <fieldset key={g.id} className="oe-group">
              <legend>
                <span className="nm">{loc(g.name, lang)}</span>
                <span className={`staff-label ${g.required ? "is-req" : ""}`}>
                  {g.required ? t("order.sheet.required") : t("order.sheet.optional")} · {single ? t("order.sheet.one") : t("order.sheet.any")}
                </span>
              </legend>
              {g.options.map((o, oi) => {
                const on = isOn(g.id, o.id);
                return (
                  <label key={o.id} className={`oe-opt ${on ? "is-on" : ""}`}>
                    <input
                      ref={gi === 0 && oi === 0 ? first : undefined}
                      type={single ? "radio" : "checkbox"}
                      name={`${id}-${g.id}`}
                      checked={on}
                      onChange={() => toggle(g.id, o.id, single)}
                    />
                    <span className="flex-1">{loc(o.name, lang)}</span>
                    {o.priceDelta !== 0 && <span className="font-mono text-staff-fg-2">+{money(o.priceDelta)}</span>}
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </form>
    </Dialog>
  );
}
