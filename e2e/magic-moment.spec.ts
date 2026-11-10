/*
 * The magic moment (spec §1, §11): a guest orders from the QR menu, the kitchen sees the ticket within 2 s
 * with no reload, the bar sees only the drink, and a Bump turns the table into "Food ready" on the waiter's
 * floor within 2 s while the guest's "Your table" shows the dish as Ready.
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, joinSandbox, labelThen, orderAsGuest, ticketFor } from "./helpers";

test("a guest order reaches the kitchen and bar live, and a bump shows on the floor", async ({ browser }) => {
  // Context A: the visitor's browser. The guest page, then the kitchen in a second window of the same
  // browser, the way the demo's "Now open the kitchen screen" callout opens it.
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await demoAs(guest, "guest");
  await expect(guest.getByRole("button", { name: /^Levrek crudo/ })).toBeVisible();

  const kitchen = await visitor.newPage();
  await demoAs(kitchen, "kitchen");
  await expect(kitchen.getByRole("heading", { level: 1, name: /Kitchen/ })).toBeVisible();
  await expect(kitchen.getByText("Live", { exact: true })).toBeVisible();
  await expect(ticketFor(kitchen, "T7")).toHaveCount(0);

  // Two more devices in the same restaurant: the bar screen and the waiter's floor.
  const barCtx = await joinSandbox(browser, visitor);
  const bar = await barCtx.newPage();
  await demoAs(bar, "bar");
  await expect(bar.getByText("Live", { exact: true })).toBeVisible();
  await expect(ticketFor(bar, "T7")).toHaveCount(0);

  const floorCtx = await joinSandbox(browser, visitor);
  const floor = await floorCtx.newPage();
  await demoAs(floor, "waiter");
  await expect(floor.getByText("Live", { exact: true })).toBeVisible();
  await expect(floorTable(floor, "T7")).toHaveAccessibleName(labelThen("T7", "free"));

  // The guest orders a crudo and a Negroni (choosing the gin).
  await orderAsGuest(guest, [{ name: "Levrek crudo" }, { name: "Lodos Negroni", option: "Mastic gin" }]);

  // Kitchen: the crudo ticket for T7, within 2 s of the order response, without a reload.
  const kitchenTicket = ticketFor(kitchen, "T7");
  await expect(kitchenTicket).toBeVisible({ timeout: 2_000 });
  await expect(kitchenTicket).toContainText("Levrek crudo");
  await expect(kitchenTicket).not.toContainText("Negroni");

  // Bar: only the Negroni, with the gin chosen.
  const barTicket = ticketFor(bar, "T7");
  await expect(barTicket).toBeVisible({ timeout: 2_000 });
  await expect(barTicket).toContainText("Lodos Negroni");
  await expect(barTicket).toContainText("Mastic gin");
  await expect(barTicket).not.toContainText("Levrek");

  // The guest lands on "Your table" with both lines on their way.
  await expect(guest).toHaveURL(/\/t\/[^/]+\/table$/);
  await expect(guest.getByRole("heading", { level: 1, name: "Your table" })).toBeVisible();

  // Bump in the kitchen: the floor shows T7 as "Food ready" within 2 s, and the guest sees "Ready".
  await kitchenTicket.getByRole("button", { name: "Bump T7" }).click();
  await expect(kitchenTicket).toHaveCount(0);
  await expect(floorTable(floor, "T7")).toHaveAccessibleName(labelThen("T7", "food ready"), { timeout: 2_000 });
  const food = guest.locator("section", { has: guest.getByRole("heading", { name: "Food" }) });
  await expect(food.getByRole("listitem").filter({ hasText: "Levrek crudo" })).toContainText("Ready", { timeout: 2_000 });

  await Promise.all([visitor.close(), barCtx.close(), floorCtx.close()]);
});
