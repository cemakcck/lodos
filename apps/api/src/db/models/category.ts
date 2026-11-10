import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized } from "./_shared";

export const categorySchema = new Schema({
  tenantId: tenantIdField,
  name: localized,
  sort: { type: Number, required: true, default: 0 },
  active: { type: Boolean, required: true, default: true },
});
categorySchema.plugin(tenantPlugin);
export type CategoryRecord = InferSchemaType<typeof categorySchema>;
