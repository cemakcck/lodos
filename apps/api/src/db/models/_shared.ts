import { Schema } from "mongoose";

/** `{ en, tr }` text. A schema (not a nested path) so the inferred type is non-null when required. */
export const localizedSchema = new Schema(
  { en: { type: String, required: true }, tr: { type: String, required: true } },
  { _id: false },
);
export const localized = { type: localizedSchema, required: true } as const;

export const STATIONS = ["kitchen", "bar"] as const;
