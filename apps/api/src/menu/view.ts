import { serviceDayOf as serviceDay } from "@lodos/shared";
import type { Models } from "../db/models/index";

/**
 * The orderable menu, as guests and waiters see it: active categories, and the active items of active categories,
 * each with the current service day's availability. Runs inside the caller's tenant (`runWithTenant`).
 * Shared by `GET /api/guest/menu` and `GET /api/menu`.
 */
export async function menuView(models: Models, now: Date) {
  const { Availability, Category, MenuItem } = models;
  const [categories, items, avails] = await Promise.all([
    Category.find({ active: true }).sort({ sort: 1, _id: 1 }).lean(),
    MenuItem.find({ active: true }).sort({ sort: 1, _id: 1 }).lean(),
    Availability.find({ serviceDay: serviceDay(now) }).lean(),
  ]);
  const availOf = new Map(avails.map((a) => [String(a.itemId), a]));
  const shown = new Set(categories.map((c) => String(c._id)));
  return {
    categories: categories.map((c) => ({ id: String(c._id), name: c.name })),
    items: items
      .filter((i) => shown.has(String(i.categoryId)))
      .map((i) => {
        const a = availOf.get(String(i._id));
        return {
          id: String(i._id),
          categoryId: String(i.categoryId),
          name: i.name,
          description: i.description,
          story: i.story,
          price: i.price,
          station: i.station,
          dietary: i.dietary,
          allergens: i.allergens,
          photo: i.photo,
          optionGroups: i.optionGroups,
          availability: { soldOut: a?.soldOut ?? false, remaining: a?.remaining ?? null },
        };
      }),
  };
}
