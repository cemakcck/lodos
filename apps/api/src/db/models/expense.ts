import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** One money-out entry (phase 3). `amount` is kuruş, `date` the "YYYY-MM-DD" it belongs to. */
export const expenseSchema = new Schema({
  tenantId: tenantIdField,
  categoryId: { type: Schema.Types.ObjectId, required: true },
  amount: { type: Number, required: true, min: 1 },
  date: { type: String, required: true },
  payee: { type: String, default: null },
  note: { type: String, default: null },
  createdBy: { type: Schema.Types.ObjectId, required: true },
});
expenseSchema.index({ tenantId: 1, date: 1 });
expenseSchema.plugin(tenantPlugin);
export type ExpenseRecord = InferSchemaType<typeof expenseSchema>;
