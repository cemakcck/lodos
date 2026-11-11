import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized } from "./_shared";

/**
 * One past service day of one tenant (spec §4, data approach). Stores sums, never averages (ticket time as count +
 * totalMs), so any range of days averages correctly. Amounts in kuruş; hours are Istanbul wall-clock hours (0–23).
 * Written by `ensureSummaries` (src/sales/summary.ts); `generated` marks demo history that has no raw checks.
 */
const sumSchema = new Schema(
  { count: { type: Number, required: true, default: 0 }, amount: { type: Number, required: true, default: 0 } },
  { _id: false },
);

const hourSchema = new Schema(
  {
    hour: { type: Number, required: true, min: 0, max: 23 },
    revenue: { type: Number, required: true },
    covers: { type: Number, required: true },
    checks: { type: Number, required: true },
    /** Comp + void amount made in this hour. */
    comps: { type: Number, required: true },
  },
  { _id: false },
);

const ticketHourSchema = new Schema(
  {
    /** Istanbul hour of `sentAt`. */
    hour: { type: Number, required: true, min: 0, max: 23 },
    count: { type: Number, required: true },
    totalMs: { type: Number, required: true },
  },
  { _id: false },
);

const itemSchema = new Schema(
  {
    /** Null only in generated history. */
    itemId: { type: String, default: null },
    name: localized,
    /** Charged units (ordered − comped − voided) and their amount. */
    qty: { type: Number, required: true },
    revenue: { type: Number, required: true },
  },
  { _id: false },
);

export const dailySummarySchema = new Schema({
  tenantId: tenantIdField,
  serviceDay: { type: String, required: true },
  revenue: { type: Number, required: true },
  covers: { type: Number, required: true },
  checks: { type: Number, required: true },
  comps: { type: sumSchema, required: true },
  voids: { type: sumSchema, required: true },
  /** Only hours with activity, in service-hour order. */
  byHour: { type: [hourSchema], default: [] },
  ticketTimes: {
    type: new Schema(
      { kitchen: { type: [ticketHourSchema], default: [] }, bar: { type: [ticketHourSchema], default: [] } },
      { _id: false },
    ),
    required: true,
  },
  items: { type: [itemSchema], default: [] },
  payments: {
    type: new Schema({ card: { type: Number, required: true }, cash: { type: Number, required: true } }, { _id: false }),
    required: true,
  },
  generated: { type: Boolean, required: true, default: false },
});
dailySummarySchema.index({ tenantId: 1, serviceDay: 1 }, { unique: true });
dailySummarySchema.plugin(tenantPlugin);
export type DailySummaryRecord = InferSchemaType<typeof dailySummarySchema>;
