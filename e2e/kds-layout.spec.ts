/*
 * F8: the kitchen ticket header reads cleanly on a 1280 px screen with 4 ticket columns (the README screenshot).
 * The server or "QR order", the covers and the sent time sit on one line under the table number, nothing clipped.
 * The seeded T10 ticket is a QR order with 2 covers: the case that used to wrap onto three lines.
 */
import { test, expect } from "@playwright/test";
import { demoAs } from "./helpers";

test.use({ viewport: { width: 1280, height: 800 } });

test("kitchen ticket headers: who, covers and sent time on one unclipped line at 1280 px", async ({ page }) => {
  await demoAs(page, "kitchen");
  const t10 = page.getByRole("article", { name: /^Ticket T10\b/ });
  await expect(t10).toBeVisible();
  await expect(t10.locator("header")).toContainText(/QR order · 2 covers/);

  const headers = await page.locator(".kds-tk-h").evaluateAll((els) =>
    els.map((h) => {
      const meta = h.querySelector<HTMLElement>(".kds-tmeta")!;
      const lineHeight = parseFloat(getComputedStyle(meta).lineHeight);
      const clipped = [...h.querySelectorAll<HTMLElement>("*")].some((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0);
      return { text: h.textContent, lines: Math.round(meta.getBoundingClientRect().height / lineHeight), clipped };
    }),
  );
  expect(headers.length).toBeGreaterThanOrEqual(4);
  for (const h of headers) expect(h, h.text ?? "").toMatchObject({ lines: 1, clipped: false });
});
