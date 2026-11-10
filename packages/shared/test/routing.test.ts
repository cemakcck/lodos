import { describe, expect, it } from "vitest";
import { checkTotals, splitByStation } from "../src/index";

describe("routing", () => {
  it("totals by station", () => {
    expect(checkTotals([{ station: "kitchen", lineTotal: 500 }, { station: "bar", lineTotal: 300 }])).toEqual({ food: 500, drinks: 300, total: 800 });
    expect(checkTotals([])).toEqual({ food: 0, drinks: 0, total: 0 });
  });
  it("splits only present stations", () => {
    expect(Object.keys(splitByStation([{ station: "bar" }]))).toEqual(["bar"]);
    const r = splitByStation([{ station: "bar", n: 1 }, { station: "kitchen", n: 2 }, { station: "bar", n: 3 }]);
    expect(r.bar?.map((x) => x.n)).toEqual([1, 3]);
    expect(r.kitchen?.map((x) => x.n)).toEqual([2]);
  });
});
