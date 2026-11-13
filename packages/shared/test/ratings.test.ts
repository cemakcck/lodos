import { describe, expect, it } from "vitest";
import {
  addStar,
  avgOf,
  emptyAgg,
  mergeAgg,
  mergeRatingAgg,
  restaurantRating,
  type RatingAgg,
} from "../src/index";

const agg = (stars: (1 | 2 | 3 | 4 | 5)[]) => stars.reduce(addStar, emptyAgg());
const empty = (): RatingAgg => ({ waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() });
const nm = (en: string) => ({ en, tr: en });

describe("ratings", () => {
  it("avgOf is null for an empty aggregate", () => {
    expect(avgOf(emptyAgg())).toBeNull();
    expect(avgOf(agg([4, 5]))).toBe(4.5);
  });

  it("addStar and mergeAgg keep sum, count and distribution", () => {
    const m = mergeAgg(agg([1, 5]), agg([5, 3]));
    expect(m).toEqual({ sum: 14, count: 4, dist: [1, 0, 1, 0, 2] });
  });

  it("restaurantRating averages the non-null category averages", () => {
    const r = empty();
    r.food = agg([4, 4]);
    r.cleanliness = agg([5]);
    expect(restaurantRating(r)).toBe(4.5);
    expect(restaurantRating(empty())).toBeNull();
  });

  it("mergeRatingAgg sums the same waiter and dish across two days", () => {
    const a = empty();
    a.waiter = [{ staffId: "w1", ...agg([5, 4]) }];
    a.dishes = [{ itemId: "i1", name: nm("Soup"), ...agg([5]) }, { itemId: null, name: nm("Old"), ...agg([2]) }];
    a.food = agg([5]);
    const b = empty();
    b.waiter = [{ staffId: "w1", ...agg([3]) }, { staffId: "w2", ...agg([1]) }];
    b.dishes = [{ itemId: "i1", name: nm("Soup"), ...agg([3]) }, { itemId: null, name: nm("Old"), ...agg([4]) }];
    b.food = agg([3]);
    const m = mergeRatingAgg(a, b);
    expect(m.waiter.find((w) => w.staffId === "w1")).toMatchObject({ sum: 12, count: 3 });
    expect(m.waiter).toHaveLength(2);
    expect(m.dishes).toHaveLength(2);
    expect(m.dishes.find((d) => d.itemId === "i1")).toMatchObject({ sum: 8, count: 2 });
    expect(m.dishes.find((d) => d.itemId === null)).toMatchObject({ sum: 6, count: 2 });
    expect(m.food).toEqual({ sum: 8, count: 2, dist: [0, 0, 1, 0, 1] });
  });
});
