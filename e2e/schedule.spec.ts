/*
 * Schedule (spec §6): the manager adds a Dinner shift for Mert on Tuesday from a template, sees his weekly
 * total grow, and downloads the week roster as a PDF.
 */
import { test, expect } from "@playwright/test";
import { demoAs } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

test("the manager adds a Dinner shift from a template and downloads the week PDF", async ({ page }) => {
  await demoAs(page, "manager");
  await page.getByRole("link", { name: "Schedule" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();

  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Mert" }) });
  const total = row.locator("td.sc-total .font-mono");
  await expect(total).toBeVisible();
  const before = (await total.innerText()).trim();

  // Tuesday is the second day column of the Monday-first week (Mert already works Thursday in the seed).
  await row.locator("td.sc-cell").nth(1).getByRole("button", { name: /^Add shift for Mert/ }).click();
  const sheet = page.getByRole("dialog", { name: "New shift" });
  await sheet.getByRole("button", { name: /^Dinner/ }).click();
  await expect(sheet.getByRole("button", { name: /^Dinner/ })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  await expect(row.locator("td.sc-cell").nth(1)).toContainText("17:00");
  await expect(total).not.toHaveText(before);

  await page.getByRole("button", { name: "PDF" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Week roster" }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of file) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).subarray(0, 4).toString("latin1")).toBe("%PDF");
});
