import { describe, expect, it } from "vitest";
import { allocateOvertime, attendanceStatus, entryCost, entryMinutes, rateAt, TIME_CLOCK } from "../src/labour";
import { serviceDayOf } from "../src/time";

const at = (s: string) => new Date(`${s}+03:00`);
const MIN = 60_000;

describe("rateAt", () => {
  const rates = [
    { from: at("2026-03-01T00:00"), kurusPerHour: 20000 },
    { from: at("2026-03-15T12:00"), kurusPerHour: 25000 },
  ];
  it("uses the latest rate in force, or 0", () => {
    expect(rateAt(rates, at("2026-02-28T23:59"))).toBe(0);
    expect(rateAt(rates, at("2026-03-15T11:59"))).toBe(20000);
    expect(rateAt(rates, at("2026-03-15T12:00"))).toBe(25000);
    expect(rateAt([...rates].reverse(), at("2026-04-01T00:00"))).toBe(25000);
    expect(rateAt([], at("2026-04-01T00:00"))).toBe(0);
  });
});

describe("entryMinutes", () => {
  const now = at("2026-03-10T12:00");
  it("rounds closed entries, a cross-midnight entry counts whole", () => {
    expect(entryMinutes({ in: at("2026-03-09T17:00"), out: at("2026-03-10T01:10") }, now)).toBe(490);
    expect(entryMinutes({ in: at("2026-03-09T17:00:00"), out: at("2026-03-09T17:00:40") }, now)).toBe(1);
  });
  it("is null for open entries, including those open past 16 h", () => {
    expect(entryMinutes({ in: at("2026-03-10T11:00"), out: null }, now)).toBeNull();
    expect(entryMinutes({ in: new Date(now.getTime() - (16 * 60 + 1) * MIN), out: null }, now)).toBeNull();
  });
});

describe("allocateOvertime", () => {
  const entry = (id: string, day: string, minutes: number, staffId = "a") => ({
    id, staffId, serviceDay: day, minutes, in: at(`${day}T10:00`),
  });
  const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"];
  it("gives the sixth entry the minutes beyond 45 h (five 8 h then a 10 h entry: 300)", () => {
    const ot = allocateOvertime(days.map((d, i) => entry(`e${i}`, d, i === 5 ? 600 : 480)));
    expect([...ot.entries()].filter(([, v]) => v > 0)).toEqual([["e5", 300]]);
    expect(ot.get("e0")).toBe(0);
  });
  it("six 8 h entries are 48 h: 180 overtime minutes on the sixth", () => {
    const ot = allocateOvertime(days.map((d, i) => entry(`e${i}`, d, 480)));
    expect([...ot.entries()].filter(([, v]) => v > 0)).toEqual([["e5", 180]]);
  });
  it("splits across the entries that cross the line, in time order, and per staff", () => {
    const ot = allocateOvertime([
      entry("late", "2026-03-04", 600),
      entry("x", "2026-03-04", 600, "b"),
      entry("first", "2026-03-02", 2600),
      entry("next", "2026-03-08", 100),
    ]);
    expect(ot.get("first")).toBe(0);
    expect(ot.get("late")).toBe(500);
    expect(ot.get("next")).toBe(100);
    expect(ot.get("x")).toBe(0);
  });
  it("starts a fresh count each Monday", () => {
    const ot = allocateOvertime([entry("sun", "2026-03-08", 2700), entry("mon", "2026-03-09", 600)]);
    expect(ot.get("sun")).toBe(0);
    expect(ot.get("mon")).toBe(0);
  });
  it("allocates to the October entries when the week spans the month boundary", () => {
    // Monday 2026-09-28 ... Sunday 2026-10-04
    const ot = allocateOvertime([
      entry("o2", "2026-10-02", 600),
      entry("s28", "2026-09-28", 600),
      entry("s29", "2026-09-29", 600),
      entry("s30", "2026-09-30", 600),
      entry("o1", "2026-10-01", 600),
    ]);
    expect(ot.get("s28")).toBe(0);
    expect(ot.get("s29")).toBe(0);
    expect(ot.get("s30")).toBe(0);
    expect(ot.get("o1")).toBe(0);
    expect(ot.get("o2")).toBe(300);
  });
});

describe("entryCost", () => {
  it("prices minutes and the 0.5x premium, half up to the kuruş", () => {
    expect(entryCost(480, 0, 20000)).toBe(160000);
    expect(entryCost(480, 60, 20000)).toBe(170000);
    expect(entryCost(1, 0, 30)).toBe(1); // 0.5 rounds up
    expect(entryCost(0, 0, 20000)).toBe(0);
  });
  it("prices each entry at its clock-in rate", () => {
    const rates = [{ from: at("2026-03-01T00:00"), kurusPerHour: 20000 }, { from: at("2026-03-15T00:00"), kurusPerHour: 30000 }];
    expect(entryCost(60, 0, rateAt(rates, at("2026-03-14T18:00")))).toBe(20000);
    expect(entryCost(60, 0, rateAt(rates, at("2026-03-15T18:00")))).toBe(30000);
  });
});

describe("attendanceStatus", () => {
  const start = at("2026-03-10T17:00");
  const shift = { start, end: at("2026-03-11T01:00") };
  const clockIn = (min: number) => ({ in: new Date(start.getTime() + min * MIN), out: null as Date | null });
  it("exposes the thresholds", () => {
    expect(TIME_CLOCK).toEqual({ lateGraceMin: 5, missingAfterMin: 15, forgotOutH: 16, weekH: 45, overtimeFactor: 1.5 });
  });
  it("is on_shift at start + 5:00 and late at 5:01", () => {
    const now = new Date(start.getTime() + 30 * MIN);
    expect(attendanceStatus(shift, [clockIn(5)], now)).toEqual({ status: "on_shift" });
    const e = { in: new Date(start.getTime() + 5 * MIN + 1000), out: null };
    expect(attendanceStatus(shift, [e], now)).toEqual({ status: "late", lateMin: 5 });
  });
  it("stays late while clocked in, then finished once closed", () => {
    const e = { in: new Date(start.getTime() + 20 * MIN), out: null as Date | null };
    expect(attendanceStatus(shift, [e], new Date(start.getTime() + 60 * MIN))).toEqual({ status: "late", lateMin: 20 });
    const closed = { ...e, out: new Date(start.getTime() + 200 * MIN) };
    expect(attendanceStatus(shift, [closed], new Date(start.getTime() + 210 * MIN)).status).toBe("finished");
  });
  it("later before start, not yet missing at +15:00, missing at +15:01", () => {
    expect(attendanceStatus(shift, [], new Date(start.getTime() - MIN)).status).toBe("later");
    expect(attendanceStatus(shift, [], new Date(start.getTime() + 15 * MIN)).status).not.toBe("missing");
    expect(attendanceStatus(shift, [], new Date(start.getTime() + 15 * MIN + 1000)).status).toBe("missing");
  });
  it("a cross-midnight entry is on its start's service day and finished at 02:00", () => {
    const e = { in: at("2026-03-10T17:00"), out: at("2026-03-11T01:10") };
    expect(serviceDayOf(e.in)).toBe("2026-03-10");
    expect(entryMinutes(e, at("2026-03-11T02:00"))).toBe(490);
    expect(attendanceStatus(shift, [e], at("2026-03-11T02:00")).status).toBe("finished");
  });
  it("is unscheduled with an entry but no shift", () => {
    expect(attendanceStatus(null, [clockIn(0)], new Date(start.getTime() + MIN)).status).toBe("unscheduled");
  });
  it("forgot_out wins once an entry is open past 16 h", () => {
    const e = { in: start, out: null };
    expect(attendanceStatus(shift, [e], new Date(start.getTime() + 16 * 60 * MIN)).status).toBe("on_shift");
    expect(attendanceStatus(shift, [e], new Date(start.getTime() + (16 * 60 + 1) * MIN)).status).toBe("forgot_out");
    expect(attendanceStatus(null, [e], new Date(start.getTime() + (16 * 60 + 1) * MIN)).status).toBe("forgot_out");
    const lateE = { in: new Date(start.getTime() + 30 * MIN), out: null };
    expect(attendanceStatus(shift, [lateE], new Date(start.getTime() + 17 * 60 * MIN)).status).toBe("forgot_out");
  });
});
