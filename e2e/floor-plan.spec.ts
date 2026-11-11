/*
 * Floor plan editor (spec §7): the manager moves T7 two grid steps right with the keyboard and saves; a waiter
 * on a second device in the same sandbox sees T7 move without reloading.
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, joinSandbox, simulatorOff } from "./helpers";

test.use({ viewport: { width: 1280, height: 800 } });

test("a saved layout change reaches the waiter floor live", async ({ page, browser }) => {
  await demoAs(page, "manager");
  const waiterCtx = await joinSandbox(browser, page.context());
  try {
    const waiter = await waiterCtx.newPage();
    await waiter.setViewportSize({ width: 1280, height: 800 });
    const res = await waiter.request.post("/api/demo/session", { data: { role: "waiter" } });
    expect(res.ok()).toBeTruthy();
    await simulatorOff(waiter);
    await waiter.goto("/staff/floor");
    await expect(waiter.getByText("Live", { exact: true })).toBeVisible();
    const t7 = floorTable(waiter, "T7");
    const planX = async () => Number(await t7.getAttribute("data-x"));
    const planY = async () => Number(await t7.getAttribute("data-y"));
    await expect(t7).toHaveAttribute("data-x", /^\d+$/);
    const before = { x: await planX(), y: await planY() };

    await page.getByRole("link", { name: "Floor plan" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Floor plan" })).toBeVisible();
    const table = page.getByRole("group", { name: /floor plan$/ }).getByRole("button", { name: /^T7,/ });
    await table.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText("Layout saved")).toBeVisible();

    // Two 16 px grid steps: exactly 32 to the right in plan units, and no vertical move.
    await expect(t7).toHaveAttribute("data-x", String(before.x + 32));
    expect(await planY()).toBe(before.y);
  } finally {
    await waiterCtx.close();
  }
});
