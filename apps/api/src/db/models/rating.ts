import { Schema, type InferSchemaType } from "mongoose";
import { tenantIdField, tenantPlugin } from "../tenancy";
import { localized, STATIONS } from "./_shared";

const star = { type: Number, min: 1, max: 5, default: null } as const;

const dishRatingSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, default: null },
    name: localized,
    station: { type: String, enum: STATIONS, required: true },
    stars: { type: Number, min: 1, max: 5, required: true },
  },
  { _id: false },
);

/**
 * One guest's rating of one paid check (phase 3). `checkId` is null only for seeded history, so the unique index is
 * partial. Stars are integers 1–5; `generated` marks demo data.
 */
export const ratingSchema = new Schema({
  tenantId: tenantIdField,
  checkId: { type: Schema.Types.ObjectId, default: null },
  tableId: { type: Schema.Types.ObjectId, default: null },
  serviceDay: { type: String, required: true },
  paidAt: { type: Date, required: true },
  submittedAt: { type: Date, required: true },
  serverStaffId: { type: Schema.Types.ObjectId, default: null },
  waiter: star,
  dishes: { type: [dishRatingSchema], default: [] },
  food: star,
  cleanliness: star,
  atmosphere: star,
  comment: { type: String, maxlength: 500, default: null },
  commentHidden: { type: Boolean, required: true, default: false },
  generated: { type: Boolean, required: true, default: false },
});
ratingSchema.index({ tenantId: 1, checkId: 1 }, { unique: true, partialFilterExpression: { checkId: { $type: "objectId" } } });
ratingSchema.index({ tenantId: 1, serviceDay: 1 });
ratingSchema.plugin(tenantPlugin);
export type RatingRecord = InferSchemaType<typeof ratingSchema>;
