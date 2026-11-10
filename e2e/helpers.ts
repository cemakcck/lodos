import { expect, type Browser, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";

export type DemoRole = "guest" | "waiter" | "kitchen" | "bar" | "manager";

/** The signed cookie that ties a browser to its demo sandbox (apps/api/src/auth/login-tenant.ts). */
const SANDBOX_COOKIE = "lodos_sb";

/** Turns the sandbox's order simulator off, so no random order lands mid-test. */
export async function simulatorOff(page: Page): Promise<void> {
  const res = await page.request.post("/api/demo/simulator", { data: { on: false } });
  expect(res.ok(), "simulator off").toBeTruthy();
}

/**
 * Signs this page's context into its demo sandbox as `role` (creating the sandbox on first use), switches the
 * simulator off and opens the role's screen. Returns the path it landed on.
 */
export async function demoAs(page: Page, role: DemoRole): Promise<string> {
  const res = await page.request.post("/api/demo/session", { data: { role } });
  expect(res.ok(), `demo session as ${role}`).toBeTruthy();
  const { redirect } = (await res.json()) as { redirect: string };
  await simulatorOff(page);
  await page.goto(redirect);
  return redirect;
}

/** The guest link (`/t/<token>`) for T7 of this page's sandbox. */
export async function guestUrl(page: Page): Promise<string> {
  const res = await page.request.get("/api/demo/info");
  expect(res.ok(), "demo info").toBeTruthy();
  return ((await res.json()) as { guestUrl: string }).guestUrl;
}

/**
 * A new browser context in the same sandbox as `from`: only the sandbox cookie is copied, never the staff
 * session, so each context signs in as its own role (like a second device in the same restaurant).
 */
export async function joinSandbox(browser: Browser, from: BrowserContext): Promise<BrowserContext> {
  const cookies = (await from.cookies()).filter((c) => c.name === SANDBOX_COOKIE);
  expect(cookies, "the sandbox cookie").toHaveLength(1);
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  return ctx;
}

export type GuestPick = {
  /** The start of the dish's English name, e.g. "Levrek crudo". */
  name: string;
  /** For dishes with a required single choice: the option's English name, e.g. "London dry". */
  option?: string;
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startsWith = (text: string): RegExp => new RegExp(`^${escape(text)}`);

/** The "+" button of a dish row on the guest menu. */
export function addButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name: startsWith(`Add ${name}`) });
}

/** The dish row's main button on the guest menu, which opens its sheet. */
export function dishButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name: startsWith(name) });
}

/**
 * On an open guest menu: adds each dish through its sheet (choosing `option` when given), opens the cart and places
 * the order. Resolves with the order's HTTP response once it has arrived (201 asserted).
 */
export async function orderAsGuest(page: Page, items: GuestPick[]): Promise<Response> {
  for (const item of items) {
    await dishButton(page, item.name).click();
    const sheet = page.getByRole("dialog");
    if (item.option) await sheet.getByRole("radio", { name: startsWith(item.option) }).check();
    await sheet.getByRole("button", { name: /^Add to order/ }).click();
    await expect(sheet).toBeHidden();
  }
  await page.getByRole("button", { name: /^View order/ }).click();
  const placed = page.waitForResponse((r) => r.url().endsWith("/api/guest/orders") && r.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: /^Place order/ }).click();
  const res = await placed;
  expect(res.status(), "order placed").toBe(201);
  return res;
}

/** A kitchen or bar ticket on the board, by table name ("Ticket T7, …"). */
export function ticketFor(page: Page, table: string): Locator {
  return page.getByRole("article", { name: new RegExp(`^Ticket ${table},`) });
}

/**
 * The start of a name made of a visible label plus screen-reader-only details ("T7" + ", food ready, …").
 * Chromium puts a space before the visually hidden part ("T7 , food ready"), so the space is optional.
 */
export function labelThen(label: string, rest = ""): RegExp {
  return new RegExp(`^${escape(label)} ?,${rest ? ` ${escape(rest)}` : ""}`);
}

/** A table on the floor canvas, by its accessible name ("T7, food ready, …"). */
export function floorTable(page: Page, table: string): Locator {
  return page.getByRole("group", { name: /^Floor plan/ }).getByRole("button", { name: labelThen(table) });
}
