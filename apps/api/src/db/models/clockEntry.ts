import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

const editSchema = new Schema(
  {
    at: { type: Date, required: true },
    byStaffId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true },
    /** The times before this edit; null for the entry's creation by a manager (a missed punch added by hand). */
    before: {
      type: new Schema({ in: { type: Date, required: true }, out: { type: Date, default: null } }, { _id: false }),
      default: null,
    },
  },
  { _id: false },
);

/** One clock-in/out of one person (phase 3). `rate` is the hourly rate in kuruş in force at clock-in. */
export const clockEntrySchema = new Schema({
  tenantId: tenantIdField,
  staffId: { type: Schema.Types.ObjectId, required: true },
  serviceDay: { type: String, required: true },
  in: { type: Date, required: true },
  out: { type: Date, default: null },
  rate: { type: Number, required: true, min: 0 },
  edits: { type: [editSchema], default: [] },
  generated: { type: Boolean, required: true, default: false },
});
clockEntrySchema.index({ tenantId: 1, staffId: 1, in: 1 });
/** A person can't have two open entries. */
clockEntrySchema.index({ tenantId: 1, staffId: 1 }, { unique: true, partialFilterExpression: { out: null } });
clockEntrySchema.plugin(tenantPlugin);
export type ClockEntryRecord = InferSchemaType<typeof clockEntrySchema>;
