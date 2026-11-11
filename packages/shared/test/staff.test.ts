import { describe, expect, it } from "vitest";
import { canSignIn, LOGIN_ROLES, personRoom, SCHEDULE_ROLES, StaffRole, STATION_ROLES, tableRanges } from "../src/index";

describe("staff roles", () => {
  it("every role is exactly one of login, station or schedule-only", () => {
    expect([...LOGIN_ROLES, ...STATION_ROLES, ...SCHEDULE_ROLES].sort()).toEqual([...StaffRole.options].sort());
  });
  it("canSignIn: login and station roles sign in, schedule roles don't", () => {
    expect(canSignIn("waiter")).toBe(true);
    expect(canSignIn("manager")).toBe(true);
    expect(canSignIn("kitchen")).toBe(true);
    expect(canSignIn("bar")).toBe(true);
    for (const r of SCHEDULE_ROLES) expect(canSignIn(r)).toBe(false);
  });
  it("personRoom is per tenant and person", () => {
    expect(personRoom("t1", "abc")).toBe("t1:person:abc");
  });
});

describe("tableRanges", () => {
  it("sorts by prefix then number and collapses consecutive numbers with an en dash", () => {
    expect(tableRanges(["T10", "B2", "T5", "B1", "B3", "T6"])).toBe("B1–B3, T5–T6, T10");
  });
  it("handles empty, single and duplicate names", () => {
    expect(tableRanges([])).toBe("");
    expect(tableRanges(["T7"])).toBe("T7");
    expect(tableRanges(["T1", "T1", "T2"])).toBe("T1–T2");
    expect(tableRanges(["B1", "B2", "B3", "T5", "T6", "T7", "T8", "T9", "T10"])).toBe("B1–B3, T5–T10");
  });
});
