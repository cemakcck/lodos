import type { ALLERGENS, GuestItemStatus, OptionGroup } from "@lodos/shared";

export type Loc = { en: string; tr: string };
export type Allergen = (typeof ALLERGENS)[number];
export type Dietary = "vegetarian" | "vegan" | "gluten-free";

export type Category = { id: string; name: Loc };

export type MenuItem = {
  id: string;
  categoryId: string;
  name: Loc;
  description: Loc;
  story?: Loc;
  /** Integer kuruş. */
  price: number;
  station: "kitchen" | "bar";
  dietary: Dietary[];
  allergens: Allergen[];
  photo?: string | null;
  optionGroups: OptionGroup[];
  availability: { soldOut: boolean; remaining: number | null };
};

export type MenuResponse = { categories: Category[]; items: MenuItem[] };

export type Visit = { checkId: string; openedAt: string };
export type TableResponse = { table: { id: string; name: string }; visit: Visit | null };

export type OrderLine = {
  orderId: string;
  qty: number;
  name: Loc;
  options: Loc[];
  note: string | null;
  status: GuestItemStatus;
  lineTotal: number;
};

export type OrdersResponse =
  | { visit: null }
  | { visit: Visit; food: OrderLine[]; drinks: OrderLine[]; totals: { food: number; drinks: number; total: number } };

export const loc = (l: Loc | undefined, lang: "en" | "tr"): string => (l ? l[lang] || l.en : "");
