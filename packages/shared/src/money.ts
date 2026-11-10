const formatters = {
  en: new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  tr: new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
};
const formattersFrac = {
  en: new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  tr: new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** Formats integer kuruş as lira, e.g. 164000 -> "₺1,640" (en) / "₺1.640" (tr). */
export function formatTRY(kurus: number, locale: "en" | "tr"): string {
  const whole = kurus % 100 === 0;
  const f = whole ? formatters[locale] : formattersFrac[locale];
  return `₺${f.format(kurus / 100)}`;
}

/** (unit + Σdeltas) × qty, all in integer kuruş. */
export function lineTotal(unitPrice: number, optionDeltas: number[], qty: number): number {
  return (unitPrice + optionDeltas.reduce((a, b) => a + b, 0)) * qty;
}
