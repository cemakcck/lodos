/**
 * Lira typed by a person ↔ integer kuruş stored by the API. This is the one place the conversion happens.
 *
 * Accepted: "640", "640,50", "640,5", "640.50", "₺640", and thousands either way: "1.640,50" (Turkish) or
 * "1,640.50" (English). A separator followed by exactly three digits groups thousands; one or two digits are
 * kuruş. No floats are involved, so 0,1 + 0,2 cannot drift.
 */

export interface LiraOptions {
  /** Allow a leading + or − (option price changes). */
  signed?: boolean;
  /** Treat an empty string as 0 instead of refusing it. */
  emptyIsZero?: boolean;
}

const TR = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const EN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export function liraToKurus(input: string, opts: LiraOptions = {}): number | null {
  let s = input.replace(/₺/g, "").trim();
  if (s === "") return opts.emptyIsZero ? 0 : null;
  let sign = 1;
  if (opts.signed && (s[0] === "-" || s[0] === "+" || s[0] === "−")) {
    sign = s[0] === "+" ? 1 : -1;
    s = s.slice(1).trim();
  }
  const m = TR.exec(s) ?? EN.exec(s);
  if (!m) return null;
  const whole = Number(m[1]!.replace(/[.,]/g, ""));
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const kurus = whole * 100 + frac;
  if (!Number.isSafeInteger(kurus)) return null;
  return sign * kurus || 0;
}

/** Kuruş as an editable lira string: "640", "640.50" (en) or "640,50" (tr). No thousands separators. */
export function kurusToLira(kurus: number, lang: "en" | "tr"): string {
  const neg = kurus < 0;
  const abs = Math.abs(kurus);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = frac === 0 ? String(whole) : `${whole}${lang === "tr" ? "," : "."}${String(frac).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}
