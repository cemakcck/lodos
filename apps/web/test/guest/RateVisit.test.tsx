import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { GuestContext, type GuestContextValue } from "../../src/guest/context";
import { RateVisit } from "../../src/guest/RateVisit";
import { mockFetch } from "./harness";

const rating = {
  state: "open",
  waiter: { name: "Mert" },
  dishes: [{ itemId: "ribeye", name: { en: "Dry-aged ribeye", tr: "Antrikot" } }],
};

function renderRate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx = { token: "tok" } as GuestContextValue;
  return render(
    <QueryClientProvider client={qc}>
      <GuestContext.Provider value={ctx}>
        <RateVisit checkId="c1" />
      </GuestContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("RateVisit", () => {
  it("renders the title and a star group for the waiter, each dish and the three categories", async () => {
    const { calls } = mockFetch({ "GET /api/guest/rating?checkId=c1": rating });
    renderRate();
    expect(await screen.findByRole("heading", { name: "How was your visit?" })).toBeTruthy();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
    expect(screen.getByRole("radiogroup", { name: "Your waiter, Mert" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Dry-aged ribeye" })).toBeTruthy();
    for (const n of ["Food", "Cleanliness", "Atmosphere"]) expect(screen.getByRole("radiogroup", { name: n })).toBeTruthy();
    expect(calls[0]!.headers.get("X-Table-Token")).toBe("tok");
    expect((screen.getByRole("button", { name: "Send rating" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("0 / 500")).toBeTruthy();
  });

  it("moves the selected star with the arrow keys", async () => {
    mockFetch({ "GET /api/guest/rating?checkId=c1": rating });
    renderRate();
    const user = userEvent.setup();
    const food = await screen.findByRole("radiogroup", { name: "Food" });
    await user.click(within(food).getByRole("radio", { name: "3 of 5 stars" }));
    expect(within(food).getByRole("radio", { name: "3 of 5 stars" }).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(within(food).getByRole("radio", { name: "4 of 5 stars" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(within(food).getByRole("radio", { name: "4 of 5 stars" }));
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(food).getByRole("radio", { name: "2 of 5 stars" }).getAttribute("aria-checked")).toBe("true");
  });

  it("posts the selected values only, then thanks the guest", async () => {
    const { calls } = mockFetch({
      "GET /api/guest/rating?checkId=c1": rating,
      "POST /api/guest/ratings": { status: 201, body: {} },
    });
    renderRate();
    const user = userEvent.setup();
    const food = await screen.findByRole("radiogroup", { name: "Food" });
    await user.click(within(food).getByRole("radio", { name: "5 of 5 stars" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Dry-aged ribeye" })).getByRole("radio", { name: "4 of 5 stars" }));
    await user.click(screen.getByRole("button", { name: "Send rating" }));
    expect(await screen.findByText("Thanks for your rating!")).toBeTruthy();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ checkId: "c1", food: 5, dishes: [{ itemId: "ribeye", stars: 4 }] });
    expect(post.headers.get("X-Table-Token")).toBe("tok");
  });

  it("shows the thanks message on 409 already_rated", async () => {
    mockFetch({
      "GET /api/guest/rating?checkId=c1": rating,
      "POST /api/guest/ratings": () => ({ status: 409, body: { error: { code: "already_rated", message: "x" } } }),
    });
    renderRate();
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole("radiogroup", { name: "Food" })).getByRole("radio", { name: "2 of 5 stars" }));
    await user.click(screen.getByRole("button", { name: "Send rating" }));
    expect(await screen.findByText("Thanks for your rating!")).toBeTruthy();
  });

  it("shows nothing for a closed rating and thanks for a done one", async () => {
    mockFetch({ "GET /api/guest/rating?checkId=c1": { state: "closed", waiter: null, dishes: [] } });
    const { container } = renderRate();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    cleanup();
    mockFetch({ "GET /api/guest/rating?checkId=c1": { state: "done", waiter: null, dishes: [] } });
    renderRate();
    expect(await screen.findByText("Thanks for your rating!")).toBeTruthy();
  });

  it("uses the Turkish category labels and dish names", async () => {
    mockFetch({ "GET /api/guest/rating?checkId=c1": rating });
    await setLanguage("tr");
    renderRate();
    expect(await screen.findByRole("heading", { name: "Ziyaretiniz nasıldı?" })).toBeTruthy();
    for (const n of ["Yemek", "Temizlik", "Atmosfer", "Antrikot"]) expect(screen.getByRole("radiogroup", { name: n })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    mockFetch({ "GET /api/guest/rating?checkId=c1": rating });
    const { container } = renderRate();
    await screen.findByRole("heading", { name: "How was your visit?" });
    // jsdom has no layout or paint, so colour contrast is covered by the Playwright axe run instead.
    const { violations } = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
