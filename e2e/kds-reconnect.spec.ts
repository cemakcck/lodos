/*
 * Review Focus 5: a kitchen screen that lost its connection catches up on its own.
 * The kitchen goes offline, a guest orders meanwhile, the kitchen comes back online, and the new ticket
 * shows up within 5 s with no page reload (the socket reconnect refetches the snapshot).
 * Self-contained: it opens its own demo sandbox through the demo session API. Runs in Task 20's suite.
 */
import { randomUUID } from "node:crypto";
import { test, expect, request as playwrightRequest } from "@playwright/test";

type Loc = { en: string; tr: string };
type MenuItem = {
  id: string;
  name: Loc;
  station: "kitchen" | "bar";
  optionGroups: { required: boolean }[];
  availability: { soldOut: boolean; remaining: number | null };
};

test("the kitchen display shows an order placed while it was offline, without a reload", async ({ browser, baseURL }) => {
  const kitchen = await browser.newContext({ baseURL });
  const page = await kitchen.newPage();

  // 1. Sign in as kitchen through the demo (the cookie lands in this context).
  const session = await page.request.post("/api/demo/session", { data: { role: "kitchen" } });
  expect(session.ok()).toBeTruthy();
  const info = await page.request.get("/api/demo/info");
  expect(info.ok()).toBeTruthy();
  const { guestUrl } = (await info.json()) as { guestUrl: string };
  const tableToken = guestUrl.split("/").pop()!;

  await page.goto("/staff/kitchen");
  await expect(page.getByRole("heading", { level: 1, name: /Kitchen/ })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });

  // 2. Drop the kitchen's network.
  await kitchen.setOffline(true);

  // 3. A guest at T7 orders from a second, independent context.
  const guest = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { "X-Table-Token": tableToken } });
  const menuRes = await guest.get("/api/guest/menu");
  expect(menuRes.ok()).toBeTruthy();
  const { items } = (await menuRes.json()) as { items: MenuItem[] };
  const dish = items.find(
    (i) => i.station === "kitchen" && !i.availability.soldOut && i.availability.remaining !== 0 && i.optionGroups.every((g) => !g.required),
  );
  expect(dish, "a kitchen dish without required options").toBeTruthy();
  const order = await guest.post("/api/guest/orders", {
    data: { idempotencyKey: randomUUID(), items: [{ itemId: dish!.id, qty: 1, options: [], note: "e2e reconnect" }] },
  });
  expect(order.status()).toBe(201);
  await guest.dispose();

  // 4. Back online.
  await kitchen.setOffline(false);

  // 5. The new ticket (T7, carrying our note) is on the board within 5 s, and the page never reloaded.
  const ticket = page.getByRole("article", { name: /T7/ }).filter({ hasText: "e2e reconnect" });
  await expect(ticket).toBeVisible({ timeout: 5_000 });
  await expect(ticket.getByText(dish!.name.en)).toBeVisible();
  expect(navigations).toBe(0);

  await kitchen.close();
});
