import { SHIFT_AREAS } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** A named start/end/area preset for adding shifts (spec §6.2). `start`/`end` are wall-clock "HH:MM". */
export const shiftTemplateSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  area: { type: String, enum: SHIFT_AREAS, required: true },
  sort: { type: Number, required: true, default: 0 },
});
shiftTemplateSchema.plugin(tenantPlugin);
export type ShiftTemplateRecord = InferSchemaType<typeof shiftTemplateSchema>;
