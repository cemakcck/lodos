import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { KitchenCallout } from "../../src/demo/KitchenCallout";
import { mockFetch, renderApp, err, reply } from "../staff/harness";

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await setLanguage("en");
});

describe("DemoLanding", () => {
  it("in live mode, / redirects to the staff login", async () => {
    mockFetch({ "GET /api/auth/me": err(401, "unauthorized"), "GET /api/auth/staff": [] });
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
  });

  it("in demo mode shows the hero, the honest paragraph and five roles with hints", async () => {
    mockFetch({ "GET /api/demo/info": err(401, "unauthorized") });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: /Lodos, a restaurant system demo/ })).toBeTruthy();
    expect(screen.getByText(/portfolio project by Cem Akçiçek/)).toBeTruthy();
    const roles = screen.getAllByRole("button").filter((b) => b.hasAttribute("data-role"));
    expect(roles.map((b) => b.getAttribute("data-role"))).toEqual(["guest", "waiter", "kitchen", "bar", "manager"]);
    for (const b of roles) expect(b.querySelector("[data-hint]")?.textContent?.length).toBeGreaterThan(10);
  });

  it("a role button starts the demo and navigates to its redirect", async () => {
    const { calls } = mockFetch({
      "GET /api/demo/info": err(401, "unauthorized"),
      "POST /api/demo/session": { redirect: "/t/tok7" },
      "GET /api/guest/table": err(404, "not_found"),
    });
    const user = userEvent.setup();
    const { router } = renderApp("/");
    await user.click(await screen.findByRole("button", { name: /Guest at T7/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/tok7"));
    expect(calls.find((c) => c.path === "/api/demo/session")!.body).toEqual({ role: "guest" });
  });

  it("explains a rate limit and a busy demo in plain words", async () => {
    let next = reply(429, "rate_limited");
    mockFetch({ "GET /api/demo/info": err(401, "unauthorized"), "POST /api/demo/session": () => next });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: /Kitchen/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Too many new demos/);
    next = reply(503, "demo_busy");
    await user.click(screen.getByRole("button", { name: /Kitchen/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/demo is full/));
  });
});

describe("KitchenCallout", () => {
  it("opens the window synchronously, starts a kitchen session, then points it at the kitchen", async () => {
    const popup = { location: { href: "about:blank" }, opener: {} as unknown, close: vi.fn() };
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const { calls } = mockFetch({
      "POST /api/demo/session": () => ({ status: 200, body: { redirect: "/staff/kitchen" } }),
    });
    let postsAtOpen = -1;
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      postsAtOpen = calls.filter((c) => c.method === "POST").length;
      resolve();
      return popup as unknown as Window;
    });
    const user = userEvent.setup();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <KitchenCallout dismiss={() => {}} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Now open the kitchen screen →/ }));
    await gate;
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![1]).toBe("_blank");
    expect(postsAtOpen).toBe(0); // opened before the API call, inside the click, so popup blockers allow it
    await waitFor(() => expect(popup.location.href).toBe("/staff/kitchen"));
    expect(calls.find((c) => c.path === "/api/demo/session")!.body).toEqual({ role: "kitchen" });
  });
});
