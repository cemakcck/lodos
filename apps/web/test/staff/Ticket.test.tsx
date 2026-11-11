import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { Ticket, type TicketProps } from "../../src/staff/kds/Ticket";
import type { KdsTicket } from "../../src/staff/kds/types";

const SENT = new Date("2026-11-10T18:25:00.000Z"); // 21:25 Istanbul
const at = (min: number, sec = 0) => new Date(SENT.getTime() + min * 60_000 + sec * 1000);
const thresholds = { warnMin: 8, lateMin: 15 };

const n = (en: string, tr: string) => ({ en, tr });
const ticket = (over: Partial<KdsTicket> = {}): KdsTicket => ({
  id: "tk1",
  orderId: "o1",
  tableId: "t12",
  tableName: "T12",
  station: "kitchen",
  status: "new",
  serverName: "Deniz",
  covers: 4,
  sentAt: SENT.toISOString(),
  startedAt: null,
  readyAt: null,
  servedAt: null,
  ageState: "ok",
  items: [
    { index: 0, name: n("Levrek crudo", "Levrek crudo"), qty: 2, options: [], note: null, allergens: [], allergyFlag: false, checked: false, voidedQty: 0 },
    {
      index: 1,
      name: n("Dry-aged ribeye", "Dinlendirilmiş antrikot"),
      qty: 1,
      options: [n("Medium rare", "Orta az pişmiş")],
      note: null,
      allergens: [],
      allergyFlag: false,
      checked: false,
      voidedQty: 0,
    },
  ],
  ...over,
});

const noop = () => {};
const renderTicket = (t: KdsTicket, now: Date, handlers: Partial<Pick<TicketProps, "onBump" | "onHold" | "onToggle">> = {}) =>
  render(<Ticket ticket={t} now={now} thresholds={thresholds} onBump={noop} onHold={noop} onToggle={noop} {...handlers} />);

afterEach(async () => {
  cleanup();
  await setLanguage("en");
});

describe("Ticket", () => {
  it("shows the table, server, covers, sent time and a neutral timer before the warn threshold", () => {
    renderTicket(ticket(), at(4, 12));
    const card = screen.getByRole("article", { name: /Ticket T12/ });
    expect(card.textContent).toContain("T12");
    expect(card.textContent).toContain("Deniz");
    expect(card.textContent).toContain("4 covers");
    expect(card.textContent).toContain("Sent 21:25");
    const timer = screen.getByText("04:12");
    expect(timer.className).not.toMatch(/is-warn|is-late/);
  });

  it("goes amber at 9 minutes, using the thresholds it is given", () => {
    renderTicket(ticket(), at(9));
    expect(screen.getByText("09:00").className).toMatch(/is-warn/);
    expect(screen.getByRole("article").getAttribute("data-age")).toBe("warn");
  });

  it("goes late at 16 minutes: late style and 'late' in the accessible name", () => {
    renderTicket(ticket(), at(16, 20));
    const card = screen.getByRole("article", { name: "Ticket T12, late, 16 minutes 20 seconds" });
    expect(card.getAttribute("data-age")).toBe("late");
    expect(screen.getByText("16:20").className).toMatch(/is-late/);
  });

  it("follows custom thresholds instead of 8/15", () => {
    render(
      <Ticket ticket={ticket()} now={at(6)} thresholds={{ warnMin: 3, lateMin: 5 }} onBump={noop} onHold={noop} onToggle={noop} />,
    );
    expect(screen.getByRole("article").getAttribute("data-age")).toBe("late");
  });

  it("shows the red allergy chip with the guest's words when the note mentions an allergy", () => {
    const t = ticket();
    t.items[1] = { ...t.items[1]!, note: "fıstık alerjisi", allergyFlag: true };
    const { container } = renderTicket(t, at(1));
    const chip = container.querySelector(".alg")!;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("Allergy fıstık alerjisi");
    // the note is not repeated as a plain line
    expect(container.querySelector(".mod.note")).toBeNull();
  });

  it("lists the dish's own allergens as one quiet line, never in red", () => {
    const t = ticket();
    t.items[0] = { ...t.items[0]!, allergens: ["sesame", "milk"], allergyFlag: true };
    const { container } = renderTicket(t, at(1));
    expect(screen.getByText("Contains: sesame, milk").className).toBe("contains");
    expect(container.querySelector(".alg")).toBeNull();
  });

  it("an ordinary note is a plain line with no chip", () => {
    const t = ticket();
    t.items[0] = { ...t.items[0]!, note: "Sauce on the side" };
    const { container } = renderTicket(t, at(1));
    expect(screen.getByText("Sauce on the side").className).toContain("note");
    expect(container.querySelector(".alg")).toBeNull();
  });

  it("keeps numbers with their units so a name never ends on an orphaned unit", () => {
    const t = ticket();
    t.items[1] = { ...t.items[1]!, name: n("Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g") };
    renderTicket(t, at(1));
    expect(screen.getByText("Dry-aged ribeye, 300\u00a0g", { normalizer: (x) => x })).toBeTruthy();
  });

  it("masks profanity in the note", () => {
    const t = ticket();
    t.items[0] = { ...t.items[0]!, note: "no shit onions" };
    renderTicket(t, at(1));
    expect(screen.getByText("no ••• onions")).toBeTruthy();
  });

  it("Bump calls onBump and Hold calls onHold", async () => {
    const onBump = vi.fn();
    const onHold = vi.fn();
    const user = userEvent.setup();
    renderTicket(ticket(), at(2), { onBump, onHold });
    await user.click(screen.getByRole("button", { name: "Bump T12" }));
    expect(onBump).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Hold T12" }));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("tapping an item row calls onToggle with its index", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderTicket(ticket(), at(2), { onToggle });
    await user.click(screen.getByText("Dry-aged ribeye"));
    expect(onToggle).toHaveBeenCalledWith(1);
    expect(screen.getAllByRole("checkbox")[1]!.getAttribute("aria-checked")).toBe("false");
  });

  it("tags a ticket New and 'QR order' in its first minute", () => {
    renderTicket(ticket({ serverName: null }), at(0, 24));
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("QR order")).toBeTruthy();
    renderTicket(ticket({ id: "tk2", tableName: "B2" }), at(1, 5));
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("shows a done ticket's cook time in a neutral style, without actions", () => {
    renderTicket(ticket({ status: "ready", readyAt: at(17, 20).toISOString() }), at(40));
    const card = screen.getByRole("article", { name: "Ticket T12, ready in 17 minutes 20 seconds" });
    expect(card.getAttribute("data-age")).toBe("done");
    expect(screen.getByText("17:20")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bump/ })).toBeNull();
  });

  it("a fully voided line is struck through with the hidden text voided", () => {
    const t = ticket();
    t.items[0] = { ...t.items[0]!, qty: 2, voidedQty: 2 };
    renderTicket(t, at(1));
    const row = screen.getByText("Levrek crudo").closest("li")!;
    expect(row.querySelector("s")).toBeTruthy();
    expect(row.textContent).toContain("voided");
    expect(row.querySelector(".sr-only")?.textContent).toContain("voided");
  });

  it("a partly voided line shows its quantity as <s>3</s> 2", () => {
    const t = ticket();
    t.items[0] = { ...t.items[0]!, qty: 3, voidedQty: 1 };
    renderTicket(t, at(1));
    const row = screen.getByText("Levrek crudo").closest("li")!;
    expect(row.querySelector(".q s")?.textContent).toBe("3");
    expect(row.querySelector(".q")?.textContent).toContain("3 2");
    expect(row.querySelector(".q .sr-only")?.textContent).toMatch(/1 voided/);
  });

  it("speaks Turkish", async () => {
    await setLanguage("tr");
    renderTicket(ticket(), at(16, 20));
    expect(screen.getByRole("article", { name: "Fiş T12, gecikti, 16 dakika 20 saniye" })).toBeTruthy();
    expect(screen.getByText("Dinlendirilmiş antrikot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "T12 hazır" })).toBeTruthy();
    const t2 = ticket({ id: "tk3", tableName: "T3" });
    t2.items[0] = { ...t2.items[0]!, allergens: ["milk", "nuts"], note: "fındık alerjisi var" };
    cleanup();
    renderTicket(t2, at(1));
    expect(screen.getByText("İçerir: süt, sert kabuklu yemişler")).toBeTruthy();
    expect(screen.getByText("Alerji")).toBeTruthy();
  });
});
