import { z } from "zod";
import { ALLERGENS } from "./allergens";
import { TABLE_NAME_RE } from "./tables";

const OptionSelectionSchema = z.object({ groupId: z.string(), optionIds: z.array(z.string()) });

export const OrderItemRequest = z.object({
  itemId: z.string(),
  qty: z.number().int().min(1).max(20),
  options: z.array(OptionSelectionSchema),
  note: z.string().max(140).optional(),
  seat: z.number().int().min(1).max(20).optional(),
});
export type OrderItemRequest = z.infer<typeof OrderItemRequest>;

export const OrderRequest = z.object({
  idempotencyKey: z.uuid(),
  /**
   * The check (visit) the guest page was showing. When present and it is no longer the table's open check, the
   * order is refused with `check_closed`, so a stale page never orders onto the next party's check.
   */
  expectedCheckId: z.string().max(64).optional(),
  items: z
    .array(OrderItemRequest)
    .min(1)
    .refine((items) => items.reduce((n, i) => n + i.qty, 0) <= 20, { message: "Total quantity must be at most 20" }),
});
export type OrderRequest = z.infer<typeof OrderRequest>;

export const StaffRole = z.enum(["waiter", "kitchen", "bar", "manager"]);
export type StaffRole = z.infer<typeof StaffRole>;

export const DemoRole = z.enum(["guest", "waiter", "kitchen", "bar", "manager"]);
export type DemoRole = z.infer<typeof DemoRole>;

const Loc = z.object({ en: z.string().trim().min(1).max(200), tr: z.string().trim().min(1).max(200) });
const LocLong = z.object({ en: z.string().trim().min(1).max(1000), tr: z.string().trim().min(1).max(1000) });
const LocOptional = z.object({ en: z.string().trim().max(2000), tr: z.string().trim().max(2000) });

export const DIETARY = ["vegetarian", "vegan", "gluten-free"] as const;

const OptionInput = z.object({ id: z.string().min(1).max(64).optional(), name: Loc, priceDelta: z.number().int() });
const OptionGroupInput = z.object({
  /** Omit for a new group: the server generates one. Sent ids are kept, so edits stay stable. */
  id: z.string().min(1).max(64).optional(),
  name: Loc,
  type: z.enum(["single", "multi"]),
  required: z.boolean(),
  options: z.array(OptionInput).max(30),
});

/** Manager menu-item editor body (POST /api/manager/items; PATCH takes `.partial()`). Money in integer kuruş. */
export const MenuItemInput = z.object({
  categoryId: z.string().min(1),
  name: Loc,
  description: LocLong,
  story: LocOptional.optional(),
  price: z.number().int().min(1),
  station: z.enum(["kitchen", "bar"]),
  vatRate: z.union([z.literal(10), z.literal(20)]).default(10),
  dietary: z.array(z.enum(DIETARY)).max(DIETARY.length).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  optionGroups: z
    .array(OptionGroupInput)
    .max(20)
    .superRefine((groups, ctx) => {
      const seen = new Set<string>();
      groups.forEach((g, gi) => {
        if (g.id !== undefined) {
          if (seen.has(g.id)) ctx.addIssue({ code: "custom", path: [gi, "id"], message: `Duplicate option group id "${g.id}"` });
          seen.add(g.id);
        }
        const opts = new Set<string>();
        g.options.forEach((o, oi) => {
          if (o.id === undefined) return;
          if (opts.has(o.id)) ctx.addIssue({ code: "custom", path: [gi, "options", oi, "id"], message: `Duplicate option id "${o.id}" in group` });
          opts.add(o.id);
        });
      });
    })
    .default([]),
  active: z.boolean().default(true),
  sort: z.number().int().optional(),
});
export type MenuItemInput = z.input<typeof MenuItemInput>;

export const CategoryInput = z.object({
  name: Loc,
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const AvailabilityInput = z.object({
  soldOut: z.boolean().optional(),
  remaining: z.number().int().min(0).nullable().optional(),
});
export type AvailabilityInput = z.infer<typeof AvailabilityInput>;

export const TableEdit = z.object({
  name: z.string().regex(TABLE_NAME_RE).optional(),
  capacity: z.number().int().min(1).max(50).optional(),
});
export type TableEdit = z.infer<typeof TableEdit>;
