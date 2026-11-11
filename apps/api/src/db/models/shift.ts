import { SHIFT_AREAS } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/**
 * One person's shift (spec §6.2). It belongs to the service day it starts in (`serviceDay`, "YYYY-MM-DD"); `start` and
 * `end` are the instants from `shiftSpan`, so a 17:00–01:00 shift ends on the next calendar day.
 */
export const shiftSchema = new Schema({
  tenantId: tenantIdField,
  staffId: { type: Schema.Types.ObjectId, required: true },
  serviceDay: { type: String, required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  area: { type: String, enum: SHIFT_AREAS, required: true },
  note: { type: String, default: null },
});
shiftSchema.index({ tenantId: 1, serviceDay: 1 });
/** The overlap check: a person's shifts by time. */
shiftSchema.index({ tenantId: 1, staffId: 1, start: 1 });
shiftSchema.plugin(tenantPlugin);
export type ShiftRecord = InferSchemaType<typeof shiftSchema>;
