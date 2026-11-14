/*
 * 86 (spec §11): the manager marks a dish sold out, and a guest menu that is already open shows it as
 * "Sold out tonight" within 2 s, with its add button disabled, without a reload.
 */
import { test, expect } from "@playwright/test";
import { addButton, demoAs, guestUrl, joinSandbox } from "./helpers";

// The seed's burnt-top cheesecake ("Basque cheesecake, sour cherry").
const DISH = "Basque cheesecake, sour cherry";

test("an 86 from the manager reaches an open guest menu live", async ({ browser }) => {
  const managerCtx = await browser.newContext();
  const manager = await managerCtx.newPage();
  await demoAs(manager, "manager");
  await manager.goto("/staff/menu");
  await expect(manager.getByRole("heading", { level: 1, name: "Menu" })).toBeVisible();

  // A guest at T7 on another device of the same restaurant, menu open.
  const guestCtx = await joinSandbox(browser, managerCtx);
  const guest = await guestCtx.newPage();
  await guest.goto(await guestUrl(manager));
  const row = guest.getByRole("listitem").filter({ has: guest.getByRole("button", { name: new RegExp(`^${DISH}`) }) });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Sold out tonight");
  await expect(addButton(guest, DISH)).toBeEnabled();
  let navigations = 0;
  guest.on("framenavigated", (f) => {
    if (f === guest.mainFrame()) navigations += 1;
  });

  // The manager 86's it.
  const toggle = manager.getByRole("switch", { name: `Sold out tonight, ${DISH}` });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // The open guest page follows within 2 s, with no reload.
  await expect(row).toContainText("Sold out tonight", { timeout: 2_000 });
  await expect(guest.getByRole("button", { name: `${DISH} is sold out tonight` })).toBeDisabled();
  expect(navigations).toBe(0);

  await Promise.all([managerCtx.close(), guestCtx.close()]);
});
