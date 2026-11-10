import { describe, it, expect, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { followNetwork } from "../src/lib/socket";

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
});
