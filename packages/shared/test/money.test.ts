import { describe, expect, it } from "vitest";
import { formatTRY, lineTotal } from "../src/index";

describe("money", () => {
  it("formats whole and fractional lira per locale", () => {
    expect(formatTRY(164000, "en")).toBe("₺1,640");
    expect(formatTRY(164000, "tr")).toBe("₺1.640");
    expect(formatTRY(1250, "en")).toBe("₺12.50");
    expect(formatTRY(1250, "tr")).toBe("₺12,50");
  });
  it("computes line totals", () => {
    expect(lineTotal(64000, [18000], 2)).toBe(164000);
    expect(lineTotal(1000, [], 3)).toBe(3000);
  });
});
