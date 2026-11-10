import { SERVICE_DAY_START_HOUR, TICKET_THRESHOLDS } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";

/** One per tenant: ticket age thresholds (minutes) and the service-day start hour. */
export const settingSchema = new Schema({
  tenantId: tenantIdField,
  warnMin: { type: Number, required: true, default: TICKET_THRESHOLDS.warnMin },
  lateMin: { type: Number, required: true, default: TICKET_THRESHOLDS.lateMin },
  serviceDayStartHour: { type: Number, required: true, default: SERVICE_DAY_START_HOUR },
});
settingSchema.plugin(tenantPlugin);
export type SettingRecord = InferSchemaType<typeof settingSchema>;
