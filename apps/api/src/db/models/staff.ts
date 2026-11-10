import { StaffRole } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const staffSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  role: { type: String, enum: StaffRole.options, required: true },
  pinHash: { type: String, required: true },
  active: { type: Boolean, required: true, default: true },
});
staffSchema.plugin(tenantPlugin);
export type StaffRecord = InferSchemaType<typeof staffSchema>;
