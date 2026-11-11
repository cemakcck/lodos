import { describe, expect, it } from "vitest";
import {
  SHARE_LABELS,
  allocate,
  divide,
  evenShares,
  fractionLabel,
  lineRef,
  parseUnitRef,
  unitRef,
  vatBreakdown,
  vatOf,
  COMP_REASONS,
  VOID_REASONS,
} from "../src/index";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("divide", () => {
  it("gives the extra kuruş to the earliest parts", () => {
    expect(divide(100001, 3)).toEqual([33334, 33334, 33333]);
    expect(sum(divide(100001, 3))).toBe(100001);
  });
  it("throws on bad input", () => {
    expect(() => divide(100, 0)).toThrow();
    expect(() => divide(100.5, 2)).toThrow();
  });
});

describe("evenShares", () => {
  it("sums exactly and differs by at most one kuruş", () => {
    for (const total of [1, 7, 99, 100001, 1234567]) {
      for (let n = 2; n <= 20; n++) {
        const s = evenShares(total, n);
        expect(s).toHaveLength(n);
        expect(sum(s)).toBe(total);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      }
    }
  });
  it("clamps n to 2..20 but rejects non-integers", () => {
    expect(evenShares(100, 1)).toHaveLength(2);
    expect(evenShares(100, 50)).toHaveLength(20);
    expect(() => evenShares(100, 2.5)).toThrow();
  });
});

describe("allocate", () => {
  it("splits proportionally with leftovers to the earliest index", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(sum(allocate(327000, [217500, 109500]))).toBe(327000);
  });
  it("falls back to divide when all weights are zero", () => {
    expect(allocate(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });
  it("gives the largest remainder the extra kuruş", () => {
    expect(allocate(10, [1, 2, 7])).toEqual([1, 2, 7]);
    expect(allocate(5, [1, 3])).toEqual([1, 4]);
  });
});

describe("vat", () => {
  it("rounds half up per rate", () => {
    expect(vatOf(272000, 10)).toBe(24727);
    expect(vatOf(110000, 20)).toBe(18333);
  });
  it("breaks down only rates with gross, ascending", () => {
    expect(vatBreakdown({ 20: 0, 10: 1100 })).toEqual([{ rate: 10, gross: 1100, vat: 100 }]);
    expect(vatBreakdown({ 20: 1200, 10: 1100 }).map((r) => r.rate)).toEqual([10, 20]);
  });
});

describe("labels and refs", () => {
  it("labels fractions", () => {
    expect([1, 2, 3, 4, 6].map(fractionLabel)).toEqual(["", "½", "⅓", "¼", "1/6"]);
  });
  it("builds and parses refs", () => {
    expect(lineRef("abc", 2)).toBe("abc:2");
    expect(unitRef("abc", 2, 1)).toBe("abc:2:1");
    expect(parseUnitRef("abc:2:1")).toEqual({ orderId: "abc", index: 2, unit: 1 });
    expect(parseUnitRef("x")).toBeNull();
  });
  it("has 20 share labels and the reason lists", () => {
    expect(SHARE_LABELS).toHaveLength(20);
    expect(SHARE_LABELS[19]).toBe("T");
    expect(COMP_REASONS).toContain("celebration");
    expect(VOID_REASONS).toContain("wrong_item");
  });
});
