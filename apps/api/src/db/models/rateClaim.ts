import { Schema, type InferSchemaType } from "mongoose";

/**
 * The current holder of a single-winner window (`claimFirst`): one document per key, so the unique index makes the
 * claim atomic. Not tenant-scoped: callers prefix keys with the tenant where relevant.
 */
export const rateClaimSchema = new Schema({
  key: { type: String, required: true, unique: true },
  at: { type: Date, required: true, expires: 86_400 },
});
export type RateClaimRecord = InferSchemaType<typeof rateClaimSchema>;
