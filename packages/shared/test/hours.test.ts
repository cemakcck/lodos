import { describe, expect, it } from "vitest";
import { istanbulHour, SERVICE_HOURS, serviceDayStartOf, serviceHourIndex } from "../src/index";

describe("service hours", () => {
  it("indexes hours from the 06:00 service day start", () => {
    expect(serviceHourIndex(6)).toBe(0);
    expect(serviceHourIndex(23)).toBe(17);
    expect(serviceHourIndex(0)).toBe(18);
    expect(serviceHourIndex(5)).toBe(23);
  });

  it("lists the service hours in service order", () => {
    expect(SERVICE_HOURS).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]);
    SERVICE_HOURS.forEach((h, i) => expect(serviceHourIndex(h)).toBe(i));
  });

  it("reads the Istanbul hour (UTC+3)", () => {
    expect(istanbulHour(new Date("2026-11-10T17:59:00Z"))).toBe(20);
    expect(istanbulHour(new Date("2026-11-10T21:00:00Z"))).toBe(0);
    expect(istanbulHour(new Date("2026-11-11T02:59:59Z"))).toBe(5);
  });

  it("a service day starts 06:00 Istanbul = 03:00Z", () => {
    expect(serviceDayStartOf("2026-11-10")).toEqual(new Date("2026-11-10T03:00:00Z"));
    expect(serviceDayStartOf("2026-12-31")).toEqual(new Date("2026-12-31T03:00:00Z"));
  });
});
