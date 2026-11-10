import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import i18n from "../src/i18n";
import { useFormat } from "../src/lib/format";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("useFormat", () => {
  it("formats money per language", async () => {
    const { result } = renderHook(() => useFormat());
    expect(result.current.money(164000)).toBe("₺1,640");
    await act(() => i18n.changeLanguage("tr"));
    expect(result.current.money(164000)).toBe("₺1.640");
  });

  it("formats elapsed and Istanbul clock", () => {
    const { result } = renderHook(() => useFormat());
    expect(result.current.elapsed(125000)).toBe("02:05");
    expect(result.current.clock(new Date("2026-01-01T09:30:15Z"))).toBe("12:30");
    expect(result.current.clockSeconds(new Date("2026-01-01T09:30:15Z"))).toBe("12:30:15");
  });
});
