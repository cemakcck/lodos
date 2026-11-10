import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("socket.io-client", async () => (await import("../guest/fakeSocket")).socketModule);

import { setLanguage } from "../../src/i18n";
import { mockFetch, renderApp, err, reply } from "./harness";

const staffList = [
  { id: "s-bar", name: "Bar", role: "bar" },
  { id: "s-deniz", name: "Deniz", role: "waiter" },
  { id: "s-selin", name: "Selin", role: "manager" },
];

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Login", () => {
  it("submits a PIN typed on the physical keyboard and lands on the role's screen", async () => {
    let signedIn = false;
    const { calls } = mockFetch({
      "GET /api/auth/me": () => (signedIn ? { status: 200, body: { staff: { id: "s-deniz", name: "Deniz", role: "waiter" } } } : reply(401, "unauthorized")),
      "GET /api/auth/staff": staffList,
      "POST /api/auth/pin": (b: unknown) => {
        if ((b as { pin: string }).pin !== "1111") return reply(401, "unauthorized");
        signedIn = true;
        return { status: 200, body: { staff: { id: "s-deniz", name: "Deniz", role: "waiter" } } };
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/staff/login");

    await user.click(await screen.findByRole("button", { name: /Deniz/ }));
    const heading = await screen.findByRole("heading", { name: /Enter your PIN/ });
    // The step heading takes focus for screen readers. tabindex=-1 is what staff.css keys on to hide its ring.
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");

    // A typo, corrected with Backspace, then Enter.
    await user.keyboard("12{Backspace}{Backspace}1111{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/floor"));
    const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/auth/pin");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ staffId: "s-deniz", pin: "1111" });
  });

  it("the on-screen pad has big keys and shows a wrong-PIN message", async () => {
    mockFetch({
      "GET /api/auth/me": err(401, "unauthorized"),
      "GET /api/auth/staff": staffList,
      "POST /api/auth/pin": err(401, "unauthorized"),
    });
    const user = userEvent.setup();
    renderApp("/staff/login");
    await user.click(await screen.findByRole("button", { name: /Selin/ }));
    const pad = screen.getByRole("group", { name: /PIN pad/ });
    const keys = within(pad).getAllByRole("button");
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const n of ["9", "9", "9", "8"]) await user.click(within(pad).getByRole("button", { name: n }));
    await user.click(within(pad).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Wrong PIN/)).toBeTruthy();
  });

  it("shows the lockout message on 429", async () => {
    mockFetch({
      "GET /api/auth/me": err(401, "unauthorized"),
      "GET /api/auth/staff": staffList,
      "POST /api/auth/pin": err(429, "rate_limited"),
    });
    const user = userEvent.setup();
    renderApp("/staff/login");
    await user.click(await screen.findByRole("button", { name: /Deniz/ }));
    await user.keyboard("1234{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/locked/i);
  });

  it("in demo mode offers the role buttons, so no PIN is needed", async () => {
    let role: string | null = null;
    const { calls } = mockFetch({
      "GET /api/demo/info": err(401, "unauthorized"),
      "GET /api/auth/me": () => (role ? { status: 200, body: { staff: { id: "b", name: "Bar", role } } } : reply(401, "unauthorized")),
      "GET /api/auth/staff": err(401, "unauthorized"),
      "POST /api/demo/session": (b: unknown) => {
        role = (b as { role: string }).role;
        return { status: 200, body: { redirect: "/staff/bar" } };
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp("/staff/login");
    const group = await screen.findByRole("group", { name: /try a role instantly/i });
    await user.click(within(group).getByRole("button", { name: /^Bar/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/bar"));
    expect(calls.find((c) => c.path === "/api/demo/session")!.body).toEqual({ role: "bar" });
  });
});
