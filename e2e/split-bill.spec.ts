/*
 * Splitting a check by item (spec §3.1): the waiter seats T7, orders Burrata x1 and Negroni x2, splits By item
 * (the Burrata between A and B, one Negroni each), takes A by card and B in cash. The check closes, T7 is Free,
 * and B's receipt shows "½ Burrata" and the footer.
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, labelThen } from "./helpers";

test("a check split by item is paid by two guests and each gets a receipt", async ({ page }) => {
  await demoAs(page, "waiter");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await floorTable(page, "T7").click();
  const panel = page.getByRole("region", { name: "Table T7" });
  await panel.getByRole("button", { name: "Seat table" }).click();
  const seat = page.getByRole("dialog", { name: "Seat T7" });
  await seat.getByRole("button", { name: "Seat 2 covers" }).click();
  await expect(seat).toBeHidden();

  await panel.getByRole("button", { name: "Add items" }).click();
  await page.getByRole("button", { name: labelThen("Burrata, heirloom tomato") }).click();
  await page.getByRole("button", { name: labelThen("Lodos Negroni") }).click();
  const sheet = page.getByRole("dialog", { name: "Lodos Negroni" });
  await sheet.getByRole("radio", { name: /^London dry/ }).check();
  await sheet.getByRole("button", { name: "More" }).click();
  await sheet.getByRole("button", { name: /^Add/ }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "Send to kitchen & bar" }).click();
  await expect(page).toHaveURL(/\/staff\/floor\?table=/);

  await panel.getByRole("button", { name: "Close check" }).click();
  await expect(page.getByRole("heading", { name: "Close check · T7" })).toBeVisible();
  const checkId = new URL(page.url()).pathname.split("/")[3]!;
  await page.getByRole("radio", { name: "By item" }).click();
  await expect(page.getByRole("radio", { name: "By item" })).toBeChecked();

  // The Burrata on A and B, one Negroni each.
  const unit = (name: RegExp) => page.getByRole("button", { name });
  const assign = async (name: RegExp, letters: string[]) => {
    await unit(name).click();
    for (const l of letters) await page.getByRole("button", { name: `Guest ${l}`, exact: true }).click();
  };
  await assign(/^Burrata, heirloom tomato/, ["A", "B"]);
  await assign(/^Lodos Negroni.*1 of 2/, ["A"]);
  await assign(/^Lodos Negroni.*2 of 2/, ["B"]);
  await expect(page.getByTestId("unassigned")).toHaveCount(0);

  const cardA = page.getByRole("article", { name: "Guest A" });
  const cardB = page.getByRole("article", { name: "Guest B" });
  await expect(cardA).toContainText("½ Burrata");
  await expect(cardA.getByTestId("share-amount")).toHaveText("₺950");
  await expect(cardB.getByTestId("share-amount")).toHaveText("₺950");

  // A pays by card.
  await cardA.getByRole("button", { name: /^Take payment/ }).click();
  const payA = page.getByRole("dialog", { name: "Take payment · Guest A" });
  await payA.getByRole("radio", { name: "Card" }).click();
  await payA.getByRole("button", { name: /^Take payment, ₺950 by card$/ }).click();
  await expect(payA).toBeHidden();
  await expect(cardA).toContainText("Paid · card");
  await expect(page.getByTestId("progress")).toContainText("1 of 2 paid");

  // The floor says the table is partly paid.
  await page.getByRole("link", { name: "Back to floor" }).click();
  await expect(floorTable(page, "T7")).toHaveAccessibleName(/Paying · 1 of 2/);
  await floorTable(page, "T7").click();
  await panel.getByRole("button", { name: "Close check" }).click();

  // B pays in cash, which closes the check.
  const cardB2 = page.getByRole("article", { name: "Guest B" });
  await cardB2.getByRole("button", { name: /^Take payment/ }).click();
  const payB = page.getByRole("dialog", { name: "Take payment · Guest B" });
  await payB.getByRole("radio", { name: "Cash" }).click();
  await payB.getByRole("button", { name: /^Take payment, ₺950 by cash$/ }).click();
  await expect(page.getByRole("dialog", { name: "Check closed" })).toBeVisible();
  await page.getByRole("dialog", { name: "Check closed" }).getByRole("button", { name: /Back to floor/ }).click();
  await expect(page).toHaveURL(/\/staff\/floor/);
  await expect(floorTable(page, "T7")).toHaveAccessibleName(labelThen("T7", "free"));

  // B's receipt.
  await page.goto(`/staff/check/${checkId}/receipt?share=B&noprint`);
  const slip = page.getByRole("article", { name: /T7/ });
  await expect(slip).toContainText("½ Burrata");
  await expect(slip).toContainText("Lodos Negroni");
  await expect(slip).toContainText("Teşekkürler · Thank you");
  await expect(slip).toContainText("Bilgi fişi — mali değeri yoktur / Not a fiscal receipt");
});
