import type { TFunction } from "i18next";
import { ApiClientError } from "./api";

/** Localised message for any thrown error, keyed by API error code. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiClientError) return t(`errors.${err.code}`, { defaultValue: t("errors.generic") });
  if (err instanceof TypeError) return t("errors.network");
  return t("errors.generic");
}
