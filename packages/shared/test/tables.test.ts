import { describe, expect, it } from "vitest";
import { deriveTableState, TABLE_NAME_RE } from "../src/index";

const f = { openCheck: false, openCall: false, readyUnserved: false, billRequested: false };

describe("tables", () => {
  it("precedence: calling > ready > bill > seated > free", () => {
    expect(deriveTableState({ openCheck: true, openCall: true, readyUnserved: true, billRequested: true })).toBe("calling");
    expect(deriveTableState({ openCheck: true, openCall: false, readyUnserved: true, billRequested: true })).toBe("ready");
    expect(deriveTableState({ openCheck: true, openCall: false, readyUnserved: false, billRequested: true })).toBe("bill");
    expect(deriveTableState({ ...f, openCheck: true })).toBe("seated");
    expect(deriveTableState(f)).toBe("free");
  });
  it("table names", () => {
    expect(TABLE_NAME_RE.test("T12")).toBe(true);
    expect(TABLE_NAME_RE.test("B999")).toBe(true);
    expect(TABLE_NAME_RE.test("12")).toBe(false);
    expect(TABLE_NAME_RE.test("T0")).toBe(false);
    expect(TABLE_NAME_RE.test("T1000")).toBe(false);
  });
});
