import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

class FakeSocket {
  connected = false;
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  off(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, (this.handlers.get(ev) ?? []).filter((f) => f !== fn));
    return this;
  }
  emit(ev: string, ...a: unknown[]) {
    if (ev === "connect") this.connected = true;
    if (ev === "disconnect") this.connected = false;
    (this.handlers.get(ev) ?? []).forEach((f) => f(...a));
  }
  close = vi.fn(() => { this.connected = false; });
  connect = vi.fn(() => this);
}

const sockets: FakeSocket[] = [];
const ioMock = vi.fn((...args: unknown[]) => {
  void args;
  const s = new FakeSocket();
  sockets.push(s);
  return s;
});
vi.mock("socket.io-client", () => ({ io: (...a: unknown[]) => ioMock(...a) }));

import { useLive } from "../src/lib/useLive";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  ioMock.mockClear();
  qc = new QueryClient();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useLive", () => {
  it("invalidates live keys and sets lastSyncAt on every connect", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useLive({ audience: "staff" }, () => {}), { wrapper });
    const s = sockets[0]!;
    expect(result.current.lastSyncAt).toBeNull();
    act(() => s.emit("connect"));
    expect(result.current.connected).toBe(true);
    expect(result.current.lastSyncAt).toBeInstanceOf(Date);
    const first = spy.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    act(() => s.emit("disconnect"));
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.connected).toBe(false);

    act(() => s.emit("connect"));
    expect(result.current.connected).toBe(true);
    expect(spy.mock.calls.length).toBe(first * 2);
  });

  it("calls onEvent and invalidates mapped keys", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const onEvent = vi.fn();
    renderHook(() => useLive({ audience: "staff" }, onEvent), { wrapper });
    const s = sockets[0]!;
    act(() => s.emit("connect"));
    spy.mockClear();
    const e = { type: "call.opened", ids: ["c"], tableId: "t9", at: "x" };
    act(() => s.emit("event", e));
    expect(onEvent).toHaveBeenCalledWith(e);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["floor"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["check", "t9"] });
  });

  it("shares one socket per audience and closes it when unused", () => {
    const a = renderHook(() => useLive({ audience: "staff" }, () => {}), { wrapper });
    const b = renderHook(() => useLive({ audience: "staff" }, () => {}), { wrapper });
    expect(ioMock).toHaveBeenCalledTimes(1);
    a.unmount();
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    b.unmount();
    expect(sockets[0]!.close).toHaveBeenCalled();
  });

  it("guest sockets pass the table token and are separate from staff", () => {
    renderHook(() => useLive({ audience: "guest", tableToken: "tok" }, () => {}), { wrapper });
    renderHook(() => useLive({ audience: "staff" }, () => {}), { wrapper });
    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock.mock.calls[0]![0]).toMatchObject({ path: "/socket.io", auth: { tableToken: "tok" } });
    expect(ioMock.mock.calls[1]![0]).toMatchObject({ withCredentials: true });
  });

  it("surfaces connect_error unauthorized as authFailed", () => {
    const { result } = renderHook(() => useLive({ audience: "staff" }), { wrapper });
    const s = sockets[0]!;
    expect(result.current.authFailed).toBe(false);
    act(() => s.emit("connect_error", new Error("xhr poll error")));
    expect(result.current.authFailed).toBe(false);
    act(() => s.emit("connect_error", new Error("unauthorized")));
    expect(result.current.authFailed).toBe(true);
  });

  it("reconnects once after a server-initiated disconnect, then reports", () => {
    const { result } = renderHook(() => useLive({ audience: "staff" }), { wrapper });
    const s = sockets[0]!;
    act(() => s.emit("connect"));
    act(() => s.emit("disconnect", "io server disconnect"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    expect(result.current.authFailed).toBe(false);
    act(() => s.emit("connect"));
    act(() => s.emit("disconnect", "io server disconnect"));
    expect(s.connect).toHaveBeenCalledTimes(1);
    expect(result.current.authFailed).toBe(true);
  });

  it("does not reconnect by hand for ordinary transport drops", () => {
    const { result } = renderHook(() => useLive({ audience: "staff" }), { wrapper });
    const s = sockets[0]!;
    act(() => s.emit("connect"));
    act(() => s.emit("disconnect", "transport close"));
    expect(s.connect).not.toHaveBeenCalled();
    expect(result.current.authFailed).toBe(false);
  });
});
