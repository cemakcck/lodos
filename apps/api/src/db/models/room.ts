import { ROOM_DEFAULT_HEIGHT, ROOM_DEFAULT_WIDTH } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const roomSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  sort: { type: Number, required: true, default: 0 },
  /** Floor plan canvas in px; every active table of the room lies inside it. */
  width: { type: Number, required: true, default: ROOM_DEFAULT_WIDTH },
  height: { type: Number, required: true, default: ROOM_DEFAULT_HEIGHT },
  /** Bumped by every layout save, conditionally on the version the editor loaded (spec §7). */
  version: { type: Number, required: true, default: 0 },
});
roomSchema.plugin(tenantPlugin);
export type RoomRecord = InferSchemaType<typeof roomSchema>;
