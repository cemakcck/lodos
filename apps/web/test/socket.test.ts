import { describe, it, expect, vi, afterEach } from "vitest";
import type { Socket } from "socket.io-client";
import { followNetwork, OFFLINE_RETRY_MS } from "../src/lib/socket";

afterEach(() => vi.useRealTimers());

function fakeSocket(active = true) {
  const s = {
    active,
    disconnect: vi.fn(() => {
      s.active = false;
      return s;
    }),
    connect: vi.fn(() => {
      s.active = true;
      return s;
    }),
  };
  return s;
}

describe("followNetwork", () => {
  it("closes the socket when the browser goes offline and reconnects at once when it is back", () => {
    const s = fakeSocket();
    const unfollow = followNetwork(s as unknown as Socket);
    window.dispatchEvent(new Event("offline"));
    expect(s.disconnect).toHaveBeenCalledTimes(1);
    expect(s.connect).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    // A second "online" with nothing paused does nothing.
    window.dispatchEvent(new Event("online"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    unfollow();
  });

  it("leaves a deliberately closed socket closed, and stops listening once released", () => {
    const closed = fakeSocket(false);
    const unfollowClosed = followNetwork(closed as unknown as Socket);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(closed.disconnect).not.toHaveBeenCalled();
    expect(closed.connect).not.toHaveBeenCalled();
    unfollowClosed();

    const s = fakeSocket();
    followNetwork(s as unknown as Socket)();
    window.dispatchEvent(new Event("offline"));
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it("recovers even if the browser never fires 'online': retries within 10 s", () => {
    vi.useFakeTimers();
    const s = fakeSocket();
    const unfollow = followNetwork(s as unknown as Socket);
    window.dispatchEvent(new Event("offline"));
    expect(s.disconnect).toHaveBeenCalledTimes(1);
    expect(OFFLINE_RETRY_MS).toBeLessThanOrEqual(10_000);
    vi.advanceTimersByTime(OFFLINE_RETRY_MS - 1);
    expect(s.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.connect).toHaveBeenCalledTimes(1);
    // Handed back to socket.io's own backoff: no further manual retries, and a late "online" does nothing.
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("online"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    unfollow();
  });

  it("retries at once when the screen becomes visible or gets focus while paused", () => {
    vi.useFakeTimers();
    const s = fakeSocket();
    const unfollow = followNetwork(s as unknown as Socket);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("focus"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("offline"));
    document.dispatchEvent(new Event("visibilitychange")); // jsdom documents are "visible"
    expect(s.connect).toHaveBeenCalledTimes(2);
    // Not paused: focus does nothing, and the pending retry timer was cancelled.
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(60_000);
    expect(s.connect).toHaveBeenCalledTimes(2);
    unfollow();
  });
});
