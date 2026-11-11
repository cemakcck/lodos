/*
 * Closing a check (spec §11): a guest at T7 orders, the waiter closes the check by card, and the table turns
 * Free. The guest page that is still open says the visit has ended, and the next guest order opens a new visit
 * (a new check) on the same table.
 */
import { test, expect, type Page } from "@playwright/test";
import { demoAs, floorTable, joinSandbox, labelThen, orderAsGuest } from "./helpers";

/** The open check of the guest's table, read through the guest API with the page's table token. */
async function visitId(guest: Page, token: string): Promise<string | null> {
  const res = await guest.request.get("/api/guest/table", { headers: { "X-Table-Token": token } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { visit: { checkId: string } | null };
  return body.visit?.checkId ?? null;
}

test("the waiter closes a check, the guest's visit ends, and a new order opens a new visit", async ({ browser }) => {
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const guestPath = await demoAs(guest, "guest");
  const token = guestPath.split("/").pop()!;

  const waiterCtx = await joinSandbox(browser, guestCtx);
  const waiter = await waiterCtx.newPage();
  await demoAs(waiter, "waiter");
  await expect(waiter.getByText("Live", { exact: true })).toBeVisible();

  // The guest orders, which seats T7 with a new visit.
  await orderAsGuest(guest, [{ name: "Levrek crudo" }]);
  await expect(guest.getByRole("heading", { level: 1, name: "Your table" })).toBeVisible();
  const firstVisit = await visitId(guest, token);
  expect(firstVisit).not.toBeNull();
  await expect(floorTable(waiter, "T7")).toHaveAccessibleName(labelThen("T7", "seated"), { timeout: 2_000 });

  // The waiter closes the check by card.
  await floorTable(waiter, "T7").click();
  const panel = waiter.getByRole("region", { name: "Table T7" });
  await panel.getByRole("button", { name: "Close check" }).click();
  await expect(waiter).toHaveURL(/\/staff\/check\/[^/]+\/close$/);
  await expect(waiter.getByRole("heading", { name: "Close check · T7" })).toBeVisible();
  await expect(waiter.getByRole("radio", { name: "In full" })).toBeChecked();
  await waiter.getByRole("button", { name: "Take payment, ₺780" }).click();
  const dialog = waiter.getByRole("dialog", { name: "Close check · T7" });
  await dialog.getByRole("radio", { name: "Card" }).click();
  await expect(dialog.getByRole("radio", { name: "Card" })).toBeChecked();
  await dialog.getByRole("button", { name: /^Close check, ₺780 by card$/ }).click();
  await expect(dialog).toBeHidden();

  // Back on the floor with T7 selected.
  await expect(waiter).toHaveURL(/\/staff\/floor/);
  // T7 is free again.
  await expect(floorTable(waiter, "T7")).toHaveAccessibleName(labelThen("T7", "free"));
  await floorTable(waiter, "T7").click();
  await expect(panel.getByRole("button", { name: "Seat table" })).toBeVisible();

  // The guest page that is still open shows the visit has ended.
  await expect(guest.getByRole("heading", { level: 1, name: "This table's visit has ended. Thank you!" })).toBeVisible({
    timeout: 2_000,
  });
  expect(await visitId(guest, token)).toBeNull();

  // Scanning again and ordering opens a new visit on the same table.
  await guest.goto(guestPath);
  await orderAsGuest(guest, [{ name: "Burrata, heirloom tomato" }]);
  await expect(guest.getByRole("heading", { level: 1, name: "Your table" })).toBeVisible();
  const secondVisit = await visitId(guest, token);
  expect(secondVisit).not.toBeNull();
  expect(secondVisit).not.toBe(firstVisit);
  // The new visit holds only the new order.
  await expect(guest.getByText("Burrata, heirloom tomato")).toBeVisible();
  await expect(guest.getByText("Levrek crudo")).toHaveCount(0);
  await expect(floorTable(waiter, "T7")).toHaveAccessibleName(labelThen("T7", "seated"), { timeout: 2_000 });

  await Promise.all([guestCtx.close(), waiterCtx.close()]);
});
