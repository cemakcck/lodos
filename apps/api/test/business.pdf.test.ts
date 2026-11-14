import { formatTRY } from "@lodos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";
import { businessFixture, OCTOBER } from "./business-fixture";

const NOW = new Date("2026-11-14T12:00:00Z");

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

async function textOf(body: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join(" ");
}

describe("monthly PDF", () => {
  it("TR: the month name, 'Yemek', the menu groups and the profit formatted as the JSON's", async () => {
    const f = await businessFixture(t);
    const json = (await f.get("/api/business/monthly?month=2026-10")).json();
    expect(json.pnl.cur.profit).toBe(OCTOBER.profit);
    const res = await f.get("/api/business/monthly.pdf?month=2026-10&lang=tr");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("lodos-monthly-2026-10.pdf");
    const text = await textOf(res.rawPayload);
    expect(text).toContain("Ekim 2026");
    expect(text).toContain("Yemek");
    expect(text).toContain("Temizlik");
    expect(text).toContain("Gizli hazineler");
    expect(text).toContain(formatTRY(json.pnl.cur.profit, "tr"));
    expect(text).toContain("Köfte");
    expect(text).toContain("October comment 10");
  });

  it("EN: the current month is labelled so far, with English copy", async () => {
    const f = await businessFixture(t);
    const json = (await f.get("/api/business/monthly")).json();
    const res = await f.get("/api/business/monthly.pdf");
    const text = await textOf(res.rawPayload);
    expect(text).toContain("November 2026");
    expect(text).toContain("so far");
    expect(text).toContain("Food");
    expect(text).toContain(formatTRY(json.pnl.cur.profit, "en"));
  });
});
