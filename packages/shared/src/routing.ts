export type Station = "kitchen" | "bar";

export function splitByStation<T extends { station: Station }>(items: T[]): Partial<Record<Station, T[]>> {
  const out: Partial<Record<Station, T[]>> = {};
  for (const item of items) (out[item.station] ??= []).push(item);
  return out;
}

export function checkTotals(lines: { station: Station; lineTotal: number }[]): { food: number; drinks: number; total: number } {
  let food = 0;
  let drinks = 0;
  for (const l of lines) {
    if (l.station === "kitchen") food += l.lineTotal;
    else drinks += l.lineTotal;
  }
  return { food, drinks, total: food + drinks };
}
