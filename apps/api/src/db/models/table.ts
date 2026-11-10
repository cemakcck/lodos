import { TABLE_NAME_RE } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const tableSchema = new Schema({
  tenantId: tenantIdField,
  roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  name: { type: String, required: true, match: TABLE_NAME_RE },
  shape: { type: String, enum: ["round", "rect"], required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  w: { type: Number, required: true },
  h: { type: Number, required: true },
  capacity: { type: Number, required: true, min: 1 },
  /** Guest QR token. Globally unique, so a token alone resolves its tenant (see `unscoped`). */
  token: { type: String, required: true, unique: true },
  sectionStaffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
  active: { type: Boolean, required: true, default: true },
});
tableSchema.index({ tenantId: 1, name: 1 }, { unique: true });
tableSchema.plugin(tenantPlugin);
export type TableRecord = InferSchemaType<typeof tableSchema>;
