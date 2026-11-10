import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const photoSchema = new Schema({
  tenantId: tenantIdField,
  data: { type: Buffer, required: true },
  contentType: { type: String, required: true },
});
photoSchema.plugin(tenantPlugin);
export type PhotoRecord = InferSchemaType<typeof photoSchema>;
