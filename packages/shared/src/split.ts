/** Splits `amount` kuruş into `parts` integers that sum exactly; the first `amount % parts` get one extra. */
export function divide(amount: number, parts: number): number[] {
  if (!Number.isInteger(amount)) throw new Error("amount must be an integer");
  if (!Number.isInteger(parts) || parts < 1) throw new Error("parts must be an integer >= 1");
  const base = Math.floor(amount / parts);
  const extra = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Even split of a check: `n` (2..20) shares that sum exactly to `total`. */
export function evenShares(total: number, n: number): number[] {
  if (!Number.isInteger(n)) throw new Error("n must be an integer");
  return divide(total, Math.min(20, Math.max(2, n)));
}

/** Largest-remainder proportional split; sums exactly to `amount`, ties go to the earliest index. */
export function allocate(amount: number, weights: number[]): number[] {
  if (!Number.isInteger(amount)) throw new Error("amount must be an integer");
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return divide(amount, weights.length);
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  const rems = weights.map((w, i) => ({ i, r: amount * w - shares[i]! * total }));
  let left = amount - shares.reduce((a, b) => a + b, 0);
  rems.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rems) {
    if (left <= 0) break;
    shares[i]!++;
    left--;
  }
  return shares;
}

/** VAT contained in a gross amount, rounded half up to the kuruş. */
export function vatOf(gross: number, rate: 10 | 20): number {
  return Math.round((gross * rate) / (100 + rate));
}

export function vatBreakdown(
  grossByRate: Partial<Record<10 | 20, number>>,
): { rate: 10 | 20; gross: number; vat: number }[] {
  return ([10, 20] as const)
    .map((rate) => ({ rate, gross: grossByRate[rate] ?? 0 }))
    .filter((r) => r.gross > 0)
    .map((r) => ({ ...r, vat: vatOf(r.gross, r.rate) }));
}

export function fractionLabel(parts: number): string {
  if (parts === 1) return "";
  if (parts === 2) return "½";
  if (parts === 3) return "⅓";
  if (parts === 4) return "¼";
  return `1/${parts}`;
}

export const lineRef = (orderId: string, index: number): string => `${orderId}:${index}`;
export const unitRef = (orderId: string, index: number, unit: number): string =>
  `${orderId}:${index}:${unit}`;

export function parseUnitRef(ref: string): { orderId: string; index: number; unit: number } | null {
  const m = /^([^:]+):(\d+):(\d+)$/.exec(ref);
  return m ? { orderId: m[1]!, index: Number(m[2]), unit: Number(m[3]) } : null;
}

export const SHARE_LABELS = "ABCDEFGHIJKLMNOPQRST".split("");
