import { Schema, type InferSchemaType } from "mongoose";

/** One hit against a rate-limit key. Not tenant-scoped: callers prefix keys with the tenant where relevant. */
export const rateEventSchema = new Schema({
  key: { type: String, required: true },
  at: { type: Date, required: true, expires: 86_400 },
});
rateEventSchema.index({ key: 1, at: 1 });
export type RateEventRecord = InferSchemaType<typeof rateEventSchema>;
