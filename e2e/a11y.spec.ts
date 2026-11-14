/*
 * Accessibility (spec §3, §11): axe finds no serious or critical violations of WCAG 2.2 A/AA (plus axe's
 * best practices) on the main screens, each in the state a visitor actually sees it.
 * No rule is disabled.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { demoAs, dishButton, floorTable, joinSandbox, labelThen, orderAsGuest, simulatorOff } from "./helpers";

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

  test("close view (each mode), approval pad and receipt", async ({ page }) => {
    await demoAs(page, "waiter");
    await floorTable(page, "T7").click();
    const panel = page.getByRole("region", { name: "Table T7" });
    await panel.getByRole("button", { name: "Seat table" }).click();
    await page.getByRole("dialog", { name: "Seat T7" }).getByRole("button", { name: "Seat 2 covers" }).click();
    await panel.getByRole("button", { name: "Add items" }).click();
    await page.getByRole("button", { name: labelThen("Basque cheesecake, sour cherry") }).click();
    await page.getByRole("button", { name: labelThen("Burrata, heirloom tomato") }).click();
    await page.getByRole("button", { name: "Send to kitchen & bar" }).click();
    await expect(page).toHaveURL(/\/staff\/floor\?table=/);

    // The approval pad (a waiter comping a line).
    const line = panel.getByRole("listitem").filter({ hasText: "Basque cheesecake" });
    await line.getByRole("button").first().click();
    await panel.getByRole("group", { name: /^Adjust Basque cheesecake/ }).getByRole("button", { name: "Comp" }).click();
    const dialog = page.getByRole("dialog", { name: /^Basque cheesecake/ });
    await dialog.getByRole("radio", { name: "Birthday / celebration" }).click();
    await expect(dialog.getByRole("radio", { name: "Selin" })).toBeVisible();
    await expectAccessible(page, "approval pad");
    await dialog.locator("button.staff-btn", { hasText: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // The close view in each mode.
    await panel.getByRole("button", { name: "Close check" }).click();
    const checkId = new URL(page.url()).pathname.split("/")[3]!;
    await expect(page.getByRole("heading", { name: "Close check · T7" })).toBeVisible();
    await expectAccessible(page, "close view, in full");
    await page.getByRole("radio", { name: "Evenly" }).click();
    await expect(page.getByRole("radio", { name: "Evenly" })).toBeChecked();
    await expect(page.getByRole("article", { name: "Guest A" })).toBeVisible();
    await expectAccessible(page, "close view, evenly");
    await page.getByRole("radio", { name: "By item" }).click();
    await expect(page.getByRole("radio", { name: "By item" })).toBeChecked();
    await page.getByRole("button", { name: /^Burrata, heirloom tomato/ }).click();
    await page.getByRole("button", { name: "Guest A", exact: true }).click();
    await expect(page.getByRole("button", { name: "Guest A", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page, "close view, by item");

    // The receipt.
    await page.goto(`/staff/check/${checkId}/print?noprint`);
    await expect(page.getByRole("article", { name: /T7/ })).toContainText("Burrata");
    await expectAccessible(page, "receipt");
  });

  test("menu editor", async ({ page }) => {
    await demoAs(page, "manager");
    await expect(page.getByRole("heading", { level: 1, name: "Menu" })).toBeVisible();
    await expect(page.getByRole("switch").first()).toBeVisible();
    await expectAccessible(page, "menu editor");
  });
  test("staff, schedule and my shifts", async ({ page }) => {
    await demoAs(page, "manager");
    await page.getByRole("link", { name: "Staff", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Staff" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Deniz/ }).first()).toBeVisible();
    await expectAccessible(page, "staff");

    await page.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expectAccessible(page, "schedule");

    await page.getByRole("link", { name: "My shifts" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My shifts" })).toBeVisible();
    await expectAccessible(page, "my shifts");
  });

  test("floor plan with a table selected", async ({ page }) => {
    await demoAs(page, "manager");
    await page.getByRole("link", { name: "Floor plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Floor plan" })).toBeVisible();
    await page.getByRole("group", { name: /floor plan$/ }).getByRole("button", { name: /^T7,/ }).focus();
    await expect(page.getByRole("group", { name: /floor plan$/ }).getByRole("button", { name: /^T7,/ })).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page, "floor plan");
  });
});

/*
 * Phase 3: the management screens and the rating card, each in English and Turkish. The language is chosen the way a
 * visitor does it (the stored preference), before the page loads.
 */
for (const lang of ["en", "tr"] as const) {
  test.describe(`management, ${lang}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((l) => localStorage.setItem("lodos.lang", l), lang);
    });

    const managerScreens: [string, [string, string][]][] = [
      ["overview and monthly", [["/staff/overview", "overview"], ["/staff/business", "monthly"]]],
      ["performance, expenses and timesheets", [["/staff/performance", "performance"], ["/staff/expenses", "expenses"], ["/staff/timesheets", "timesheets"]]],
    ];
    for (const [name, screens] of managerScreens) {
      test(name, async ({ page }) => {
        await demoAs(page, "manager");
        for (const [path, screen] of screens) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.getByText(/^(Loading…|Yükleniyor…)$/)).toHaveCount(0);
          await expectAccessible(page, `${screen} (${lang})`);
        }
      });
    }

    test("My performance and the time clock", async ({ page }) => {
      await demoAs(page, "waiter");
      await page.goto("/staff/my-performance");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(/^(Loading…|Yükleniyor…)$/)).toHaveCount(0);
      await expectAccessible(page, `my performance (${lang})`);

      await page.goto("/staff/clock");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: /Mert/ })).toBeVisible();
      await expectAccessible(page, `time clock, names (${lang})`);
      await page.getByRole("button", { name: /Mert/ }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page, `time clock, PIN pad (${lang})`);
    });

    {
      test("the rating card", async ({ browser }) => {
        // The ordering and closing run in English (the helpers' names are English); the guest then picks the language.
        const guestCtx = await browser.newContext();
        const guest = await guestCtx.newPage();
        await demoAs(guest, "guest");
        const waiterCtx = await joinSandbox(browser, guestCtx);
        const waiter = await waiterCtx.newPage();
        await demoAs(waiter, "waiter");
        
        await orderAsGuest(guest, [{ name: "Levrek crudo" }]);
        await floorTable(waiter, "T7").click();
        await waiter.getByRole("region", { name: "Table T7" }).getByRole("button", { name: "Close check" }).click();
        await waiter.getByRole("button", { name: /^Take payment/ }).click();
        const dialog = waiter.getByRole("dialog", { name: "Close check · T7" });
        await dialog.getByRole("radio", { name: "Card" }).click();
        await dialog.getByRole("button", { name: /^Close check, .* by card$/ }).click();
        await expect(dialog).toBeHidden();

        await guest.getByRole("group", { name: /^(Language|Dil)$/ }).getByRole("button", { name: new RegExp(`^${lang.toUpperCase()} ?,`) }).click();
        await expect(guest.getByRole("heading", { level: 2, name: lang === "en" ? "How was your visit?" : "Ziyaretiniz nasıldı?" })).toBeVisible({ timeout: 5_000 });
        await expectAccessible(guest, `rating card (${lang})`);
        await Promise.all([guestCtx.close(), waiterCtx.close()]);
      });
    }
  });
}
