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

  it("uses the reviewed Turkish wording for the cart stepper, the 86 switch and the phone QR", async () => {
    await setLanguage("tr");
    expect(i18n.t("guest.cart.decrease", { name: "Burrata" })).toBe("Burrata adedini azalt");
    expect(i18n.t("manager.avail.switch", { name: "Burrata" })).toBe("Burrata: bu akşam tükendi olarak işaretle");
    expect(i18n.t("demo.phone.button")).toBe("Telefonunuzdan sipariş vermek için okutun");
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
      ["kds"], ["floor"], ["check", "t1"], ["guest", "orders"], ["split"],
    ]);
  });
  it("maps check.updated (the overview follows it too)", () => {
    expect(invalidationsFor({ type: "check.updated", ids: [], tableId: "t1", at })).toEqual([
      ["floor"], ["check", "t1"], ["guest", "orders"], ["guest", "table"], ["split"], ["overview"],
    ]);
  });
  it("maps split and adjustment events to the split, the floor and the table's check", () => {
    expect(invalidationsFor({ type: "split.updated", ids: ["c1"], tableId: "t1", at })).toEqual([["split"], ["floor"], ["check", "t1"]]);
    expect(invalidationsFor({ type: "adjustment.changed", ids: ["a1"], tableId: "t1", at })).toEqual([["split"], ["floor"], ["check", "t1"]]);
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
  it("maps layout.saved so waiter floors refetch the new layout", () => {
    expect(invalidationsFor({ type: "layout.saved", ids: ["salon"], at })).toEqual([["floor"], ["manager"]]);
  });
  it("ignores unknown events", () => {
    expect(invalidationsFor({ type: "nope", ids: [], at })).toEqual([]);
  });
});
