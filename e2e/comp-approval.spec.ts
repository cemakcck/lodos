/*
 * Comp with manager approval (spec §3.2): a waiter comps a dessert with Selin's PIN from the approval pad. The
 * table detail shows "Comp · Birthday / celebration" and the line at ₺0. Uses T7, seated and ordered here, so the
 * check's contents are known (T4's seeded contents are not relied on).
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, labelThen } from "./helpers";

test("a waiter comps a dessert with a manager's PIN", async ({ page }) => {
  await demoAs(page, "waiter");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await floorTable(page, "T7").click();
  const panel = page.getByRole("region", { name: "Table T7" });
  await panel.getByRole("button", { name: "Seat table" }).click();
  const seat = page.getByRole("dialog", { name: "Seat T7" });
  await seat.getByRole("button", { name: "Seat 2 covers" }).click();
  await expect(seat).toBeHidden();
  await panel.getByRole("button", { name: "Add items" }).click();
  await page.getByRole("button", { name: labelThen("Basque cheesecake, sour cherry") }).click();
  await page.getByRole("button", { name: "Send to kitchen & bar" }).click();
  await expect(page).toHaveURL(/\/staff\/floor\?table=/);

  const line = panel.getByRole("listitem").filter({ hasText: "Basque cheesecake" });
  await expect(line).toContainText("₺460");
  await line.getByRole("button").first().click();
  await panel.getByRole("group", { name: /^Adjust Basque cheesecake/ }).getByRole("button", { name: "Comp" }).click();

  const dialog = page.getByRole("dialog", { name: /^Basque cheesecake/ });
  await dialog.getByRole("radio", { name: "Birthday / celebration" }).click();
  await expect(dialog.getByText("Demo: Selin's PIN is 9999")).toBeVisible();
  await dialog.getByRole("radio", { name: "Selin" }).click();
  for (const d of "9999") await dialog.getByRole("button", { name: d, exact: true }).click();
  await dialog.getByRole("button", { name: "Approve comp" }).click();
  await expect(dialog).toBeHidden();

  await expect(line).toContainText("Comp · Birthday / celebration");
  await expect(line).toContainText("₺0");
  await expect(line).not.toContainText("₺460");
});
