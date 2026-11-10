import { describe, expect, it } from "vitest";
import { formatElapsed, istanbulClock, serviceDayOf, SERVICE_DAY_START_HOUR } from "../src/index";

describe("time", () => {
  it("service day starts at 06:00 Istanbul", () => {
    expect(SERVICE_DAY_START_HOUR).toBe(6);
    expect(serviceDayOf(new Date("2026-11-13T02:59:00Z"))).toBe("2026-11-12");
    expect(serviceDayOf(new Date("2026-11-13T03:00:00Z"))).toBe("2026-11-13");
    expect(serviceDayOf(new Date("2026-11-12T22:30:00Z"))).toBe("2026-11-12");
  });
  it("istanbulClock", () => {
    expect(istanbulClock(new Date("2026-11-13T02:59:00Z"))).toBe("05:59");
    expect(istanbulClock(new Date("2026-11-12T21:05:00Z"))).toBe("00:05");
  });
  it("formatElapsed", () => {
    expect(formatElapsed(17 * 60_000 + 20_000)).toBe("17:20");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(0)).toBe("00:00");
  });
});
