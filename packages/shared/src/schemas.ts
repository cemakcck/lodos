import { z } from "zod";

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
