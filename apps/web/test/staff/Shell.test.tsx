import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { api } from "../../src/lib/api";
import { mockFetch, renderApp, err, reply, staffOf, sockets } from "./harness";

const railNames = async (label = "Staff") => {
  const nav = await screen.findByRole("navigation", { name: label });
  return within(nav).getAllByRole("link").map((a) => a.getAttribute("aria-label"));
};

beforeEach(async () => {
  sockets.length = 0;
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Shell", () => {
  it("the kitchen role sees only the Kitchen rail item", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("kitchen") });
    renderApp("/staff/kitchen");
    expect(await railNames()).toEqual(["Kitchen"]);
    expect(screen.getByRole("link", { name: "Kitchen" }).getAttribute("aria-current")).toBe("page");
  });

  it("the manager sees every rail item", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager") });
    renderApp("/staff/menu");
    expect(await railNames()).toEqual(["Kitchen", "Bar", "Floor", "Menu", "Tables", "Floor plan", "Sales", "Staff", "Schedule", "Timesheets", "Expenses", "My shifts"]);
  });

  it("the waiter sees the Floor and My shifts", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("waiter", "Deniz") });
    renderApp("/staff/floor");
    expect(await railNames()).toEqual(["Floor", "My shifts"]);
  });

  it("rail items and the avatar menu follow the language", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("manager") });
    const user = userEvent.setup();
    renderApp("/staff/menu");
    await railNames();
    const avatar = screen.getByRole("button", { name: /Selin Kaya/ });
    expect(avatar.textContent).toBe("SK");
    await user.click(avatar);
    await user.click(screen.getByRole("button", { name: "Türkçe" }));
    expect(await railNames("Personel")).toEqual(["Mutfak", "Bar", "Salon", "Menü", "Masalar", "Kat planı", "Satış", "Personel", "Vardiya planı", "Mesai kayıtları", "Giderler", "Vardiyalarım"]);
  });

  it("sends a role to its own screen when it opens another role's page", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("kitchen") });
    const { router } = renderApp("/staff/menu");
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/kitchen"));
  });

  it("signs out from the avatar menu", async () => {
    let signedIn = true;
    const { calls } = mockFetch({
      "GET /api/auth/me": () => (signedIn ? { status: 200, body: staffOf("kitchen") } : reply(401, "unauthorized")),
      "GET /api/auth/staff": [],
      "POST /api/auth/logout": () => {
        signedIn = false;
        return { status: 200, body: { ok: true } };
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/staff/kitchen");
    await user.click(await screen.findByRole("button", { name: /Kitchen.*account/i }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
  });
});

describe("RequireStaff", () => {
  it("redirects to the login without a session", async () => {
    mockFetch({ "GET /api/auth/me": err(401, "unauthorized"), "GET /api/auth/staff": [] });
    const { router } = renderApp("/staff/kitchen");
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
  });

  it("redirects to the login when the socket reports unauthorized", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("kitchen"), "GET /api/auth/staff": [] });
    const { router } = renderApp("/staff/kitchen");
    await railNames();
    const s = sockets.at(-1)!;
    act(() => s.emit("connect_error", new Error("unauthorized")));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
  });

  it("redirects to the login when any staff query returns 401", async () => {
    mockFetch({ "GET /api/auth/me": staffOf("kitchen"), "GET /api/auth/staff": [], "GET /api/kds": err(401, "unauthorized") });
    const { router, qc } = renderApp("/staff/kitchen");
    await railNames();
    await act(() => qc.fetchQuery({ queryKey: ["kds"], queryFn: () => api("/api/kds") }).catch(() => undefined));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"));
  });
});
