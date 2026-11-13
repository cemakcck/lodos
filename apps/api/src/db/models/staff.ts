import { StaffRole } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

export const staffSchema = new Schema({
  tenantId: tenantIdField,
  name: { type: String, required: true },
  role: { type: String, enum: StaffRole.options, required: true },
  /** Absent for schedule-only roles (cook, bartender, host, dishwasher): they can't sign in. */
  pinHash: { type: String },
  active: { type: Boolean, required: true, default: true },
  /** Set on each successful PIN login (not on manager approvals). */
  lastSignInAt: { type: Date, default: null },
  /** Seeded role-button accounts: in demo mode they can be edited but not deactivated. */
  /** Hourly rate history in kuruş; a rate applies from `from` (the moment it was saved). */
  rates: {
    type: [new Schema({ from: { type: Date, required: true }, kurusPerHour: { type: Number, required: true, min: 0 } }, { _id: false })],
    default: [],
  },
  /** Separate PIN for the time clock. */
  clockPinHash: { type: String },
  demoProtected: { type: Boolean, required: true, default: false },
});
staffSchema.plugin(tenantPlugin);
export type StaffRecord = InferSchemaType<typeof staffSchema>;
