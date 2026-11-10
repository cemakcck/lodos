import { describe, expect, it } from "vitest";
import { guestItemStatus, ticketAgeState, TICKET_THRESHOLDS } from "../src/index";

const s = new Date("2026-11-13T18:00:00Z");
const m = (n: number) => new Date(s.getTime() + n * 60_000);

describe("tickets", () => {
  it("age state thresholds", () => {
    expect(TICKET_THRESHOLDS).toEqual({ warnMin: 8, lateMin: 15 });
    expect(ticketAgeState(s, m(7.99))).toBe("ok");
    expect(ticketAgeState(s, m(8))).toBe("warn");
    expect(ticketAgeState(s, m(15))).toBe("warn");
    expect(ticketAgeState(s, m(15.01))).toBe("late");
  });
  it("guest item status", () => {
    expect(guestItemStatus({ status: "new", anyChecked: false })).toBe("sent");
    expect(guestItemStatus({ status: "new", anyChecked: true })).toBe("preparing");
    expect(guestItemStatus({ status: "held", anyChecked: false })).toBe("sent");
    expect(guestItemStatus({ status: "started", anyChecked: false })).toBe("preparing");
    expect(guestItemStatus({ status: "ready", anyChecked: true })).toBe("ready");
    expect(guestItemStatus({ status: "ready", servedAt: new Date("2026-11-13T18:20:00Z"), anyChecked: true })).toBe("served");
  });
});
