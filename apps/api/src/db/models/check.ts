import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

const PAY_METHODS = ["card", "cash"] as const;

const paymentSchema = new Schema(
  {
    method: { type: String, enum: PAY_METHODS, required: true },
    /** Kuruş. */
    amount: { type: Number, required: true },
    at: { type: Date, required: true },
    /** Four random digits for a (simulated) card payment; null for cash. */
    last4: { type: String, default: null },
  },
  { _id: false },
);

const splitSchema = new Schema(
  {
    mode: { type: String, enum: ["even", "items"], required: true },
    count: { type: Number, required: true, min: 2, max: 20 },
    /** Exactly `count` shares, labelled SHARE_LABELS[0..count-1]. */
    shares: {
      type: [new Schema({ label: { type: String, required: true }, payment: { type: paymentSchema, default: null } }, { _id: false })],
      default: [],
    },
    /** By item: unit ref → share labels (label order). Units of the bill not listed here are unassigned. */
    assignments: {
      type: [new Schema({ unit: { type: String, required: true }, labels: { type: [String], default: [] } }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
);

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
  /** A full (unsplit) payment. Split checks keep their payments on `split.shares[].payment`. */
  payment: { type: paymentSchema, default: null },
  /**
   * The bill split (spec §3.1), or null when paid in full. Share amounts are derived from the bill on every read
   * (checks/split.ts), except a paid share's, which is frozen in its payment.
   */
  split: { type: splitSchema, default: null },
  /** Bumped by every split change (and adjustments), so writers of the check write-conflict in their transactions. */
  splitVersion: { type: Number, required: true, default: 0 },
});
checkSchema.index({ tenantId: 1, tableId: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
checkSchema.index({ tenantId: 1, status: 1 });
checkSchema.plugin(tenantPlugin);
export type CheckRecord = InferSchemaType<typeof checkSchema>;
