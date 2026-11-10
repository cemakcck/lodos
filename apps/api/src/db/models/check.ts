import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

const PAY_METHODS = ["card", "cash"] as const;

/** One per table visit. At most one `open` check per table (partial unique index below). */
export const checkSchema = new Schema({
  tenantId: tenantIdField,
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  status: { type: String, enum: ["open", "paid"], required: true, default: "open" },
  /** null until a waiter seats the table (QR-opened checks start without covers). */
  covers: { type: Number, default: null },
  openedAt: { type: Date, required: true },
  closedAt: { type: Date, default: null },
  /**
   * Orders placed on this check. `placeOrder` increments it conditionally in its transaction, which both enforces the
   * 30-order limit strictly and makes a concurrent close of the check a write conflict (no order on a paid check).
   */
  orderCount: { type: Number, required: true, default: 0, min: 0 },
  serverStaffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
  billRequestedAt: { type: Date, default: null },
  billMethod: { type: String, enum: [...PAY_METHODS, null], default: null },
  payment: {
    type: new Schema(
      {
        method: { type: String, enum: PAY_METHODS, required: true },
        /** Kuruş. */
        amount: { type: Number, required: true },
        at: { type: Date, required: true },
      },
      { _id: false },
    ),
    default: null,
  },
});
checkSchema.index({ tenantId: 1, tableId: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
checkSchema.index({ tenantId: 1, status: 1 });
checkSchema.plugin(tenantPlugin);
export type CheckRecord = InferSchemaType<typeof checkSchema>;
