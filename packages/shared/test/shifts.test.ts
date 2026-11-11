import { describe, expect, it } from "vitest";
import {
  mondayOf,
  scheduleGroupOf,
  scheduleWarnings,
  SHIFT_AREAS,
  SHIFT_LIMITS,
  shiftMinutes,
  shiftSpan,
  weekDays,
  WeekSchema,
  ClockSchema,
  type ScheduleShift,
} from "../src/index";

const WEEK = weekDays("2026-11-09");

/** A shift built from wall-clock times, with an id. */
const sh = (id: string, staffId: string, day: string, start: string, end: string): ScheduleShift => ({
  id,
  staffId,
  serviceDay: day,
  ...shiftSpan(day, start, end),
});
const warn = (shifts: ScheduleShift[], inactive: string[] = []) =>
  scheduleWarnings(shifts, { week: WEEK, inactive: new Set(inactive) });

describe("constants", () => {
  it("areas and limits", () => {
    expect(SHIFT_AREAS).toEqual(["salon", "bar", "terrace", "kitchen", "bar_station"]);
    expect(SHIFT_LIMITS).toEqual({ maxShiftH: 16, weekH: 45, dayH: 11, restH: 11 });
  });

  it("groups roles for the schedule", () => {
    expect(scheduleGroupOf("waiter")).toBe("floor");
    expect(scheduleGroupOf("host")).toBe("floor");
    expect(scheduleGroupOf("cook")).toBe("kitchen");
    expect(scheduleGroupOf("dishwasher")).toBe("kitchen");
    expect(scheduleGroupOf("bartender")).toBe("bar");
    expect(scheduleGroupOf("manager")).toBe("managers");
  });
});

describe("weeks", () => {
  it("lists the 7 service days from Monday", () => {
    expect(weekDays("2026-11-09")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
    expect(weekDays("2026-12-28").at(-1)).toBe("2027-01-03");
  });

  it("finds the Monday of a service day", () => {
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-11")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("shiftSpan", () => {
  it("a cross-midnight dinner shift: 17:00 Nov 10 to 01:00 Nov 11 Istanbul, 480 min", () => {
    const s = shiftSpan("2026-11-10", "17:00", "01:00");
    expect(s.start.toISOString()).toBe("2026-11-10T14:00:00.000Z");
    expect(s.end.toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(shiftMinutes(s)).toBe(480);
  });

  it("a 02:00 start is the next calendar day and still belongs to the service day", () => {
    const s = shiftSpan("2026-11-10", "02:00", "04:00");
    expect(s.start.toISOString()).toBe("2026-11-10T23:00:00.000Z"); // Nov 11 02:00 Istanbul
    expect(s.end.toISOString()).toBe("2026-11-11T01:00:00.000Z");
    expect(shiftMinutes(s)).toBe(120);
  });

  it("an end equal to the start is the following day (24 h)", () => {
    expect(shiftMinutes(shiftSpan("2026-11-10", "12:00", "12:00"))).toBe(24 * 60);
  });

  it("06:00 is the first minute of the service day, 05:59 the last", () => {
    expect(shiftSpan("2026-11-10", "06:00", "07:00").start.toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(shiftSpan("2026-11-10", "05:59", "06:30").start.toISOString()).toBe("2026-11-11T02:59:00.000Z");
  });
});

describe("scheduleWarnings", () => {
  // Five 9 h shifts = 45 h; each 06:00 start leaves 15 h of rest.
  const fortyFive = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d, i) =>
    sh(`s${i}`, "p", d, "06:00", "15:00"),
  );

  it("45 h in the week exactly → no warning", () => {
    expect(warn(fortyFive)).toEqual([]);
  });

  it("45 h 1 min → week_hours with the minutes and every shift of the week", () => {
    const shifts = [...fortyFive.slice(0, 4), sh("s4", "p", "2026-11-13", "06:00", "15:01")];
    expect(warn(shifts)).toEqual([{ kind: "week_hours", staffId: "p", shiftIds: ["s0", "s1", "s2", "s3", "s4"], minutes: 45 * 60 + 1 }]);
  });

  it("shifts outside the week don't count toward its hours", () => {
    const shifts = [...fortyFive, sh("prev", "p", "2026-11-07", "06:00", "10:00")];
    expect(warn(shifts)).toEqual([]);
  });

  it("11 h in a service day → none; 11 h 30 → day_hours", () => {
    expect(warn([sh("a", "p", "2026-11-10", "12:00", "23:00")])).toEqual([]);
    expect(warn([sh("a", "p", "2026-11-10", "12:00", "23:30")])).toEqual([
      { kind: "day_hours", staffId: "p", shiftIds: ["a"], minutes: 690 },
    ]);
  });

  it("day hours add up the shifts of one service day, including one past midnight", () => {
    // 08:00–12:00 (4 h) and 23:00–07:00 (8 h, past midnight, same service day): 12 h, with exactly 11 h of rest between.
    const w = warn([sh("a", "p", "2026-11-10", "08:00", "12:00"), sh("b", "p", "2026-11-10", "23:00", "07:00")]);
    expect(w).toEqual([{ kind: "day_hours", staffId: "p", shiftIds: ["a", "b"], minutes: 12 * 60 }]);
  });

  it("rest: 11 h between shifts → none; 10 h 59 → rest", () => {
    expect(warn([sh("a", "p", "2026-11-10", "17:00", "01:00"), sh("b", "p", "2026-11-11", "12:00", "17:00")])).toEqual([]);
    expect(warn([sh("a", "p", "2026-11-10", "17:00", "01:00"), sh("b", "p", "2026-11-11", "11:59", "17:00")])).toEqual([
      { kind: "rest", staffId: "p", shiftIds: ["a", "b"], minutes: 659 },
    ]);
  });

  it("rest counts the previous week's last shift against this week's first, but not pairs before the week", () => {
    const sunday = sh("sun", "p", "2026-11-08", "17:00", "02:00");
    expect(warn([sunday, sh("mon", "p", "2026-11-09", "12:00", "17:00")])).toEqual([
      { kind: "rest", staffId: "p", shiftIds: ["sun", "mon"], minutes: 600 },
    ]);
    expect(warn([sh("sat", "p", "2026-11-07", "17:00", "02:00"), sh("sun2", "p", "2026-11-08", "08:00", "10:00")])).toEqual([]);
  });

  it("people are independent", () => {
    expect(warn([sh("a", "p", "2026-11-10", "17:00", "01:00"), sh("b", "q", "2026-11-11", "08:00", "12:00")])).toEqual([]);
  });

  it("an inactive person's shift → inactive, listing their shifts in the week", () => {
    expect(warn([sh("a", "p", "2026-11-10", "17:00", "01:00"), sh("old", "p", "2026-11-08", "08:00", "10:00")], ["p"])).toEqual([
      { kind: "inactive", staffId: "p", shiftIds: ["a"] },
    ]);
  });
});

describe("request schemas", () => {
  it("a week is a real Monday", () => {
    expect(WeekSchema.safeParse("2026-11-09").success).toBe(true);
    expect(WeekSchema.safeParse("2026-11-10").success).toBe(false);
    expect(WeekSchema.safeParse("2026-02-30").success).toBe(false);
    expect(WeekSchema.safeParse("2026-11-9").success).toBe(false);
  });

  it("clock times are HH:MM", () => {
    expect(ClockSchema.safeParse("00:00").success).toBe(true);
    expect(ClockSchema.safeParse("23:59").success).toBe(true);
    expect(ClockSchema.safeParse("24:00").success).toBe(false);
    expect(ClockSchema.safeParse("7:00").success).toBe(false);
  });
});
