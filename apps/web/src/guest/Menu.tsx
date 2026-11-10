import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useFormat } from "../lib/format";
import { useGuest } from "./context";
import { DishSheet } from "./DishSheet";
import { Landing } from "./Landing";
import { GuestFooter } from "./PhotoCredits";
import { ArchPhoto, Ornament } from "./ui";
import { loc, type Category, type MenuItem } from "./types";
import type { NewLine } from "./cart";

const MAX_ROW_ALLERGENS = 3;

/** `/t/:token`: hero, sticky category chips, dish rows by category, footer. */
export function Menu() {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const { menu, cart } = useGuest();
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [announce, setAnnounce] = useState("");
  const categories = menu.data?.categories ?? [];
  const items = menu.data?.items ?? [];
  const active = useActiveSection(categories.map((c) => c.id));

  const add = (line: NewLine, name: string) => {
    cart.add(line);
    setAnnounce(t("guest.menu.added", { name }));
  };

  // Keep the open sheet in sync with live availability (an 86 while the guest is reading it).
  const openLive = open ? (items.find((i) => i.id === open.id) ?? open) : null;

  return (
    <>
      <Landing />
      <main className="pb-32">
        {menu.isPending && <MenuSkeleton label={t("guest.menu.loading")} />}
        {menu.isError && (
          <div className="px-6 py-12 text-center" role="alert">
            <p className="font-guest-dish text-[22px] text-guest-cream">{t("guest.menu.loadFailed")}</p>
            <button type="button" className="guest-secondary mt-4" onClick={() => void menu.refetch()}>{t("guest.menu.retry")}</button>
          </div>
        )}
        {categories.length > 0 && (
          <>
            <nav aria-label={t("guest.nav.menuSections")} className="guest-chips">
              <ul>
                {categories.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`guest-chip ${active === c.id ? "is-active" : ""}`}
                      aria-current={active === c.id ? "true" : undefined}
                      onClick={() => document.getElementById(`cat-${c.id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                    >
                      {loc(c.name, lang)}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            {categories.map((c, i) => (
              <CategorySection
                key={c.id}
                category={c}
                index={i}
                items={items.filter((it) => it.categoryId === c.id)}
                onOpen={setOpen}
                onQuickAdd={(it) => add({ itemId: it.id, qty: 1, options: [], note: "" }, loc(it.name, lang))}
              />
            ))}
          </>
        )}
        <GuestFooter />
      </main>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {openLive && (
        <DishSheet
          item={openLive}
          onClose={() => setOpen(null)}
          onAdd={(line) => {
            add(line, loc(openLive.name, lang));
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function CategorySection({
  category, index, items, onOpen, onQuickAdd,
}: {
  category: Category;
  index: number;
  items: MenuItem[];
  onOpen: (i: MenuItem) => void;
  onQuickAdd: (i: MenuItem) => void;
}) {
  const { lang } = useFormat();
  if (items.length === 0) return null;
  return (
    <section id={`cat-${category.id}`} data-section={category.id} aria-labelledby={`cat-h-${category.id}`} className="guest-section">
      <div className="px-4 pt-8 pb-2 text-center">
        <Ornament className="mx-auto block text-guest-brass" />
        <p className="guest-label mt-2 text-guest-brass" aria-hidden="true">{String(index + 1).padStart(2, "0")}</p>
        <h2 id={`cat-h-${category.id}`} className="font-guest-dish text-[30px] leading-tight font-medium text-guest-cream italic">
          {loc(category.name, lang)}
        </h2>
      </div>
      <ul>
        {items.map((it) => (
          <DishRow key={it.id} item={it} onOpen={() => onOpen(it)} onQuickAdd={() => onQuickAdd(it)} />
        ))}
      </ul>
    </section>
  );
}

export function DishRow({ item, onOpen, onQuickAdd }: { item: MenuItem; onOpen: () => void; onQuickAdd: () => void }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const name = loc(item.name, lang);
  const { soldOut, remaining } = item.availability;
  const lowStock = !soldOut && remaining !== null && remaining > 0 && remaining <= 5;
  const needsChoice = item.optionGroups.length > 0;
  const allergens = item.allergens.slice(0, MAX_ROW_ALLERGENS);
  const more = item.allergens.length - allergens.length;

  return (
    <li className={`guest-dish ${soldOut ? "is-sold-out" : ""}`}>
      <button type="button" className="guest-dish-main" onClick={onOpen} aria-label={t("guest.menu.details", { name, price: money(item.price) })}>
        <ArchPhoto src={item.photo} size={74} dim={soldOut} />
        <span className="min-w-0 flex-1">
          <span className="guest-dish-name">{name}</span>
          <span className="guest-dish-desc">{loc(item.description, lang)}</span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {soldOut && <span className="guest-tag guest-tag-soldout">{t("guest.menu.soldOut")}</span>}
            {lowStock && <span className="guest-tag guest-tag-low">{t("guest.menu.remaining", { count: remaining })}</span>}
            {item.dietary.map((d) => (
              <span key={d} className="guest-tag">{t(`guest.dietary.${d}`)}</span>
            ))}
            {allergens.map((a) => (
              <span key={a} className="guest-tag guest-tag-allergen">{t(`guest.allergens.${a}`)}</span>
            ))}
            {more > 0 && <span className="guest-tag guest-tag-allergen">+{more}</span>}
          </span>
        </span>
      </button>
      <div className="flex flex-col items-end gap-2 pt-0.5">
        <span className="guest-price">{money(item.price)}</span>
        <button
          type="button"
          className="guest-add"
          disabled={soldOut}
          onClick={needsChoice ? onOpen : onQuickAdd}
          aria-label={soldOut ? t("guest.menu.addUnavailable", { name }) : t("guest.menu.add", { name })}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function MenuSkeleton({ label }: { label: string }) {
  return (
    <div className="px-4 pt-8" aria-busy="true">
      <p className="guest-label text-center text-guest-brass">{label}</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-4" aria-hidden="true">
          <span className="guest-arch guest-skeleton" style={{ width: 74, height: 74 }} />
          <span className="flex-1">
            <span className="guest-skeleton block h-4 w-2/3 rounded" />
            <span className="guest-skeleton mt-2 block h-3 w-full rounded" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Highlights the chip of the section in view. No-op where IntersectionObserver is missing (tests, old browsers). */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(",");
  const visible = useRef(new Map<string, number>());
  useEffect(() => {
    if (!key || typeof IntersectionObserver === "undefined") return;
    const list = key.split(",");
    const seen = visible.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.section!;
          if (e.isIntersecting) seen.set(id, e.intersectionRatio);
          else seen.delete(id);
        }
        const first = list.find((id) => seen.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-56px 0px -55% 0px", threshold: [0, 0.01] },
    );
    for (const id of list) {
      const el = document.getElementById(`cat-${id}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [key]);
  return active ?? (ids[0] ?? null);
}
