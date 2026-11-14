/** Guest ratings (phase 3): integer stars 1–5, kept as sum + count + distribution so any range of days merges exactly. */
export const RATING_CATEGORIES = ["food", "cleanliness", "atmosphere"] as const;
export type RatingCategory = (typeof RATING_CATEGORIES)[number];

export type Agg = { sum: number; count: number; dist: [number, number, number, number, number] };

export type RatingAgg = {
  waiter: { staffId: string; sum: number; count: number; dist: Agg["dist"] }[];
  dishes: { itemId: string | null; name: { en: string; tr: string }; sum: number; count: number; dist: Agg["dist"] }[];
  food: Agg;
  cleanliness: Agg;
  atmosphere: Agg;
};

export const emptyAgg = (): Agg => ({ sum: 0, count: 0, dist: [0, 0, 0, 0, 0] });

export function addStar(a: Agg, stars: 1 | 2 | 3 | 4 | 5): Agg {
  const dist = [...a.dist] as Agg["dist"];
  dist[stars - 1] = dist[stars - 1]! + 1;
  return { sum: a.sum + stars, count: a.count + 1, dist };
}

export function mergeAgg(a: Agg, b: Agg): Agg {
  return {
    sum: a.sum + b.sum,
    count: a.count + b.count,
    dist: a.dist.map((n, i) => n + b.dist[i]!) as Agg["dist"],
  };
}

export const avgOf = (a: Agg): number | null => (a.count === 0 ? null : a.sum / a.count);

/** Merges rows by key, summing rows that share one; first-seen order is kept. */
function mergeRows<T extends Agg>(rows: T[], keyOf: (r: T) => string): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = keyOf(r);
    const prev = out.get(k);
    out.set(k, prev ? { ...prev, ...mergeAgg(prev, r) } : { ...r, dist: [...r.dist] as Agg["dist"] });
  }
  return [...out.values()];
}

export function mergeRatingAgg(a: RatingAgg, b: RatingAgg): RatingAgg {
  return {
    waiter: mergeRows([...a.waiter, ...b.waiter], (w) => w.staffId),
    dishes: mergeRows([...a.dishes, ...b.dishes], (d) => d.itemId ?? `name:${d.name.en}`),
    food: mergeAgg(a.food, b.food),
    cleanliness: mergeAgg(a.cleanliness, b.cleanliness),
    atmosphere: mergeAgg(a.atmosphere, b.atmosphere),
  };
}

/** The mean of the non-null category averages; null when no category has a rating. */
export function restaurantRating(r: RatingAgg): number | null {
  const avgs = RATING_CATEGORIES.map((c) => avgOf(r[c])).filter((v): v is number => v !== null);
  return avgs.length === 0 ? null : avgs.reduce((s, v) => s + v, 0) / avgs.length;
}
