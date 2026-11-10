import { fold } from "@lodos/shared";

type Named = { name: { en: string; tr: string } };

/** 0: a name starts with the query; 1: a word in a name does; 2: it appears anywhere; -1: no match. */
function rank(item: Named, q: string): number {
  let best = -1;
  for (const raw of [item.name.en, item.name.tr]) {
    const name = fold(raw);
    const at = name.indexOf(q);
    if (at < 0) continue;
    const r = name.startsWith(q) ? 0 : new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(name) ? 1 : 2;
    if (best < 0 || r < best) best = r;
  }
  return best;
}

/**
 * Menu search for order entry. Case- and Turkish-diacritic-insensitive (`fold`), over the EN and TR names; substring
 * matches, ranked name prefix → word prefix → anywhere. Ties keep the menu order. A blank query returns `items`.
 */
export function searchItems<T extends Named>(items: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return [...items];
  return items
    .map((item, i) => ({ item, i, r: rank(item, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
