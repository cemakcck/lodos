import { describe, expect, it } from "vitest";
import { rankGroup, scoreStation, scoreWaiter, wholeCount } from "../src/index";

const waiter = { ratingAvg: 4.5, ratingCount: 10, covers: 80, minutes: 1200, shifts: 5, lateShifts: 1 };
const station = { dishAvg: 4, dishCount: 12, tickets: 100, onTime: 90, minutes: 1200, shifts: 5, lateShifts: 0 };

describe("scoreWaiter", () => {
  it("rounds each component to 1 decimal and the breakdown sums to the score", () => {
    const r = scoreWaiter(waiter, 5);
    if (r.score === null) throw new Error("ranked expected");
    // rating 43.75 -> 43.8, workload 35 * 4/5 = 28, reliability 12
    expect(r.breakdown.map((b) => [b.key, b.points, b.max])).toEqual([["rating", 43.8, 50], ["workload", 28, 35], ["reliability", 12, 15]]);
    expect(r.score).toBe(83.8);
    expect(Math.round(r.breakdown.reduce((s, b) => s + b.points, 0) * 10) / 10).toBe(r.score);
  });

  it("4 ratings, or 1 shift, is not enough data", () => {
    expect(scoreWaiter({ ...waiter, ratingCount: 4 }, 5)).toEqual({ score: null, reason: "not_enough_data" });
    expect(scoreWaiter({ ...waiter, shifts: 1 }, 5)).toEqual({ score: null, reason: "not_enough_data" });
    expect(scoreWaiter({ ...waiter, ratingCount: 5, shifts: 2 }, 5).score).not.toBeNull();
  });

  it("workload is per hour: a part-timer with the same covers per hour scores the same", () => {
    const full = scoreWaiter(waiter, 5);
    const part = scoreWaiter({ ...waiter, covers: 20, minutes: 300 }, 5);
    expect(part).toEqual(full);
  });
});

describe("scoreStation", () => {
  it("scores dish rating, throughput, on time and reliability", () => {
    const r = scoreStation(station, 6);
    if (r.score === null) throw new Error("ranked expected");
    // rating 37.5, throughput 20 * 5/6 = 16.7, on time 13.5, reliability 15
    expect(r.breakdown.map((b) => [b.key, b.points])).toEqual([["rating", 37.5], ["throughput", 16.7], ["onTime", 13.5], ["reliability", 15]]);
    expect(r.score).toBe(82.7);
  });

  it("needs 10 dish ratings and 2 shifts", () => {
    expect(scoreStation({ ...station, dishCount: 9 }, 6).score).toBeNull();
    expect(scoreStation({ ...station, shifts: 1 }, 6).score).toBeNull();
    expect(scoreStation({ ...station, dishCount: 10 }, 6).score).not.toBeNull();
  });
});

describe("rankGroup", () => {
  it("sorts by score descending, ties by name, unranked last", () => {
    const rows = [
      { name: "Zeynep", score: 80 },
      { name: "Ali", score: null },
      { name: "Mert", score: 90 },
      { name: "Can", score: 80 },
      { name: "Bora", score: null },
    ];
    expect(rankGroup(rows).map((r) => r.name)).toEqual(["Mert", "Can", "Zeynep", "Ali", "Bora"]);
  });
});

describe("wholeCount", () => {
  it("shows a shared count as a whole number, half up", () => {
    expect([0, 2, 37.4, 37.5, 37.6, 1 / 3 + 1 / 3 + 1 / 3, 0.5 * 3].map(wholeCount)).toEqual([0, 2, 37, 38, 38, 1, 2]);
    // Thirds that should make a half still round up.
    expect(wholeCount(37 + 1 / 6 + 1 / 6 + 1 / 6)).toBe(38);
  });
});
