import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized } from "./_shared";

export const EXPENSE_KINDS = ["food_drink", "other"] as const;

/** An expense category with its monthly budget in kuruş (phase 3). `food_drink` categories make up the cost of goods. */
export const expenseCategorySchema = new Schema({
  tenantId: tenantIdField,
  name: localized,
  kind: { type: String, enum: EXPENSE_KINDS, required: true },
  monthlyBudget: { type: Number, required: true, default: 0, min: 0 },
  sort: { type: Number, required: true, default: 0 },
  archived: { type: Boolean, required: true, default: false },
});
expenseCategorySchema.plugin(tenantPlugin);
export type ExpenseCategoryRecord = InferSchemaType<typeof expenseCategorySchema>;
