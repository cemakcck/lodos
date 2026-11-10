import { Schema, type InferSchemaType } from "mongoose";

/** One per demo visitor; `_id` is the sandbox's tenantId. Not tenant-scoped (it is the tenant registry). */
export const sandboxSchema = new Schema({
  _id: { type: String, required: true },
  createdAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  simulatorOn: { type: Boolean, required: true, default: true },
  nextSimAt: { type: Date, default: null },
});
export type SandboxRecord = InferSchemaType<typeof sandboxSchema>;
