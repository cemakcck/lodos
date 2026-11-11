import { describe, it, expect } from "vitest";
import { clampInto, findFree, guidesFor, nextName, overlaps, sizeFor, snap } from "../../src/staff/floorplan/geometry";

const r = (x: number, y: number, w = 64, h = 64) => ({ x, y, w, h });

describe("snap", () => {
  it("rounds to the nearest 16 px step", () => {
    expect(snap(23)).toBe(16);
    expect(snap(25)).toBe(32);
    expect(snap(24)).toBe(32);
    expect(snap(0)).toBe(0);
    expect(snap(50, 10)).toBe(50);
  });
});

describe("clampInto", () => {
  const room = { width: 800, height: 480 };
  it("keeps a table inside the room", () => {
    expect(clampInto(r(-20, -5), room)).toEqual(r(0, 0));
    expect(clampInto(r(780, 470), room)).toEqual(r(736, 416));
    expect(clampInto(r(100, 100), room)).toEqual(r(100, 100));
  });
});

describe("overlaps", () => {
  it("touching edges are not overlapping", () => {
    expect(overlaps(r(0, 0), r(64, 0))).toBe(false);
    expect(overlaps(r(0, 0), r(0, 64))).toBe(false);
    expect(overlaps(r(0, 0), r(64, 64))).toBe(false);
  });
  it("any shared area is overlapping", () => {
    expect(overlaps(r(0, 0), r(63, 0))).toBe(true);
    expect(overlaps(r(0, 0), r(10, 10, 10, 10))).toBe(true);
    expect(overlaps(r(10, 10, 10, 10), r(0, 0))).toBe(true);
  });
});

describe("guidesFor", () => {
  it("finds aligned edges and centres within 4 px", () => {
    // Left edges 100 vs 103: a vertical guide at the other's left edge.
    expect(guidesFor(r(103, 300), [r(100, 0)])).toContainEqual({ x: 100 });
    // Centres: moving centre 132+... (x 98 → centre 130) vs other centre 132.
    expect(guidesFor(r(98, 300), [r(100, 0)])).toContainEqual({ x: 132 });
    // Top edges 200 vs 196: a horizontal guide.
    expect(guidesFor(r(400, 196), [r(0, 200)])).toContainEqual({ y: 200 });
  });
  it("ignores alignments further than 4 px", () => {
    expect(guidesFor(r(105, 300), [r(100, 0, 64, 64)]).filter((g) => g.x !== undefined && g.x <= 170)).toEqual([]);
    expect(guidesFor(r(400, 300), [r(0, 0)])).toEqual([]);
  });
  it("does not repeat a guide", () => {
    const g = guidesFor(r(100, 300), [r(100, 0), r(100, 100)]);
    expect(g.filter((x) => x.x === 100)).toHaveLength(1);
  });
});

describe("sizeFor", () => {
  it("follows the seed presets", () => {
    expect(sizeFor("round", 2)).toEqual({ w: 64, h: 64 });
    expect(sizeFor("round", 4)).toEqual({ w: 76, h: 76 });
    expect(sizeFor("round", 6)).toEqual({ w: 88, h: 88 });
    expect(sizeFor("rect", 2)).toEqual({ w: 72, h: 56 });
    expect(sizeFor("rect", 4)).toEqual({ w: 96, h: 64 });
    expect(sizeFor("rect", 8)).toEqual({ w: 120, h: 72 });
  });
});

describe("nextName", () => {
  it("continues from the server's next name and the draft's own names", () => {
    expect(nextName("B", { T: "T17", B: "B6" }, ["B1", "T4"])).toBe("B6");
    expect(nextName("B", { T: "T17", B: "B6" }, ["B1", "B6"])).toBe("B7");
    expect(nextName("T", { T: "T17", B: "B6" }, ["T17", "T18", "B9"])).toBe("T19");
  });
});

describe("findFree", () => {
  it("finds the first grid spot that fits and overlaps nothing", () => {
    const room = { width: 800, height: 480 };
    const spot = findFree({ w: 64, h: 64 }, [r(16, 16, 200, 200)], room);
    expect(overlaps({ ...spot, w: 64, h: 64 }, r(16, 16, 200, 200))).toBe(false);
    expect(spot.x % 16).toBe(0);
    expect(spot.y % 16).toBe(0);
  });
});
