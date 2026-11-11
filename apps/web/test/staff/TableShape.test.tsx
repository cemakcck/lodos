import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { TableShape } from "../../src/staff/floor/TableShape";
import type { FloorTable, TableState } from "../../src/staff/floor/types";

// Server time 21:42 Istanbul; T12 was seated 1 h 12 min before.
const NOW = new Date("2026-11-10T18:42:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const table = (over: Partial<FloorTable> = {}): FloorTable => ({
  id: "t12",
  name: "T12",
  roomId: "salon",
  shape: "round",
  x: 400,
  y: 162,
  w: 88,
  h: 88,
  capacity: 4,
  sectionStaffId: "mert",
  serverStaffId: "mert",
  serverInitials: "M",
  state: "ready",
  covers: 4,
  seatedAt: ago(72),
  checkId: "c12",
  paying: null,
  ...over,
});

function draw(t: FloorTable, props: Partial<Parameters<typeof TableShape>[0]> = {}) {
  const onSelect = vi.fn();
  render(<TableShape table={t} now={NOW} scale={1} selected={false} mine={false} dimmed={false} onSelect={onSelect} {...props} />);
  return onSelect;
}

afterEach(async () => {
  cleanup();
  await setLanguage("en");
});

describe("TableShape", () => {
  const cases: [TableState, string][] = [
    ["seated", "T12, seated, 4 covers, 1 hour 12 minutes"],
    ["ready", "T12, food ready, 4 covers, 1 hour 12 minutes"],
    ["calling", "T12, calling, 4 covers, 1 hour 12 minutes"],
    ["bill", "T12, wants the bill, 4 covers, 1 hour 12 minutes"],
  ];
  it.each(cases)("puts the %s state word in the accessible name", (state, name) => {
    draw(table({ state }));
    const btn = screen.getByRole("button", { name });
    expect(btn.className).toContain(`is-${state}`);
    // Visible: the name and "covers · elapsed" in the compact form.
    expect(btn.textContent).toContain("T12");
    expect(btn.textContent).toContain("4 · 1h 12m");
  });

  it("a free table says free and its seats, with no elapsed time", () => {
    draw(table({ state: "free", covers: null, seatedAt: null, checkId: null, name: "T5", capacity: 2 }));
    const btn = screen.getByRole("button", { name: "T5, free, seats 2" });
    expect(btn.className).toContain("is-free");
    // On screen: the name and the seats; the spoken state is screen-reader only.
    expect(btn.querySelector(".no")?.firstChild?.textContent).toBe("T5");
    expect(btn.querySelector(".m")?.textContent).toBe("2");
  });

  it("short visits read in minutes, and a QR check without covers says so", () => {
    draw(table({ state: "seated", covers: null, seatedAt: ago(6), name: "B5", shape: "rect" }));
    const btn = screen.getByRole("button", { name: "B5, seated, covers not set, 6 minutes" });
    expect(btn.textContent).toContain("– · 06m");
  });

  it("marks selection with aria-pressed, my section in the name, and calls onSelect", async () => {
    const onSelect = draw(table(), { selected: true, mine: true });
    const btn = screen.getByRole("button", { name: "T12, food ready, 4 covers, 1 hour 12 minutes, your section" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("is-mine");
    await userEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("t12");
  });

  it("places and sizes the table from the API layout times the scale", () => {
    draw(table({ x: 100, y: 50, w: 92, h: 52, shape: "rect" }), { scale: 1.5 });
    const btn = screen.getByRole("button");
    expect(btn.style.left).toBe("150px");
    expect(btn.style.top).toBe("75px");
    expect(btn.style.width).toBe("138px");
    expect(btn.style.height).toBe("78px");
  });

  it("speaks Turkish", async () => {
    await setLanguage("tr");
    draw(table());
    expect(screen.getByRole("button", { name: "T12, yemek hazır, 4 kişi, 1 saat 12 dakika" })).toBeTruthy();
  });
});
