import { ALLERGENS } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized, STATIONS } from "./_shared";

/** A snapshot of the item as ordered: later menu edits never change a past order. Money in kuruş. */
const orderLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
    name: localized,
    unitPrice: { type: Number, required: true },
    options: {
      type: [new Schema({ name: localized, priceDelta: { type: Number, required: true } }, { _id: false })],
      default: [],
    },
    qty: { type: Number, required: true, min: 1 },
    note: { type: String, default: null },
    seat: { type: Number, default: null },
    station: { type: String, enum: STATIONS, required: true },
    allergens: { type: [{ type: String, enum: ALLERGENS }], default: [] },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

export const orderSchema = new Schema({
  tenantId: tenantIdField,
  checkId: { type: Schema.Types.ObjectId, ref: "Check", required: true },
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  source: { type: String, enum: ["qr", "staff"], required: true },
  /** Staff id for staff orders; null for QR orders. */
  placedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
  placedAt: { type: Date, required: true },
  idempotencyKey: { type: String, required: true },
  items: { type: [orderLineSchema], required: true },
});
orderSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, checkId: 1 });
orderSchema.plugin(tenantPlugin);
export type OrderRecord = InferSchemaType<typeof orderSchema>;
