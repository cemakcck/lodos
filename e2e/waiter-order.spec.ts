/*
 * Waiter order entry (spec §11): the waiter seats T7 with 2 covers, adds one dish and one drink and sends.
 * The kitchen gets only the food, the bar only the drink, and the table detail shows them grouped as
 * Food and Drinks with the right subtotals.
 */
import { test, expect } from "@playwright/test";
import { demoAs, floorTable, joinSandbox, labelThen, ticketFor } from "./helpers";

const FOOD = "Burrata, heirloom tomato"; // ₺540, no options
const DRINK = "Mint and salt lemonade"; // ₺320, no options

test("a waiter order splits into kitchen and bar, and the check groups Food and Drinks", async ({ browser }) => {
  const waiterCtx = await browser.newContext();
  const waiter = await waiterCtx.newPage();
  await demoAs(waiter, "waiter");

  const kitchenCtx = await joinSandbox(browser, waiterCtx);
  const kitchen = await kitchenCtx.newPage();
  await demoAs(kitchen, "kitchen");
  await expect(kitchen.getByText("Live", { exact: true })).toBeVisible();

  const barCtx = await joinSandbox(browser, waiterCtx);
  const bar = await barCtx.newPage();
  await demoAs(bar, "bar");
  await expect(bar.getByText("Live", { exact: true })).toBeVisible();

  // Seat T7 with 2 covers.
  await floorTable(waiter, "T7").click();
  const panel = waiter.getByRole("region", { name: "Table T7" });
  await panel.getByRole("button", { name: "Seat table" }).click();
  const seat = waiter.getByRole("dialog", { name: "Seat T7" });
  await expect(seat.getByTestId("covers")).toHaveText("2");
  await seat.getByRole("button", { name: "Seat 2 covers" }).click();
  await expect(seat).toBeHidden();
  await expect(floorTable(waiter, "T7")).toHaveAccessibleName(labelThen("T7", "seated, 2 covers"));

  // Add one dish and one drink, then send.
  await panel.getByRole("button", { name: "Add items" }).click();
  await expect(waiter).toHaveURL(/\/staff\/order\//);
  await waiter.getByRole("button", { name: labelThen(FOOD) }).click();
  await waiter.getByRole("button", { name: labelThen(DRINK) }).click();
  const order = waiter.getByRole("region", { name: "Order for T7" });
  await expect(order).toContainText(FOOD);
  await expect(order).toContainText(DRINK);
  await waiter.getByRole("button", { name: "Send to kitchen & bar" }).click();

  // Back on the floor with T7 selected.
  await expect(waiter).toHaveURL(/\/staff\/floor\?table=/);

  // Kitchen: food only. Bar: drink only.
  const kitchenTicket = ticketFor(kitchen, "T7");
  await expect(kitchenTicket).toBeVisible({ timeout: 2_000 });
  await expect(kitchenTicket).toContainText(FOOD);
  await expect(kitchenTicket).not.toContainText(DRINK);
  const barTicket = ticketFor(bar, "T7");
  await expect(barTicket).toBeVisible({ timeout: 2_000 });
  await expect(barTicket).toContainText(DRINK);
  await expect(barTicket).not.toContainText(FOOD);

  // The table detail groups the check as Food and Drinks, each with its subtotal.
  const food = panel.getByRole("group", { name: "Food" });
  const drinks = panel.getByRole("group", { name: "Drinks" });
  await expect(food.getByRole("listitem")).toHaveCount(1);
  await expect(food.getByRole("listitem")).toContainText(FOOD);
  await expect(food.getByTestId("subtotal")).toHaveText(/Subtotal\s*₺540$/);
  await expect(drinks.getByRole("listitem")).toHaveCount(1);
  await expect(drinks.getByRole("listitem")).toContainText(DRINK);
  await expect(drinks.getByTestId("subtotal")).toHaveText(/Subtotal\s*₺320$/);
  await expect(panel.getByTestId("total")).toHaveText(/Open check\s*₺860$/);

  await Promise.all([waiterCtx.close(), kitchenCtx.close(), barCtx.close()]);
});
