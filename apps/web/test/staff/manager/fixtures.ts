/* Manager screen fixtures: the shapes GET /api/manager/menu, /tables and /tonight return. */
import type { CategoryView, ItemView, ManagerMenu } from "../../../src/staff/manager/types";

const n = (en: string, tr: string) => ({ en, tr });

export const categories: CategoryView[] = [
  { id: "share", name: n("To share", "Paylaşmalık"), sort: 10, active: true },
  { id: "fire", name: n("From the fire", "Ateşten"), sort: 20, active: true },
  { id: "cocktails", name: n("Cocktails", "Kokteyller"), sort: 30, active: true },
];

export const burrata: ItemView = {
  id: "burrata",
  categoryId: "share",
  name: n("Burrata, heirloom tomato", "Burrata, yerli domates"),
  description: n("Creamy burrata, ripe tomatoes.", "Kremsi burrata, olgun domates."),
  story: n("", ""),
  price: 54000,
  station: "kitchen",
  dietary: ["vegetarian"],
  allergens: ["milk"],
  photo: "/photos/burrata.jpg",
  optionGroups: [],
  active: true,
  sort: 10,
  availability: { soldOut: false, remaining: null },
};

export const ribeye: ItemView = {
  ...burrata,
  id: "ribeye",
  categoryId: "fire",
  name: n("Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g"),
  description: n("Thirty-five-day dry-aged ribeye.", "Otuz beş gün dinlendirilmiş antrikot."),
  price: 245000,
  dietary: ["gluten-free"],
  allergens: ["celery"],
  photo: "/api/photos/abc123",
  optionGroups: [
    {
      id: "g-done",
      name: n("Doneness", "Pişirme"),
      type: "single",
      required: true,
      options: [
        { id: "o-rare", name: n("Rare", "Az pişmiş"), priceDelta: 0 },
        { id: "o-mr", name: n("Medium rare", "Orta az pişmiş"), priceDelta: 0 },
      ],
    },
  ],
  sort: 20,
};

export const negroni: ItemView = {
  ...burrata,
  id: "negroni",
  categoryId: "cocktails",
  name: n("Lodos Negroni", "Lodos Negroni"),
  description: n("Gin, bitter red aperitivo and sweet vermouth.", "Cin, acı kırmızı aperitif ve tatlı vermut."),
  price: 68000,
  station: "bar",
  dietary: ["vegan"],
  allergens: [],
  photo: null,
  sort: 30,
};

export const menu = (items: ItemView[] = [burrata, ribeye, negroni]): ManagerMenu => ({ categories, items });
