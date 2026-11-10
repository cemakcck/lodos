import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

describe("shared", () => {
  it("exposes the phase version", () => {
    expect(VERSION).toBe("phase-1");
  });
});
