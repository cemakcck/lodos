import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../../src/i18n";
import { setLanguage } from "../../src/i18n";
import { DishSheet } from "../../src/guest/DishSheet";
import { ribeye, burrata } from "./harness";

beforeEach(async () => { await setLanguage("en"); });
afterEach(() => cleanup());

describe("DishSheet", () => {
  it("disables add until the required group is chosen, and names the group", async () => {
    const onAdd = vi.fn();
    render(<DishSheet item={ribeye} onClose={() => {}} onAdd={onAdd} />);
    const add = screen.getByRole("button", { name: /add to order/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("Please choose: Doneness")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: /medium rare/i }));
    expect(add.disabled).toBe(false);
    expect(screen.queryByText("Please choose: Doneness")).toBeNull();

    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith({
      itemId: "ribeye", qty: 1, note: "", options: [{ groupId: "doneness", optionIds: ["medium-rare"] }],
    });
  });

  it("extras and quantity raise the shown price", async () => {
    render(<DishSheet item={ribeye} onClose={() => {}} onAdd={() => {}} />);
    const add = () => screen.getByRole("button", { name: /add to order/i });
    expect(add().textContent).toContain("₺2,450");
    await userEvent.click(screen.getByRole("checkbox", { name: /add burrata/i }));
    expect(add().textContent).toContain("₺2,630");
    await userEvent.click(screen.getByRole("checkbox", { name: /add bone marrow/i }));
    expect(add().textContent).toContain("₺2,880");
    await userEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(add().textContent).toContain("₺5,760");
  });

  it("lists every allergen by its localized name and counts the note", async () => {
    render(<DishSheet item={ribeye} onClose={() => {}} onAdd={() => {}} />);
    expect(screen.getByText("Celery")).toBeTruthy();
    expect(screen.getByText("Milk")).toBeTruthy();
    const note = screen.getByLabelText(/note for the kitchen/i) as HTMLTextAreaElement;
    expect(note.maxLength).toBe(140);
    await userEvent.type(note, "no salt");
    expect(screen.getByText("7/140")).toBeTruthy();
    await act(() => setLanguage("tr"));
    expect(screen.getByText("Kereviz")).toBeTruthy();
    expect(screen.getByText("Süt")).toBeTruthy();
  });

  it("moves focus in, closes on Esc and returns focus", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(<DishSheet item={burrata} onClose={onClose} onAdd={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
