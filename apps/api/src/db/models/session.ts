import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** Staff session. The cookie holds the raw token; only its sha256 is stored. Looked up `unscoped` by hash. */
export const sessionSchema = new Schema({
  tenantId: tenantIdField,
  tokenHash: { type: String, required: true, unique: true },
  staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
  kind: { type: String, enum: ["person", "station"], required: true },
  createdAt: { type: Date, required: true },
  lastUsedAt: { type: Date, required: true },
  /** Enforced by the auth code against the injected clock; the TTL index only garbage-collects. */
  expiresAt: { type: Date, required: true, expires: 0 },
});
sessionSchema.plugin(tenantPlugin);
export type SessionRecord = InferSchemaType<typeof sessionSchema>;
