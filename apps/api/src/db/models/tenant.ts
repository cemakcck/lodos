import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** The restaurant a tenant represents (the live `main` one, or a demo sandbox's copy). */
export const tenantSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  createdAt: { type: Date, required: true },
});
tenantSchema.plugin(tenantPlugin);
export type TenantRecord = InferSchemaType<typeof tenantSchema>;
