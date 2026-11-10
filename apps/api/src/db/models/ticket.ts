import { ALLERGENS, type TicketStatus } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized, localizedSchema, STATIONS } from "./_shared";

export const TICKET_STATUSES = ["new", "started", "held", "ready"] as const satisfies readonly TicketStatus[];

/** One per (order, station). Per-item check-offs live here; `orderItemIndex` points into `Order.items`. */
const ticketLineSchema = new Schema(
  {
    orderItemIndex: { type: Number, required: true },
    name: localized,
    qty: { type: Number, required: true },
    options: { type: [localizedSchema], default: [] },
    note: { type: String, default: null },
    allergens: { type: [{ type: String, enum: ALLERGENS }], default: [] },
    checked: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

export const ticketSchema = new Schema({
  tenantId: tenantIdField,
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  checkId: { type: Schema.Types.ObjectId, ref: "Check", required: true },
  tableId: { type: Schema.Types.ObjectId, ref: "Table", required: true },
  tableName: { type: String, required: true },
  station: { type: String, enum: STATIONS, required: true },
  status: { type: String, enum: TICKET_STATUSES, required: true, default: "new" },
  serverName: { type: String, default: null },
  covers: { type: Number, default: null },
  sentAt: { type: Date, required: true },
  startedAt: { type: Date, default: null },
  readyAt: { type: Date, default: null },
  servedAt: { type: Date, default: null },
  /** Set by recall; the 3 s double-tap dedupe window reads it. */
  recalledAt: { type: Date, default: null },
  items: { type: [ticketLineSchema], required: true },
});
ticketSchema.index({ tenantId: 1, station: 1, status: 1 });
ticketSchema.index({ tenantId: 1, checkId: 1 });
ticketSchema.plugin(tenantPlugin);
export type TicketRecord = InferSchemaType<typeof ticketSchema>;
