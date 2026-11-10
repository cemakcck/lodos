import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const roomSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  sort: { type: Number, required: true, default: 0 },
});
roomSchema.plugin(tenantPlugin);
export type RoomRecord = InferSchemaType<typeof roomSchema>;
