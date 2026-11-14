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
    /** Tickets ready within the late threshold. */
    onTime: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const aggFields = {
  sum: { type: Number, required: true, default: 0 },
  count: { type: Number, required: true, default: 0 },
  dist: { type: [Number], default: () => [0, 0, 0, 0, 0] },
};
const aggSchema = new Schema(aggFields, { _id: false });
const aggPath = { type: aggSchema, required: true, default: () => ({}) };

const byServerSchema = new Schema(
  {
    staffId: { type: String, required: true },
    checks: { type: Number, required: true },
    covers: { type: Number, required: true },
    sales: { type: Number, required: true },
  },
  { _id: false },
);

const ratingsSchema = new Schema(
  {
    waiter: { type: [new Schema({ staffId: { type: String, required: true }, ...aggFields }, { _id: false })], default: [] },
    dishes: {
      type: [new Schema({ itemId: { type: String, default: null }, name: localized, ...aggFields }, { _id: false })],
      default: [],
    },
    food: aggPath,
    cleanliness: aggPath,
    atmosphere: aggPath,
  },
  { _id: false },
);

const personSchema = new Schema(
  {
    staffId: { type: String, required: true },
    minutes: { type: Number, required: true, default: 0 },
    overtimeMinutes: { type: Number, required: true, default: 0 },
    labourCost: { type: Number, required: true, default: 0 },
    shifts: { type: Number, required: true, default: 0 },
    lateShifts: { type: Number, required: true, default: 0 },
    stationTickets: { type: Number, required: true, default: 0 },
    stationOnTime: { type: Number, required: true, default: 0 },
    dishRatingSum: { type: Number, required: true, default: 0 },
    dishRatingCount: { type: Number, required: true, default: 0 },
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
  /** Per waiter; computed live like the rest. */
  byServer: { type: [byServerSchema], default: [] },
  /** Filled only on generated days; live days read raw `Rating`s. */
  ratings: { type: ratingsSchema, default: () => ({}) },
  /** Filled only on generated days; live days read raw `ClockEntry`s. */
  people: { type: [personSchema], default: [] },
  generated: { type: Boolean, required: true, default: false },
});
dailySummarySchema.index({ tenantId: 1, serviceDay: 1 }, { unique: true });
dailySummarySchema.plugin(tenantPlugin);
export type DailySummaryRecord = InferSchemaType<typeof dailySummarySchema>;
