import { fold } from "@lodos/shared";
import type { KdsTicket, Loc } from "./types";

/** Keeps a number with its unit on one line: "300 g", "50 ml", "3 adet". */
export const keepUnits = (s: string) => s.replace(/(\d) (g|kg|ml|cl|l|cm|adet|pcs)\b/g, "$1\u00a0$2");

/** The text in the board language, with numbers and units held together. */
export const loc = (l: Loc, lang: "en" | "tr") => keepUnits(l[lang] || l.en);

/** Client-side search by table name or dish name (either language), case- and diacritic-insensitive. */
export function matchesSearch(t: KdsTicket, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  if (fold(t.tableName).includes(q)) return true;
  return t.items.some((i) => fold(i.name.en).includes(q) || fold(i.name.tr).includes(q));
}

/** Minutes and seconds for screen readers: "17 minutes 20 seconds". */
export function spokenElapsed(ms: number, t: (k: string, o: { count: number }) => string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${t("kds.minutes", { count: Math.floor(total / 60) })} ${t("kds.seconds", { count: total % 60 })}`;
}
