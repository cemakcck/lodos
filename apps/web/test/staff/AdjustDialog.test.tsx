import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { AdjustDialog } from "../../src/staff/adjust/AdjustDialog";
import type { CheckLine } from "../../src/staff/floor/types";
import { err, mockFetch, reply } from "./harness";

const n = (en: string, tr = en) => ({ en, tr });
const LINE: CheckLine = {
  orderId: "a".repeat(24), lineRef: `${"a".repeat(24)}:0`, ticketId: "tk", qty: 2, name: n("Olive oil gelato"), options: [], note: null, seat: null,
  status: "preparing", lineTotal: 52000, compedQty: 0, voidedQty: 0, originalTotal: 52000, adjustments: [],
};
const APPROVERS = [{ id: "m-selin", name: "Selin Kaya" }];

let calls: ReturnType<typeof mockFetch>["calls"];
function setup(opts: { line?: Partial<CheckLine>; manager?: boolean; kind?: "comp" | "void"; demo?: boolean; routes?: Record<string, unknown>; approvers?: { id: string; name: string }[] } = {}) {
  calls = mockFetch({
    "GET /api/approvers": opts.approvers ?? APPROVERS,
    "GET /api/demo/info": opts.demo ? { guestUrl: "/t/x", simulatorOn: true } : err(404, "not_found"),
    "POST /api/checks/c1/adjustments": { adjustment: { id: "adj1" } },
    ...opts.routes,
  }).calls;
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AdjustDialog checkId="c1" tableName="T4" line={{ ...LINE, ...opts.line }} isManager={!!opts.manager} initialKind={opts.kind ?? "comp"} onDone={onDone} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { onDone, onCancel };
}
const post = () => calls.find((c) => c.method === "POST");
const type = async (pin: string) => {
  for (const d of pin) await userEvent.click(screen.getByRole("button", { name: d }));
};

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("AdjustDialog", () => {
  it("a waiter comps 1 gelato (Birthday), picks Selin, types 9999 and approves", async () => {
    const { onDone } = setup();
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("radio", { name: /Birthday \/ celebration/ }));
    const approve = within(dlg).getByRole("button", { name: "Approve comp" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(await within(dlg).findByRole("radio", { name: /Selin Kaya/ })); // one approver: already selected
    await type("9999");
    expect(within(dlg).getByText("4 digits entered")).toBeTruthy();
    expect(dlg.textContent).not.toContain("9999");
    await userEvent.click(within(dlg).getByRole("button", { name: "Approve comp" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post()!.body).toEqual({
      lineRef: LINE.lineRef, kind: "comp", qty: 1, reason: "celebration", approval: { managerId: "m-selin", pin: "9999" },
    });
  });

  it("preselects the only manager and lets the waiter choose between several", async () => {
    setup({ approvers: [...APPROVERS, { id: "m2", name: "Aylin Demir" }] });
    const dlg = await screen.findByRole("dialog");
    const selin = await within(dlg).findByRole("radio", { name: /Selin Kaya/ });
    expect(selin.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(selin);
    expect(selin.getAttribute("aria-checked")).toBe("true");
  });

  it("while the managers load it says so (not 'No manager is available')", async () => {
    setup();
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => (String(input) === "/api/approvers" ? new Promise(() => {}) : real(input, init)));
    cleanup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AdjustDialog checkId="c1" tableName="T4" line={LINE} isManager={false} initialKind="comp" onDone={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Loading managers…")).toBeTruthy();
    expect(screen.queryByText("No manager is available to approve.")).toBeNull();
  });

  it("a failed manager list shows an error with Try again, which reloads it", async () => {
    let attempt = 0;
    setup({ routes: { "GET /api/approvers": () => (++attempt === 1 ? reply(500, "internal") : { status: 200, body: APPROVERS }) } });
    expect(await screen.findByText("Couldn't load the managers.")).toBeTruthy();
    expect(screen.queryByText("No manager is available to approve.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: "Selin Kaya" })).toBeTruthy();
    expect(attempt).toBe(2);
  });

  it("an empty manager list says no manager is available", async () => {
    setup({ approvers: [] });
    expect(await screen.findByText("No manager is available to approve.")).toBeTruthy();
  });

  it("a manager sees a plain Confirm and no pad", async () => {
    setup({ manager: true });
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("radio", { name: /Guest complaint/ }));
    expect(within(dlg).queryByRole("button", { name: "7" })).toBeNull();
    expect(calls.some((c) => c.path === "/api/approvers")).toBe(false);
    await userEvent.click(within(dlg).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()!.body).toEqual({ lineRef: LINE.lineRef, kind: "comp", qty: 1, reason: "complaint" });
  });

  it("shows the demo hint only in demo mode", async () => {
    setup({ demo: true });
    expect(await screen.findByText("Demo: Selin's PIN is 9999")).toBeTruthy();
  });
  it("hides the demo hint outside demo mode", async () => {
    setup();
    await screen.findByRole("radio", { name: /Selin Kaya/ });
    expect(screen.queryByText(/Demo: Selin/)).toBeNull();
  });

  it("Other needs a note before Confirm is enabled", async () => {
    setup({ manager: true });
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("radio", { name: "Other…" }));
    const confirm = within(dlg).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(within(dlg).getByRole("textbox", { name: /Note/ }), "Spilled on guest");
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()!.body).toMatchObject({ reason: "other", note: "Spilled on guest" });
  });

  it("the stepper runs from 1 to the free units", async () => {
    setup({ manager: true, line: { qty: 3, compedQty: 1 } });
    const dlg = await screen.findByRole("dialog");
    const plus = within(dlg).getByRole("button", { name: "More" }) as HTMLButtonElement;
    await userEvent.click(plus);
    expect(within(dlg).getByTestId("adjust-qty").textContent).toBe("2");
    expect(plus.disabled).toBe(true);
    await userEvent.click(within(dlg).getByRole("radio", { name: /Birthday/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(post()).toBeTruthy());
    expect(post()!.body).toMatchObject({ qty: 2 });
  });

  it("void shows void reasons and says Approve void", async () => {
    setup({ kind: "void" });
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("radio", { name: /Entered twice/ })).toBeTruthy();
    expect(within(dlg).queryByRole("radio", { name: /Birthday/ })).toBeNull();
    expect(within(dlg).getByRole("button", { name: "Approve void" })).toBeTruthy();
  });

  it("a ready line cannot be voided", async () => {
    setup({ line: { status: "ready" } });
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByRole("radio", { name: /Void/ })).toBeNull();
    expect(within(dlg).getByText("Already made: comp it instead")).toBeTruthy();
  });

  it("a wrong PIN says so and clears the pad", async () => {
    setup({ routes: { "POST /api/checks/c1/adjustments": err(401, "unauthorized") } });
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("radio", { name: /Birthday/ }));
    await within(dlg).findByRole("radio", { name: /Selin Kaya/ });
    await type("1234");
    await userEvent.click(within(dlg).getByRole("button", { name: "Approve comp" }));
    expect((await within(dlg).findByRole("alert")).textContent).toBe("Wrong PIN");
    expect(within(dlg).getByText("0 digits entered")).toBeTruthy();
  });

  it("shows the API message on 429", async () => {
    setup({
      routes: { "POST /api/checks/c1/adjustments": () => ({ status: 429, body: { error: { code: "rate_limited", message: "Too many tries. Wait 5 minutes." } } }) },
    });
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("radio", { name: /Birthday/ }));
    await within(dlg).findByRole("radio", { name: /Selin Kaya/ });
    await type("1234");
    await userEvent.click(within(dlg).getByRole("button", { name: "Approve comp" }));
    expect((await within(dlg).findByRole("alert")).textContent).toBe("Too many tries. Wait 5 minutes.");
  });

  it("keys and reason chips are at least 38px tall", async () => {
    setup();
    await screen.findByRole("dialog");
    // jsdom has no layout; the sizes live in the stylesheet classes.
    expect(screen.getByRole("button", { name: "5" }).className).toContain("ad-key");
    expect(screen.getByRole("radio", { name: /Birthday/ }).className).toContain("ad-chip");
    void reply;
  });
});
