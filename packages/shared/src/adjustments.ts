export type AdjustmentKind = "comp" | "void";

/** The note is required only for "other", and is at most 140 characters. */
export const COMP_REASONS = ["celebration", "complaint", "long_wait", "regular", "other"] as const;
export const VOID_REASONS = ["wrong_item", "changed_mind", "duplicate", "other"] as const;
