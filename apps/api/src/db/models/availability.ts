import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** Per service day (`serviceDayOf`, "YYYY-MM-DD") and item. `remaining: null` means unlimited. */
export const availabilitySchema = new Schema({
  tenantId: tenantIdField,
  serviceDay: { type: String, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
  soldOut: { type: Boolean, required: true, default: false },
  remaining: { type: Number, default: null, min: 0 },
});
availabilitySchema.index({ tenantId: 1, serviceDay: 1, itemId: 1 }, { unique: true });
availabilitySchema.plugin(tenantPlugin);
export type AvailabilityRecord = InferSchemaType<typeof availabilitySchema>;
