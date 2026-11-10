import type { TFunction } from "i18next";
import { ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";

/** Friendly copy for demo session failures: the per-IP creation limit and a full demo. */
export function demoErrorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiClientError && err.status === 429) return t("demo.errors.rate");
  if (err instanceof ApiClientError && (err.code === "demo_busy" || err.status === 503)) return t("demo.errors.busy");
  return errorMessage(t, err);
}
