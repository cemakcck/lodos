/*
 * Accessibility (spec §3, §11): axe finds no serious or critical violations of WCAG 2.2 A/AA (plus axe's
 * best practices) on the main screens, each in the state a visitor actually sees it.
 * No rule is disabled.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { demoAs, dishButton, floorTable, labelThen, orderAsGuest, simulatorOff } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function expectAccessible(page: Page, screen: string): Promise<void> {
  // Let entry transitions settle so colour contrast is measured on the final colours.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}\n    ${n.failureSummary ?? ""}`).join("\n")}`,
  );
  expect(report, `${screen}: serious or critical axe violations`).toEqual([]);
}

test.describe("guest", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("menu, dish sheet and Your table", async ({ page }) => {
    await demoAs(page, "guest");
    await expect(dishButton(page, "Levrek crudo")).toBeVisible();
    await expectAccessible(page, "guest menu");

    await dishButton(page, "Lodos Negroni").click();
    await expect(page.getByRole("dialog", { name: "Lodos Negroni" })).toBeVisible();
    await expectAccessible(page, "dish sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await orderAsGuest(page, [{ name: "Levrek crudo" }, { name: "Lodos Negroni", option: "London dry" }]);
    await expect(page.getByRole("heading", { level: 1, name: "Your table" })).toBeVisible();
    await expect(page.getByText("Lodos Negroni")).toBeVisible();
    await expectAccessible(page, "Your table");
  });
});

test.describe("staff", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("demo landing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /restaurant system demo/ })).toBeVisible();
    await expectAccessible(page, "demo landing");
  });

  test("staff login", async ({ page }) => {
    // A sandbox exists (as after any demo visit), but no one is signed in: the name tiles show.
    const res = await page.request.post("/api/demo/session", { data: { role: "guest" } });
    expect(res.ok()).toBeTruthy();
    await simulatorOff(page);
    await page.goto("/staff/login");
    await expect(page.getByRole("button", { name: /Deniz/ })).toBeVisible();
    await expectAccessible(page, "staff login, names");
    await page.getByRole("button", { name: /Deniz/ }).click();
    await expect(page.getByRole("heading", { name: "Enter your PIN" })).toBeVisible();
    await expectAccessible(page, "staff login, PIN pad");
  });

  test("kitchen", async ({ page }) => {
    await demoAs(page, "kitchen");
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expectAccessible(page, "kitchen");
  });

  test("floor with a table selected", async ({ page }) => {
    await demoAs(page, "waiter");
    await floorTable(page, "B4").click();
    await expect(page.getByRole("region", { name: "Table B4" }).getByRole("button", { name: "Close check" })).toBeVisible();
    await expectAccessible(page, "floor");
  });

  test("order entry", async ({ page }) => {
    await demoAs(page, "waiter");
    await floorTable(page, "B1").click();
    await page.getByRole("region", { name: "Table B1" }).getByRole("button", { name: "Add items" }).click();
    await expect(page.getByRole("button", { name: labelThen("Burrata, heirloom tomato") })).toBeVisible();
    await page.getByRole("button", { name: labelThen("Burrata, heirloom tomato") }).click();
    await expect(page.getByRole("region", { name: "Order for B1" })).toContainText("Burrata");
    await expectAccessible(page, "order entry");
  });

  test("menu editor", async ({ page }) => {
    await demoAs(page, "manager");
    await expect(page.getByRole("heading", { level: 1, name: "Menu" })).toBeVisible();
    await expect(page.getByRole("switch").first()).toBeVisible();
    await expectAccessible(page, "menu editor");
  });
});
