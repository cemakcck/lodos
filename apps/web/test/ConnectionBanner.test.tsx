import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import "../src/i18n";
import { ConnectionBanner } from "../src/staff/ConnectionBanner";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ConnectionBanner", () => {
  it("shows Reconnecting only after 1s offline, plus last updated", () => {
    vi.useFakeTimers();
    const at = new Date("2026-01-01T09:30:15Z");
    const { rerender } = render(<ConnectionBanner connected lastSyncAt={at} />);
    expect(screen.getByText("Last updated 12:30:15")).toBeTruthy();
    rerender(<ConnectionBanner connected={false} lastSyncAt={at} />);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.queryByText("Reconnecting…")).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    rerender(<ConnectionBanner connected lastSyncAt={at} />);
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});
