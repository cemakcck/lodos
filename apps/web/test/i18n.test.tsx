import { describe, it, expect, afterEach } from "vitest";
import i18n, { setLanguage, detectLanguage } from "../src/i18n";
import en from "../src/i18n/en.json";
import tr from "../src/i18n/tr.json";
import { invalidationsFor } from "../src/lib/useLive";

function flat(o: Record<string, unknown>, p = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
  );
}

afterEach(async () => {
  localStorage.clear();
  await setLanguage("en");
});

describe("i18n", () => {
  it("syncs <html lang> on language change", async () => {
    await setLanguage("tr");
    expect(document.documentElement.lang).toBe("tr");
    expect(localStorage.getItem("lodos.lang")).toBe("tr");
    expect(i18n.t("app.name")).toBe("Lodos");
    await setLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("detects from localStorage then navigator", () => {
    localStorage.setItem("lodos.lang", "tr");
    expect(detectLanguage()).toBe("tr");
    localStorage.clear();
    expect(detectLanguage("tr-TR")).toBe("tr");
    expect(detectLanguage("de-DE")).toBe("en");
  });

  it("has key parity in both directions", () => {
    const a = flat(en).sort();
    const b = flat(tr).sort();
    expect(b).toEqual(a);
  });

  it("has an error message per API error code", () => {
    for (const c of ["validation", "unauthorized", "forbidden", "not_found", "sold_out", "item_unavailable",
      "check_closed", "rate_limited", "limit_exceeded", "conflict", "demo_busy", "internal"]) {
      expect(flat(en)).toContain(`errors.${c}`);
    }
  });
});

describe("invalidationsFor", () => {
  const at = "2026-01-01T00:00:00Z";
  it("maps ticket events", () => {
    expect(invalidationsFor({ type: "ticket.created", ids: ["a"], tableId: "t1", at })).toEqual([
      ["kds"], ["floor"], ["check", "t1"], ["guest", "orders"],
    ]);
  });
  it("maps check.updated", () => {
    expect(invalidationsFor({ type: "check.updated", ids: [], tableId: "t1", at })).toEqual([
      ["floor"], ["check", "t1"], ["guest", "orders"], ["guest", "table"],
    ]);
  });
  it("maps call events", () => {
    expect(invalidationsFor({ type: "call.opened", ids: [], tableId: "t2", at })).toEqual([["floor"], ["check", "t2"]]);
  });
  it("maps menu and availability", () => {
    const k = [["guest", "menu"], ["menu"], ["kds"], ["manager"]];
    expect(invalidationsFor({ type: "menu.changed", ids: [], at })).toEqual(k);
    expect(invalidationsFor({ type: "availability.changed", ids: [], at })).toEqual(k);
  });
  it("maps tables.changed and drops check key without tableId", () => {
    expect(invalidationsFor({ type: "tables.changed", ids: [], at })).toEqual([["floor"], ["manager"]]);
    expect(invalidationsFor({ type: "call.answered", ids: [], at })).toEqual([["floor"]]);
  });
  it("ignores unknown events", () => {
    expect(invalidationsFor({ type: "nope", ids: [], at })).toEqual([]);
  });
});
