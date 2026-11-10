import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const CALL_REASONS = ["wine", "problem", "other"] as const;

export const callSchema = new Schema({
  tenantId: tenantIdField,
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  checkId: { type: Schema.Types.ObjectId, ref: "Check", default: null },
  reason: { type: String, enum: CALL_REASONS, required: true },
  openedAt: { type: Date, required: true },
  answeredAt: { type: Date, default: null },
  answeredBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
});
callSchema.index({ tenantId: 1, tableId: 1, answeredAt: 1 });
callSchema.plugin(tenantPlugin);
export type CallRecord = InferSchemaType<typeof callSchema>;
