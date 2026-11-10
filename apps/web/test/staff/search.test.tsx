import { describe, it, expect } from "vitest";
import { searchItems } from "../../src/staff/order/search";

const item = (id: string, en: string, tr = en) => ({ id, name: { en, tr } });

// Synthetic: the seed has no şiş or çoban salatası.
const ITEMS = [
  item("vinegar", "Sherry vinegar dressing", "Şeri sirkesi sos"),
  item("sis", "Lamb skewer", "Kuzu şiş"),
  item("coban", "Shepherd's salad", "Çoban salatası"),
  item("negroni", "Lodos Negroni"),
  item("ribeye", "Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g"),
];
const ids = (q: string) => searchItems(ITEMS, q).map((i) => i.id);

describe("searchItems", () => {
  it('"sis" finds "Kuzu şiş" (Turkish folded, TR name)', () => {
    expect(ids("sis")).toEqual(["sis"]);
    expect(ids("ŞİŞ")).toEqual(["sis"]);
  });

  it('"COBAN" finds "Çoban salatası"', () => {
    expect(ids("COBAN")).toEqual(["coban"]);
  });

  it('"neg" ranks "Lodos Negroni" (word prefix) above a mid-word match', () => {
    expect(ids("neg")).toEqual(["negroni", "vinegar"]);
  });

  it("ranks a whole-name prefix first, then word prefixes, then substrings; ties keep menu order", () => {
    const list = [item("a", "Garden tonic"), item("b", "Tonic water"), item("c", "Gin and tonic"), item("d", "Platonic ideal")];
    expect(searchItems(list, "tonic").map((i) => i.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("matches the English name too, and a blank query returns everything in order", () => {
    expect(ids("skewer")).toEqual(["sis"]);
    expect(ids("antrikot")).toEqual(["ribeye"]);
    expect(ids("  ")).toEqual(ITEMS.map((i) => i.id));
    expect(ids("zzz")).toEqual([]);
  });
});
