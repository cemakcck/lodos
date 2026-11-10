import { describe, it, expect } from "vitest";
import { kurusToLira, liraToKurus } from "../../../src/staff/manager/price";

describe("liraToKurus", () => {
  it.each([
    ["640", 64000],
    ["640,50", 64050],
    ["640,5", 64050],
    ["640.50", 64050],
    [" ₺640 ", 64000],
    ["1.640", 164000],
    ["1.640,50", 164050],
    ["1,640", 164000],
    ["1,640.50", 164050],
    ["12.345.678", 1234567800],
    ["0,01", 1],
  ])("%s → %d kuruş", (input, kurus) => {
    expect(liraToKurus(input)).toBe(kurus);
  });

  it.each(["", "abc", "6,4,0", "640,5055", "-5", "1.64.0", "12 34"])("refuses %j", (input) => {
    expect(liraToKurus(input)).toBeNull();
  });

  it("allows a sign only when asked (option price changes)", () => {
    expect(liraToKurus("-5", { signed: true })).toBe(-500);
    expect(liraToKurus("+50", { signed: true })).toBe(5000);
    expect(liraToKurus("", { signed: true, emptyIsZero: true })).toBe(0);
  });
});

describe("kurusToLira", () => {
  it("shows whole lira without decimals and kuruş with the language's separator", () => {
    expect(kurusToLira(64000, "en")).toBe("640");
    expect(kurusToLira(64050, "en")).toBe("640.50");
    expect(kurusToLira(64050, "tr")).toBe("640,50");
    expect(kurusToLira(-500, "tr")).toBe("-5");
    expect(liraToKurus(kurusToLira(164005, "tr"))).toBe(164005);
  });
});
