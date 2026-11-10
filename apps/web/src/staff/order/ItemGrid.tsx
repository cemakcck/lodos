import { useTranslation } from "react-i18next";
import { GlassWater, SlidersHorizontal, UtensilsCrossed } from "lucide-react";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import type { Category, MenuItem } from "../../guest/types";

/** Shown as "N left" on a tile at or below this many. */
export const LOW_STOCK = 5;

export interface ItemGridProps {
  /** Sections to show, in order. A single untitled section for search results or one category. */
  sections: { id: string; title: string | null; items: MenuItem[] }[];
  /** Accessible label of the grid: "Menu items, Cocktails". */
  label: string;
  /** Quantity of each item already in the order being built. */
  inOrder: ReadonlyMap<string, number>;
  onPick: (item: MenuItem) => void;
}

/** The dense item grid. Every tile is one button whose accessible name carries name, price, Food/Drink and state. */
export function ItemGrid({ sections, label, inOrder, onPick }: ItemGridProps) {
  return (
    <div role="group" aria-label={label} className="oe-sections">
      {sections.map((s) => (
        <div key={s.id} role={s.title ? "group" : undefined} aria-labelledby={s.title ? `oe-sec-${s.id}` : undefined}>
          {s.title && <h2 id={`oe-sec-${s.id}`} className="staff-label oe-sec-h">{s.title}</h2>}
          <div className="oe-grid">
            {s.items.map((item) => (
              <ItemTile key={item.id} item={item} count={inOrder.get(item.id) ?? 0} onPick={onPick} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemTile({ item, count, onPick }: { item: MenuItem; count: number; onPick: (item: MenuItem) => void }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const name = loc(item.name, lang);
  const price = money(item.price);
  const drink = item.station === "bar";
  const { soldOut, remaining } = item.availability;
  const low = !soldOut && remaining !== null && remaining <= LOW_STOCK;
  const hasOptions = item.optionGroups.length > 0;
  const Icon = drink ? GlassWater : UtensilsCrossed;

  const aria = [
    name,
    price,
    t(drink ? "order.tile.drinkAria" : "order.tile.foodAria"),
    soldOut ? t("order.tile.soldOutAria") : null,
    !soldOut && hasOptions ? t("order.tile.optionsAria") : null,
    low ? t("order.tile.leftAria", { count: remaining }) : null,
    count > 0 ? t("order.tile.inOrder", { count }) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className={`oe-tile ${count > 0 ? "is-in" : ""} ${drink ? "is-drink" : ""}`}
      disabled={soldOut}
      aria-label={aria}
      onClick={() => onPick(item)}
    >
      <span className="nm">{name}</span>
      {count > 0 && <span className="badge font-mono" aria-hidden="true">×{count}</span>}
      <span className="ft" aria-hidden="true">
        <span className="kind">
          <Icon size={13} strokeWidth={1.75} />
          {t(drink ? "order.tile.drink" : "order.tile.food")}
        </span>
        {soldOut ? (
          <span className="state">{t("order.tile.soldOut")}</span>
        ) : low ? (
          <span className="state is-low">{t("order.tile.left", { count: remaining })}</span>
        ) : hasOptions ? (
          <span className="kind" title={t("order.tile.options")}>
            <SlidersHorizontal size={12} strokeWidth={1.75} />
          </span>
        ) : null}
        <span className="price font-mono">{price}</span>
      </span>
    </button>
  );
}

/** Category groups for the left column: Food (kitchen) then Drinks (bar), by the station of each category's items. */
export function groupCategories(categories: Category[], items: MenuItem[]) {
  const stationOf = new Map<string, "kitchen" | "bar">();
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!stationOf.has(i.categoryId)) stationOf.set(i.categoryId, i.station);
    counts.set(i.categoryId, (counts.get(i.categoryId) ?? 0) + 1);
  }
  const shown = categories.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id)! }));
  return {
    food: shown.filter((c) => stationOf.get(c.id) !== "bar"),
    drinks: shown.filter((c) => stationOf.get(c.id) === "bar"),
  };
}
