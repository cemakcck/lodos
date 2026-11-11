import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { seedRestaurant } from "../src/seed/seed";
import { makeTestApp, newTenant, type TestApp } from "./helpers";

const NOW = new Date("2026-11-10T17:00:00Z");
const WEEK = "2026-11-09";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

async function textOf(body: Buffer): Promise<{ pages: string[] }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(body), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { pages };
}

async function fresh() {
  const tenantId = newTenant();
  const seed = await seedRestaurant(t.models, tenantId, NOW, { liveService: false });
  const sid = (who: keyof typeof seed.staff) => createSession(t.models, seed.staff[who], tenantId, "person", NOW);
  const as = (cookie: string) => (url: string) => t.inject({ method: "GET", url, cookies: { lodos_sid: cookie } });
  const manager = as(await sid("manager"));
  const waiter = as(await sid("waiter"));
  const week = (await manager(`/api/shifts?week=${WEEK}`)).json() as {
    people: { id: string; name: string }[];
    shifts: { staffId: string; start: string; end: string }[];
    totals: { byPerson: Record<string, number> };
  };
  return { seed, manager, waiter, week };
}

describe("shift PDFs", () => {
  it("the TR week roster has Turkish glyphs", async () => {
    const f = await fresh();
    const res = await f.manager(`/api/shifts/pdf/week?week=${WEEK}&lang=tr`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(`lodos-roster-${WEEK}.pdf`);
    const { pages } = await textOf(res.rawPayload);
    const text = pages.join(" ");
    expect(text).toContain("Çarşamba");
    expect(text).toContain("Kasım");
    expect(text).toContain("İpek Aydın");
    expect(text).toContain("9–15 Kasım 2026 haftası");
  });

  it("the EN week roster has the title", async () => {
    const f = await fresh();
    const res = await f.manager(`/api/shifts/pdf/week?week=${WEEK}`);
    const { pages } = await textOf(res.rawPayload);
    expect(pages.join(" ")).toContain("Week of 9–15 Nov 2026");
  });

  it("the EN personal PDF has Deniz's shifts and total, and nobody else", async () => {
    const f = await fresh();
    const deniz = f.week.people.find((p) => p.name === "Deniz")!;
    const res = await f.manager(`/api/shifts/pdf/person/${deniz.id}?week=${WEEK}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain(`lodos-shifts-deniz-${WEEK}.pdf`);
    const { pages } = await textOf(res.rawPayload);
    expect(pages).toHaveLength(1);
    const text = pages[0]!;
    const mine = f.week.shifts.filter((s) => s.staffId === deniz.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) expect(text).toContain(`${s.start}–${s.end}`);
    const h = f.week.totals.byPerson[deniz.id]! / 60;
    expect(text).toContain(`${Number.isInteger(h) ? h : h.toFixed(1)} h`);
    for (const p of f.week.people.filter((p) => p.id !== deniz.id)) expect(text).not.toContain(p.name);
  });

  it("the people PDF has one page per person with shifts", async () => {
    const f = await fresh();
    const res = await f.manager(`/api/shifts/pdf/people?week=${WEEK}&lang=tr`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain(`lodos-shifts-all-${WEEK}.pdf`);
    const withShifts = new Set(f.week.shifts.map((s) => s.staffId));
    const { pages } = await textOf(res.rawPayload);
    expect(pages).toHaveLength(withShifts.size);
  });

  it("a waiter gets own PDF via /api/me, and 403 for others and manager PDFs", async () => {
    const f = await fresh();
    const me = await f.waiter(`/api/me/shifts/pdf?week=${WEEK}`);
    expect(me.statusCode).toBe(200);
    expect(me.headers["content-type"]).toBe("application/pdf");
    expect(me.headers["content-disposition"]).toContain(".pdf");
    const other = f.week.people.find((p) => p.name === "İpek Aydın")!;
    expect((await f.waiter(`/api/shifts/pdf/person/${other.id}?week=${WEEK}`)).statusCode).toBe(403);
    expect((await f.waiter(`/api/shifts/pdf/week?week=${WEEK}`)).statusCode).toBe(403);
    expect((await f.waiter(`/api/shifts/pdf/people?week=${WEEK}`)).statusCode).toBe(403);
  });

  it("rejects a bad lang and an unknown person", async () => {
    const f = await fresh();
    expect((await f.manager(`/api/shifts/pdf/week?week=${WEEK}&lang=de`)).statusCode).toBe(400);
    expect((await f.manager(`/api/shifts/pdf/person/000000000000000000000000?week=${WEEK}`)).statusCode).toBe(404);
  });
});
