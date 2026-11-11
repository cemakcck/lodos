import { ALLERGENS } from "@lodos/shared";
import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized, STATIONS } from "./_shared";

/** Shape mirrors `OptionGroup` in @lodos/shared; ids are stable strings so guest selections survive edits. */
const optionSchema = new Schema(
  { id: { type: String, required: true }, name: localized, priceDelta: { type: Number, required: true, default: 0 } },
  { _id: false },
);
const optionGroupSchema = new Schema(
  {
    id: { type: String, required: true },
    name: localized,
    type: { type: String, enum: ["single", "multi"], required: true },
    required: { type: Boolean, required: true, default: false },
    options: { type: [optionSchema], default: [] },
  },
  { _id: false },
);

export const menuItemSchema = new Schema({
  tenantId: tenantIdField,
  categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  name: localized,
  description: localized,
  story: {
    type: new Schema({ en: { type: String, default: "" }, tr: { type: String, default: "" } }, { _id: false }),
    default: () => ({}),
  },
  /** Kuruş. */
  price: { type: Number, required: true, min: 1, validate: Number.isInteger },
  station: { type: String, enum: STATIONS, required: true },
  /** VAT rate in percent (KDV). Readers treat a missing value (phase 1 data) as 10. */
  vatRate: { type: Number, enum: [10, 20], required: true, default: 10 },
  dietary: { type: [String], default: [] },
  allergens: { type: [{ type: String, enum: ALLERGENS }], default: [] },
  photo: { type: String, default: null },
  optionGroups: { type: [optionGroupSchema], default: [] },
  active: { type: Boolean, required: true, default: true },
  sort: { type: Number, required: true, default: 0 },
});
menuItemSchema.plugin(tenantPlugin);
export type MenuItemRecord = InferSchemaType<typeof menuItemSchema>;
