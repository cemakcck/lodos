const FOLD_MAP: Record<string, string> = {
  İ: "i", I: "i", ı: "i", Ş: "s", ş: "s", Ğ: "g", ğ: "g", Ü: "u", ü: "u", Ö: "o", ö: "o", Ç: "c", ç: "c",
};

/** Turkish-aware ASCII fold + lowercase. */
export function fold(s: string): string {
  return s
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => FOLD_MAP[c] ?? c)
    .replace(/̇/g, "")
    .toLowerCase();
}

// Small curated lists; stored in folded form. Whole-word matches only.
const PROFANITY = new Set(
  [
    // EN
    "fuck", "fucking", "fucker", "motherfucker", "shit", "shitty", "bullshit", "bitch", "asshole", "bastard", "cunt", "wanker",
    // TR (folded)
    "siktir", "sikik", "orospu", "pezevenk", "yarrak", "amk", "ibne", "gavat", "pust", "serefsiz",
  ].map(fold),
);

/** Replaces listed EN/TR profanity (whole word, case/diacritic-insensitive) with "•••". */
export function maskProfanity(s: string): string {
  return s.replace(/[\p{L}\p{M}]+/gu, (w) => (PROFANITY.has(fold(w)) ? "•••" : w));
}

// Matched against fold(note), so patterns are folded (ASCII, lowercase).
const ALLERGY_RE =
  /allerg|alerj|gluten|\bnuts?\b|peanut|walnut|hazelnut|pistachio|fistik|findik|laktoz|lactose|vegan|celiac|colyak/;

export function noteMentionsAllergy(note: string): boolean {
  return ALLERGY_RE.test(fold(note));
}
