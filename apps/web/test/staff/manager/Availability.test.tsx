import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../src/i18n";
import { setLanguage } from "../../../src/i18n";
import { Availability } from "../../../src/staff/manager/Availability";
import { managerMenuKey } from "../../../src/staff/manager/types";
import type { ItemView } from "../../../src/staff/manager/types";
import { mockFetch, reply } from "../harness";
import { burrata, menu } from "./fixtures";

let calls: ReturnType<typeof mockFetch>["calls"];

/** `held` keeps POSTs pending until released, so the optimistic state can be seen on its own. */
function setup(item: ItemView = burrata, post?: (body: unknown) => { status: number; body?: unknown }) {
  // The fake server keeps the availability it last accepted, so refetches after a save agree with it.
  let current = item.availability;
  calls = mockFetch({
    "GET /api/manager/menu": () => ({ status: 200, body: menu([{ ...item, availability: current }]) }),
    [`POST /api/manager/availability/${item.id}`]:
      post ??
      ((body: unknown) => {
        const b = body as { soldOut?: boolean; remaining?: number | null };
        const remaining = b.remaining === undefined ? (b.soldOut === false ? null : current.remaining) : b.remaining;
        const soldOut = remaining === 0 ? true : (b.soldOut ?? current.soldOut);
        current = { soldOut, remaining };
        return { status: 200, body: { itemId: item.id, serviceDay: "2026-11-10", soldOut, remaining } };
      }),
  }).calls;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(managerMenuKey, menu([item]));
  render(
    <QueryClientProvider client={qc}>
      <Availability itemId={item.id} />
    </QueryClientProvider>,
  );
  return { qc };
}

const posts = () => calls.filter((c) => c.method === "POST");
const sw = () => screen.getByRole("switch", { name: /Sold out tonight, Burrata/ });
const left = () => screen.getByRole("spinbutton", { name: /Portions left, Burrata/ }) as HTMLInputElement;

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("Availability", () => {
  it("toggling 86 posts soldOut:true and flips the switch at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setup();
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") await gate;
      return inner(i, init);
    });
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(sw().textContent).toMatch(/Available/);
    await userEvent.click(sw());
    // Optimistic: checked before the server answers.
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(sw().textContent).toMatch(/Sold out/);
    release();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.path).toBe("/api/manager/availability/burrata");
    expect(posts()[0]!.body).toEqual({ soldOut: true });
  });

  it("turning 86 off posts soldOut:false", async () => {
    setup({ ...burrata, availability: { soldOut: true, remaining: null } });
    expect(sw().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(sw());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ soldOut: false });
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it('setting "N left" to 2 posts remaining:2', async () => {
    setup();
    await userEvent.type(left(), "2{Enter}");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ remaining: 2 });
    expect(left().value).toBe("2");
  });

  it('setting "N left" on a sold-out item makes it available again', async () => {
    setup({ ...burrata, availability: { soldOut: true, remaining: null } });
    await userEvent.type(left(), "3");
    await userEvent.tab();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ soldOut: false, remaining: 3 });
    await waitFor(() => expect(sw().getAttribute("aria-checked")).toBe("false"));
  });

  it('clearing "N left" posts remaining:null', async () => {
    setup({ ...burrata, availability: { soldOut: false, remaining: 4 } });
    expect(left().value).toBe("4");
    await userEvent.clear(left());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ remaining: null });
  });

  it("does not post when the number is unchanged", async () => {
    setup({ ...burrata, availability: { soldOut: false, remaining: 4 } });
    await userEvent.click(left());
    await userEvent.tab();
    expect(posts()).toHaveLength(0);
  });

  it("rolls the switch back and says so when the server refuses", async () => {
    setup(burrata, () => reply(500, "internal"));
    await userEvent.click(sw());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it('rolls "N left" back when the server refuses', async () => {
    setup({ ...burrata, availability: { soldOut: false, remaining: 4 } }, () => reply(500, "internal"));
    await userEvent.clear(left());
    await userEvent.type(left(), "9{Enter}");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(left().value).toBe("4"));
  });

  it("is labelled in Turkish", async () => {
    await setLanguage("tr");
    setup();
    expect(screen.getByRole("switch", { name: /^Burrata.*: bu akşam tükendi olarak işaretle$/ })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: /Kalan porsiyon, Burrata/ })).toBeTruthy();
  });
});
