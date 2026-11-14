/*
 * The management system (phase 3): a guest rates a paid visit, the manager sees the rating on the overview and the
 * comment on the monthly dashboard, and a waiter who punches in on the time clock shows up on shift.
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, joinSandbox, orderAsGuest } from "./helpers";

test("a rating reaches the manager's dashboards and a clock-in shows on the overview", async ({ browser }) => {
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await demoAs(guest, "guest");

  const waiterCtx = await joinSandbox(browser, guestCtx);
  const waiter = await waiterCtx.newPage();
  await demoAs(waiter, "waiter");
  await expect(waiter.getByText("Live", { exact: true })).toBeVisible();

  // 1. The guest orders on T7 and 2. the waiter closes the check by card.
  await orderAsGuest(guest, [{ name: "Levrek crudo" }]);
  await expect(guest.getByRole("heading", { level: 1, name: "Your table" })).toBeVisible();
  await floorTable(waiter, "T7").click();
  await waiter.getByRole("region", { name: "Table T7" }).getByRole("button", { name: "Close check" }).click();
  await waiter.getByRole("button", { name: /^Take payment/ }).click();
  const dialog = waiter.getByRole("dialog", { name: "Close check · T7" });
  await dialog.getByRole("radio", { name: "Card" }).click();
  await dialog.getByRole("button", { name: /^Close check, .* by card$/ }).click();
  await expect(dialog).toBeHidden();

  // 3. The guest's page offers the rating card, and the guest rates.
  const card = guest.getByRole("region", { name: "How was your visit?" });
  await expect(card).toBeVisible({ timeout: 5_000 });
  const stars = async (group: string | RegExp, n: number) =>
    card.getByRole("radiogroup", { name: group }).getByRole("radio", { name: `${n} of 5 stars` }).click();
  await stars(/^Your waiter/, 5);
  await stars(/^Levrek crudo/, 4);
  await stars("Food", 5);
  await stars("Cleanliness", 5);
  await stars("Atmosphere", 4);
  const comment = "The crudo was lovely, e2e-comment";
  await card.getByRole("textbox", { name: /Anything to add/ }).fill(comment);
  await card.getByRole("button", { name: "Send rating" }).click();
  await expect(guest.getByText("Thanks for your rating!")).toBeVisible();

  // 4. The manager's overview has the rating tile, and the monthly dashboard lists the comment.
  const managerCtx = await joinSandbox(browser, guestCtx);
  const manager = await managerCtx.newPage();
  await demoAs(manager, "manager");
  await expect(manager).toHaveURL(/\/staff\/overview$/);
  const tile = manager.getByRole("group", { name: "Guest rating (7 days)" });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText(/[1-5]\.\d/);

  await manager.goto("/staff/business");
  await expect(manager.getByRole("heading", { name: "Latest comments" })).toBeVisible();
  await expect(manager.getByText(comment)).toBeVisible();

  // 5. Mert punches in on the time clock (no session needed) and the overview shows him on shift.
  const clockCtx = await joinSandbox(browser, guestCtx);
  const clock = await clockCtx.newPage();
  await clock.goto("/staff/clock");
  await clock.getByRole("button", { name: /Mert/ }).click();
  await expect(clock.getByRole("heading", { name: "Enter your PIN" })).toBeVisible();
  for (const d of "2222") await clock.getByRole("button", { name: d, exact: true }).click();
  await clock.getByRole("button", { name: "Clock in / out" }).click();
  await expect(clock.getByText(/^Clocked in /)).toBeVisible();

  await manager.goto("/staff/overview");
  const working = manager.getByRole("table", { name: "Who's working now" });
  await expect(working.getByRole("row", { name: /Mert/ })).toContainText("on shift");

  await Promise.all([guestCtx.close(), waiterCtx.close(), managerCtx.close(), clockCtx.close()]);
});
