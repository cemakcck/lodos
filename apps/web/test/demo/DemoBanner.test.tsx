import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { toQrSvg } from "../../src/lib/qr";
import { mockFetch, renderApp, staffOf, err } from "../staff/harness";

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

const demoRoutes = (extra: Record<string, unknown> = {}) => ({
  "GET /api/demo/info": { guestUrl: "/t/tok7", simulatorOn: true },
  "GET /api/auth/me": staffOf("kitchen"),
  "POST /api/demo/simulator": (b: unknown) => ({ status: 200, body: { simulatorOn: (b as { on: boolean }).on } }),
  ...extra,
});

describe("DemoBanner", () => {
  it("shows on staff pages in demo mode, and the simulator toggle calls the API", async () => {
    const { calls } = mockFetch(demoRoutes());
    const user = userEvent.setup();
    renderApp("/staff/kitchen");
    const banner = await screen.findByRole("region", { name: "Demo restaurant, not real" });
    const toggle = within(banner).getByRole("switch", { name: /Live orders from other tables/ });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.textContent).toMatch(/on/);
    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(toggle.textContent).toMatch(/off/);
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/demo/simulator");
    expect(post!.body).toEqual({ on: false });
  });

  it("the phone popover renders an SVG QR code of the absolute guest URL", async () => {
    mockFetch(demoRoutes());
    const user = userEvent.setup();
    renderApp("/staff/kitchen");
    await user.click(await screen.findByRole("button", { name: "Scan to order from your phone" }));
    const dialog = await screen.findByRole("dialog", { name: /Order from your phone/ });
    const url = `${window.location.origin}/t/tok7`;
    const svg = await waitFor(() => {
      const el = dialog.querySelector("svg[data-qr]");
      expect(el).toBeTruthy();
      return el!;
    });
    const expected = new DOMParser().parseFromString(await toQrSvg(url), "image/svg+xml").documentElement;
    expect(svg.querySelector("path:last-of-type")!.getAttribute("d")).toBe(expected.querySelector("path:last-of-type")!.getAttribute("d"));
    expect(svg.getAttribute("aria-label")).toContain(url);
    expect(within(dialog).getByText(url)).toBeTruthy();
    // jsdom runs on localhost: the hint explains why a phone can't open it.
    expect(within(dialog).getByText(/This is localhost/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("role buttons switch the sandbox session and navigate", async () => {
    let role = "kitchen";
    const { calls } = mockFetch(
      demoRoutes({
        "GET /api/auth/me": () => ({ status: 200, body: staffOf(role as "kitchen") }),
        "POST /api/demo/session": (b: unknown) => {
          role = (b as { role: string }).role;
          return { status: 200, body: { redirect: "/staff/bar" } };
        },
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp("/staff/kitchen");
    const banner = await screen.findByRole("region", { name: "Demo restaurant, not real" });
    await user.click(within(banner).getByRole("button", { name: "Bar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/bar"));
    expect(calls.find((c) => c.path === "/api/demo/session")!.body).toEqual({ role: "bar" });
  });

  it("shows on guest pages too, in Turkish when chosen", async () => {
    await setLanguage("tr");
    mockFetch(demoRoutes({ "GET /api/guest/table": err(404, "not_found") }));
    renderApp("/t/tok7");
    expect(await screen.findByRole("region", { name: "Demo restoran, gerçek değil" })).toBeTruthy();
  });

  it("is absent in live mode", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("kitchen") });
    renderApp("/staff/kitchen");
    await screen.findByRole("navigation", { name: "Staff" });
    expect(screen.queryByRole("region", { name: "Demo restaurant, not real" })).toBeNull();
  });
});
