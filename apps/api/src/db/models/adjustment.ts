import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized, STATIONS } from "./_shared";

/**
 * A comp or a void of some units of one order line. Order snapshots never change: a check's charged amount is its
 * order lines minus the units of its active (not reversed) adjustments. `checkId`, `orderId` and `itemIndex` are null
 * only for generated demo history.
 */
export const adjustmentSchema = new Schema({
  tenantId: tenantIdField,
  checkId: { type: Schema.Types.ObjectId, ref: "Check", default: null },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
  /** Index of the line in `order.items`. */
  itemIndex: { type: Number, default: null, min: 0 },
  /** The exact units of the line this adjustment covers (unit `u` of line `o:i` is `o:i:u`). */
  units: { type: [Number], default: [] },
  qty: { type: Number, required: true, min: 1 },
  kind: { type: String, enum: ["comp", "void"], required: true },
  reason: { type: String, required: true },
  note: { type: String, default: null },
  /** Kuruş: the line's unit total × qty, the original price. */
  amount: { type: Number, required: true, min: 0 },
  itemId: { type: Schema.Types.ObjectId, ref: "MenuItem", default: null },
  itemName: localized,
  tableName: { type: String, required: true },
  station: { type: String, enum: STATIONS, required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
  requestedByName: { type: String, required: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
  approvedByName: { type: String, required: true },
  at: { type: Date, required: true },
  /** `serviceDayOf(at)`. */
  serviceDay: { type: String, required: true },
  reversedAt: { type: Date, default: null },
  reversedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
});
adjustmentSchema.index({ tenantId: 1, checkId: 1 });
adjustmentSchema.index({ tenantId: 1, at: -1 });
adjustmentSchema.plugin(tenantPlugin);
export type AdjustmentRecord = InferSchemaType<typeof adjustmentSchema>;
