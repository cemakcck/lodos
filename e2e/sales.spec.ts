/*
 * Sales (spec §4): a fresh demo copy as manager shows seven days of history: a non-zero revenue, at least five
 * revenue bars, and at least one comp or void in the log. axe finds nothing serious on the page.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { demoAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test.use({ viewport: { width: 1280, height: 800 } });

test("the manager sees seven days of sales", async ({ page }) => {
  await demoAs(page, "manager");
  await page.getByRole("link", { name: "Sales" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Sales/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "7 days", pressed: true })).toBeVisible();

  const revenue = page.getByRole("group", { name: "Revenue" });
  await expect(revenue).toContainText(/₺\s?[1-9]/);
  await expect(revenue).not.toContainText("NaN");

  const hours = page.getByRole("figure").filter({ has: page.getByRole("heading", { name: "Revenue by hour" }) });
  expect(await hours.getByRole("img").count()).toBeGreaterThanOrEqual(5);
  await expect(hours.getByRole("img", { name: /peak hour/ })).toHaveCount(1);

  await expect(page.getByRole("list", { name: "Comps & voids" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/sales/export.csv?range=7d");

  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("button", { name: "Today", pressed: true })).toBeVisible();
  await expect(revenue).not.toContainText("NaN");
});
