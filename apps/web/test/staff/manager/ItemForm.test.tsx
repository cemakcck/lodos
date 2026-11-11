import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../src/i18n";
import { setLanguage } from "../../../src/i18n";
import { ItemForm } from "../../../src/staff/manager/ItemForm";
import type { ItemView } from "../../../src/staff/manager/types";
import { mockFetch, reply } from "../harness";
import { burrata, categories, ribeye } from "./fixtures";

let calls: ReturnType<typeof mockFetch>["calls"];
const saved = vi.fn();
const closed = vi.fn();

function setup(item: ItemView | null, routes: Record<string, unknown> = {}) {
  calls = mockFetch({
    "POST /api/manager/items": (body: unknown) => ({ status: 201, body: { ...burrata, ...(body as object), id: "new1" } }),
    [`PATCH /api/manager/items/${item?.id}`]: (body: unknown) => ({ status: 200, body: { ...item, ...(body as object) } }),
    ...routes,
  }).calls;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ItemForm item={item} categories={categories} defaultCategoryId="share" onSaved={saved} onClose={closed} />
    </QueryClientProvider>,
  );
  return { qc };
}

const box = (name: string | RegExp, scope: HTMLElement = document.body) => within(scope).getByRole("textbox", { name });

async function fillBasics(opts: { tr?: string; price?: string } = {}) {
  await userEvent.type(box("Name (English)"), "Charred leeks");
  if (opts.tr !== "") await userEvent.type(box("Name (Turkish)"), opts.tr ?? "Közlenmiş pırasa");
  await userEvent.type(box("Description (English)"), "Leeks from the coals, hazelnut.");
  await userEvent.type(box("Description (Turkish)"), "Közde pırasa, fındık.");
  await userEvent.type(box("Price"), opts.price ?? "640");
}

/** The text of everything an element's aria-describedby points at. */
const described = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");

const posts = () => calls.filter((c) => c.method === "POST" && c.path === "/api/manager/items");

beforeEach(async () => {
  saved.mockReset();
  closed.mockReset();
  await setLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await setLanguage("en");
});

describe("ItemForm", () => {
  it('saves a price typed as "640" lira as 64000 kuruş', async () => {
    setup(null);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = posts()[0]!.body as Record<string, unknown>;
    expect(body.price).toBe(64000);
    expect(body).toMatchObject({
      categoryId: "share",
      name: { en: "Charred leeks", tr: "Közlenmiş pırasa" },
      station: "kitchen",
      active: true,
      optionGroups: [],
    });
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  });

  it('accepts "640,50" as 64050 kuruş', async () => {
    setup(null);
    await fillBasics({ price: "640,50" });
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0]!.body as { price: number }).price).toBe(64050);
  });

  it("shows a field error for a missing Turkish name and does not submit", async () => {
    setup(null);
    await fillBasics({ tr: "" });
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    const tr = box("Name (Turkish)");
    await waitFor(() => expect(tr.getAttribute("aria-invalid")).toBe("true"));
    expect(described(tr)).toMatch(/Required/);
    expect(box("Name (English)").getAttribute("aria-invalid")).not.toBe("true");
    expect(posts()).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });

  it("shows a price error for text that is not an amount", async () => {
    setup(null);
    await fillBasics({ price: "abc" });
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    const price = box("Price");
    await waitFor(() => expect(price.getAttribute("aria-invalid")).toBe("true"));
    expect(described(price)).toMatch(/Enter a price like 640/);
    expect(posts()).toHaveLength(0);
  });

  it("adds a required single-choice group with two options to the payload, without ids", async () => {
    setup(null);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Add option group" }));
    const group = screen.getByRole("group", { name: "Option group 1" });
    await userEvent.type(box("Group name (English)", group), "Doneness");
    await userEvent.type(box("Group name (Turkish)", group), "Pişirme");
    await userEvent.click(within(group).getByRole("radio", { name: /Pick one/ }));
    await userEvent.click(within(group).getByRole("checkbox", { name: "Required" }));
    await userEvent.click(within(group).getByRole("button", { name: "Add option" }));
    await userEvent.click(within(group).getByRole("button", { name: "Add option" }));
    const o1 = within(group).getByRole("group", { name: "Option 1" });
    const o2 = within(group).getByRole("group", { name: "Option 2" });
    await userEvent.type(box("Option name (English)", o1), "Rare");
    await userEvent.type(box("Option name (Turkish)", o1), "Az pişmiş");
    await userEvent.type(box("Option name (English)", o2), "Well done");
    await userEvent.type(box("Option name (Turkish)", o2), "İyi pişmiş");
    await userEvent.type(box(/^Price change/, o2), "50");
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0]!.body as { optionGroups: unknown }).optionGroups).toEqual([
      {
        name: { en: "Doneness", tr: "Pişirme" },
        type: "single",
        required: true,
        options: [
          { name: { en: "Rare", tr: "Az pişmiş" }, priceDelta: 0 },
          { name: { en: "Well done", tr: "İyi pişmiş" }, priceDelta: 5000 },
        ],
      },
    ]);
  });

  it("flags an option group with an empty Turkish option name at the field", async () => {
    setup(null);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Add option group" }));
    const group = screen.getByRole("group", { name: "Option group 1" });
    await userEvent.type(box("Group name (English)", group), "Size");
    await userEvent.type(box("Group name (Turkish)", group), "Boy");
    await userEvent.click(within(group).getByRole("button", { name: "Add option" }));
    await userEvent.type(box("Option name (English)", group), "Large");
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    const trOpt = box("Option name (Turkish)", group);
    await waitFor(() => expect(trOpt.getAttribute("aria-invalid")).toBe("true"));
    expect(posts()).toHaveLength(0);
  });

  it("editing echoes the existing group and option ids so they stay stable, and PATCHes the item", async () => {
    setup(ribeye);
    expect(box("Name (English)")).toHaveProperty("value", "Dry-aged ribeye, 300 g");
    expect(box("Price")).toHaveProperty("value", "2450");
    const group = screen.getByRole("group", { name: "Option group 1" });
    await userEvent.click(within(group).getByRole("button", { name: "Add option" }));
    const o3 = within(group).getByRole("group", { name: "Option 3" });
    await userEvent.type(box("Option name (English)", o3), "Well done");
    await userEvent.type(box("Option name (Turkish)", o3), "İyi pişmiş");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const patch = await waitFor(() => {
      const c = calls.find((x) => x.method === "PATCH");
      expect(c).toBeTruthy();
      return c!;
    });
    expect(patch.path).toBe("/api/manager/items/ribeye");
    const groups = (patch.body as { optionGroups: { id?: string; options: { id?: string }[] }[] }).optionGroups;
    expect(groups[0]!.id).toBe("g-done");
    expect(groups[0]!.options.map((o) => o.id)).toEqual(["o-rare", "o-mr", undefined]);
    expect((patch.body as { price: number }).price).toBe(245000);
  });

  it("rejects a photo over 2 MB or of the wrong type before uploading", async () => {
    setup(burrata);
    const input = screen.getByLabelText("Photo", { selector: "input" }) as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    await userEvent.upload(input, big);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described(input)).toMatch(/over 2 MB/);
    const gif = new File([new Uint8Array(10)], "a.gif", { type: "image/gif" });
    await userEvent.upload(input, gif, { applyAccept: false });
    expect(screen.getByText(/Use a JPEG, PNG or WebP photo/)).toBeTruthy();
    // The current photo path is still shown.
    expect(screen.getByText("/photos/burrata.jpg")).toBeTruthy();
  });

  it("uploads a chosen photo after saving and shows the server error if it is refused", async () => {
    setup(burrata, { "POST /api/manager/items/burrata/photo": () => reply(400, "validation") });
    const input = screen.getByLabelText("Photo", { selector: "input" }) as HTMLInputElement;
    const ok = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "leeks.jpg", { type: "image/jpeg" });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
    globalThis.URL.revokeObjectURL = vi.fn();
    await userEvent.upload(input, ok);
    expect(screen.getByRole("img", { name: /New photo/ }).getAttribute("src")).toBe("blob:preview");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/manager/items/burrata/photo")).toBe(true));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(saved).not.toHaveBeenCalled();
  });

  it("is labelled in Turkish", async () => {
    await setLanguage("tr");
    setup(null);
    expect(box("Ad (Türkçe)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ürünü oluştur" })).toBeTruthy();
  });

  it("shows the item's VAT rate and submits the chosen one", async () => {
    setup({ ...ribeye, vatRate: 20 });
    const group = screen.getByRole("group", { name: "VAT" });
    expect(within(group).getByRole("radio", { name: "20%" })).toHaveProperty("checked", true);
    expect(within(group).getByRole("radio", { name: "10%" })).toHaveProperty("checked", false);
    expect(screen.getByText("Prices include VAT")).toBeTruthy();
    await userEvent.click(within(group).getByRole("radio", { name: "10%" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ vatRate: 10 });
  });

  it("a new item defaults to 10%", async () => {
    setup(null);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ vatRate: 10 });
  });

  it("a new item's VAT follows the category until the control is touched", async () => {
    setup(null);
    const vat = () => within(screen.getByRole("group", { name: "VAT" }));
    expect(vat().getByRole("radio", { name: "10%" })).toHaveProperty("checked", true);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "cocktails");
    expect(vat().getByRole("radio", { name: "20%" })).toHaveProperty("checked", true);
    await userEvent.click(vat().getByRole("radio", { name: "10%" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "cocktails");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "share");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "cocktails");
    expect(vat().getByRole("radio", { name: "10%" })).toHaveProperty("checked", true);
  });

  it("editing an existing item never changes its rate when the category changes", async () => {
    setup(burrata);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Category" }), "cocktails");
    expect(within(screen.getByRole("group", { name: "VAT" })).getByRole("radio", { name: "10%" })).toHaveProperty("checked", true);
  });
});
