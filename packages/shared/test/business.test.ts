import { describe, expect, it } from "vitest";
import { comparisonDays, menuQuadrant, monthDays, pctChange, previousMonth } from "../src/index";

describe("monthDays", () => {
  it("a past month is complete", () => {
    const days = monthDays("2026-10", "2026-11-14");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-10-01");
    expect(days[30]).toBe("2026-10-31");
  });

  it("the current month is capped at today", () => {
    expect(monthDays("2026-11", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(monthDays("2026-12", "2026-12-01")).toEqual(["2026-12-01"]);
  });

  it("a future month has no days; February knows leap years", () => {
    expect(monthDays("2026-12", "2026-11-30")).toEqual([]);
    expect(monthDays("2028-02", "2028-12-01")).toHaveLength(29);
    expect(monthDays("2027-02", "2027-12-01")).toHaveLength(28);
  });
});

describe("comparisonDays", () => {
  it("the current month compares with the previous month's days 1 … the same day number", () => {
    expect(comparisonDays("2026-11", "2026-11-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(comparisonDays("2026-12", "2026-12-01")).toEqual(["2026-11-01"]);
  });

  it("is capped at the previous month's length", () => {
    expect(comparisonDays("2027-03", "2027-03-31")).toHaveLength(28); // February 2027
    expect(comparisonDays("2026-12", "2026-12-31").at(-1)).toBe("2026-11-30");
  });

  it("a past month compares with the whole previous month, across a year", () => {
    expect(comparisonDays("2026-10", "2026-11-14")).toHaveLength(30);
    expect(comparisonDays("2027-01", "2027-02-10")[0]).toBe("2026-12-01");
    expect(comparisonDays("2026-12", "2026-11-30")).toEqual([]);
  });

  it("previousMonth crosses the year", () => {
    expect(previousMonth("2027-01")).toBe("2026-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
});

describe("pctChange", () => {
  it("is the change in percent, one decimal; null when prev is 0", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(100, 300)).toBe(-66.7);
    expect(pctChange(0, 0)).toBeNull();
    expect(pctChange(5, 0)).toBeNull();
  });

  it("a negative previous value: going up is still a positive change", () => {
    expect(pctChange(-50, -100)).toBe(50);
  });
});

describe("menuQuadrant", () => {
  it("median quantity and a 4.0 rating split the four groups; the edges count as high", () => {
    // qty median of [10, 20, 30, 40] = 25.
    const groups = menuQuadrant([
      { qty: 30, ratingAvg: 4.0 }, // sells a lot, exactly 4.0 → high
      { qty: 10, ratingAvg: 4.5 },
      { qty: 40, ratingAvg: 3.99 },
      { qty: 20, ratingAvg: 2 },
    ]);
    expect(groups).toEqual(["stars", "hidden_gems", "fix", "rethink"]);
  });

  it("qty equal to the median sells a lot (odd count)", () => {
    // median of [5, 10, 15] = 10.
    expect(menuQuadrant([{ qty: 10, ratingAvg: 4 }, { qty: 5, ratingAvg: 4 }, { qty: 15, ratingAvg: 3 }])).toEqual(["stars", "hidden_gems", "fix"]);
  });

  it("an unrated dish has no group; an empty list is empty", () => {
    expect(menuQuadrant([{ qty: 10, ratingAvg: null }, { qty: 1, ratingAvg: 5 }])).toEqual([null, "hidden_gems"]);
    expect(menuQuadrant([])).toEqual([]);
  });
});
