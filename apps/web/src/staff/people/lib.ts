import type { TFunction } from "i18next";
import { istanbulClock } from "@lodos/shared";
import type { Lang } from "../../lib/format";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d);

/** "today 17:02", "yesterday 17:02", "12 Oct" (Istanbul days), or "Never". */
export function lastSeen(iso: string | null, now: Date, lang: Lang, t: TFunction): string {
  if (!iso) return t("people.never");
  const at = new Date(iso);
  const time = istanbulClock(at);
  const day = dayKey(at);
  if (day === dayKey(now)) return t("people.today", { time });
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return t("people.yesterday", { time });
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", { timeZone: "Europe/Istanbul", day: "numeric", month: "short" }).format(at);
}
