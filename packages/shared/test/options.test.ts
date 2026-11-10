import { describe, expect, it } from "vitest";
import { resolveOptions, type OptionGroup } from "../src/index";

const n = (s: string) => ({ en: s, tr: s });
const groups: OptionGroup[] = [
  { id: "size", name: n("Size"), type: "single", required: true,
    options: [{ id: "s", name: n("Small"), priceDelta: 0 }, { id: "l", name: n("Large"), priceDelta: 2000 }] },
  { id: "extras", name: n("Extras"), type: "multi", required: false,
    options: [{ id: "cheese", name: n("Cheese"), priceDelta: 1500 }, { id: "egg", name: n("Egg"), priceDelta: 1000 }] },
];

describe("resolveOptions", () => {
  it("errors when a required group has no selection", () => {
    const r = resolveOptions(groups, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("size"))).toBe(true);
  });
  it("errors on two options in a single group", () => {
    const r = resolveOptions(groups, [{ groupId: "size", optionIds: ["s", "l"] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("size"))).toBe(true);
  });
  it("errors on an option from another group", () => {
    const r = resolveOptions(groups, [{ groupId: "size", optionIds: ["cheese"] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("size"))).toBe(true);
  });
  it("errors on an unknown group", () => {
    const r = resolveOptions(groups, [{ groupId: "size", optionIds: ["s"] }, { groupId: "nope", optionIds: ["x"] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("nope"))).toBe(true);
  });
  it("resolves a valid selection with multiple extras", () => {
    const r = resolveOptions(groups, [
      { groupId: "size", optionIds: ["l"] },
      { groupId: "extras", optionIds: ["cheese", "egg"] },
    ]);
    expect(r).toEqual({ ok: true, chosen: [
      { groupId: "size", optionId: "l", name: n("Large"), priceDelta: 2000 },
      { groupId: "extras", optionId: "cheese", name: n("Cheese"), priceDelta: 1500 },
      { groupId: "extras", optionId: "egg", name: n("Egg"), priceDelta: 1000 },
    ] });
  });
  it("allows omitting optional groups", () => {
    expect(resolveOptions(groups, [{ groupId: "size", optionIds: ["s"] }]).ok).toBe(true);
  });
});
