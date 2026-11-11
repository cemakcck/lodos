import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { runWithTenant } from "../src/db/tenancy";
import { csvField } from "../src/sales/service";
import { itemNamed, makeTestApp, orderBody, seedTenant, type TestApp } from "./helpers";

/** 21:30 Istanbul on Tuesday 2026-11-10 (service day 2026-11-10). */
const NOW = new Date("2026-11-10T18:30:00Z");
const at = (iso: string) => new Date(iso);

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ now: NOW });
});
afterAll(() => t.close());

type Seeded = Awaited<ReturnType<typeof seedTenant>>;
type Req = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload?: object) => ReturnType<TestApp["inject"]>;
type Sum = { count: number; amount: number };
type Totals = { revenue: number; covers: number; checks: number; avgPerCover: number; avgPerCheck: number; comps: Sum; voids: Sum; compsPct: number };
type View = {
  range: string;
  from: string;
  to: string;
  current: Totals;
  previous: Totals;
  byHour: { hour: number; revenue: number }[];
  ticketTimes: { kitchen: { hour: number; avgMin: number }[]; bar: { hour: number; avgMin: number }[] };
  thresholdMin: number;
  topItems: { name: { en: string; tr: string }; qty: number; revenue: number }[];
  log: { at: string; kind: string; itemName: { en: string; tr: string }; tableName: string; reason: string; note: string | null; requestedByName: string; approvedByName: string; amount: number; reversed: boolean }[];
};

async function session(s: Seeded, who: "waiter" | "manager"): Promise<Req> {
  const sid = await createSession(t.models, s.seed.staff[who], s.tenantId, "person", t.clock.now());
  return (method, path, payload) => t.inject({ method, url: path, cookies: { lodos_sid: sid }, ...(payload ? { payload } : {}) });
}

/** A tenant without live service or generated history (unless `live`), at `now`. */
async function tenant(now: Date = NOW, live = false) {
  t.clock.set(now);
  const s = await seedTenant(t, { liveService: live });
  const w = await session(s, "waiter");
  const m = await session(s, "manager");
  const inTenant = <T>(fn: () => PromiseLike<T>) => runWithTenant(s.tenantId, fn);
  const seat = async (table: string, covers: number) => {
    const res = await w("POST", `/api/tables/${s.seed.tables[table]!.id}/seat`, { covers });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().checkId as string;
  };
  const order = async (table: string, items: { itemId: string; qty?: number }[]) => {
    const res = await w("POST", `/api/tables/${s.seed.tables[table]!.id}/orders`, orderBody(items));
    expect(res.statusCode, res.body).toBe(201);
    return res.json().orderId as string;
  };
  const close = async (checkId: string, method: "card" | "cash") => {
    const res = await w("POST", `/api/checks/${checkId}/close`, { method });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().check.payment.amount as number;
  };
  const view = async (range: string) => {
    const res = await m("GET", `/api/sales?range=${range}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as View;
  };
  const csv = async (range: string) => {
    const res = await m("GET", `/api/sales/export.csv?range=${range}`);
    expect(res.statusCode, res.body).toBe(200);
    return res;
  };
  return { s, w, m, inTenant, seat, order, close, view, csv };
}

const DAY_MS = 24 * 3_600_000;
/** The service day `n` days before 2026-11-10. */
const daysBefore = (n: number) => new Date(Date.parse("2026-11-10T12:00:00Z") - n * DAY_MS).toISOString().slice(0, 10);

const storedDay = (serviceDay: string, over: Record<string, unknown> = {}) => ({
  serviceDay,
  revenue: 0,
  covers: 0,
  checks: 0,
  comps: { count: 0, amount: 0 },
  voids: { count: 0, amount: 0 },
  byHour: [],
  ticketTimes: { kitchen: [], bar: [] },
  items: [],
  payments: { card: 0, cash: 0 },
  generated: true,
  ...over,
});

const adjustment = (serviceDay: string, atIso: string, kind: "comp" | "void", amount: number, over: Record<string, unknown> = {}) => ({
  qty: 1,
  kind,
  reason: kind === "comp" ? "celebration" : "wrong_item",
  amount,
  itemName: { en: "Burrata", tr: "Burrata" },
  tableName: "T3",
  station: "kitchen" as const,
  requestedByName: "Deniz",
  approvedByName: "Selin",
  at: at(atIso),
  serviceDay,
  ...over,
});

/** Minimal RFC 4180 parser: quoted fields with doubled quotes, CRLF or LF rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n") {
      endField();
      rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}

const HEADER = "service_day,closed_at,table,covers,server,gross,comps,voids,total,payment_methods";
const lira = (kurus: number) => (kurus / 100).toFixed(2);

describe("sales ranges", () => {
  it("7d: from..to is 7 service days ending today; previous is the 7 before (counted); averages and merges", async () => {
    const c = await tenant();
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    // Past days 1..14 each: 1 check, 2 covers, ₺10 at 20:00. Day 15 must never be read.
    await c.inTenant(async () => {
      for (let n = 1; n <= 15; n++) {
        const revenue = n === 15 ? 99_999_900 : 1000;
        await t.models.DailySummary.create(
          storedDay(daysBefore(n), {
            revenue,
            checks: 1,
            covers: 2,
            byHour: [{ hour: 20, revenue, covers: 2, checks: 1, comps: 0 }],
            ...(n === 1 ? { ticketTimes: { kitchen: [{ hour: 20, count: 2, totalMs: 1_200_000 }], bar: [] } } : {}),
            ...(n === 2 ? { ticketTimes: { kitchen: [{ hour: 20, count: 1, totalMs: 900_000 }], bar: [{ hour: 19, count: 1, totalMs: 240_000 }] } } : {}),
            items:
              n <= 6
                ? [
                    { itemId: "a", name: { en: "Alpha", tr: "Alfa" }, qty: 2, revenue: 600 },
                    { itemId: "b", name: { en: "Beta", tr: "Beta" }, qty: 1, revenue: 400 },
                  ]
                : [],
            comps: n <= 6 ? { count: 1, amount: 100 } : { count: 0, amount: 0 },
          }),
        );
      }
    });
    // Today, live: one check (3 covers), fries, closed now (21:30).
    const check = await c.seat("T7", 3);
    await c.order("T7", [{ itemId: fries.id }]);
    const paid = await c.close(check, "card");

    const v = await c.view("7d");
    expect(v.range).toBe("7d");
    expect(v.from).toBe("2026-11-04");
    expect(v.to).toBe("2026-11-10");
    // 6 stored days + today live.
    expect(v.current).toMatchObject({ revenue: 6000 + paid, checks: 7, covers: 15, comps: { count: 6, amount: 600 }, voids: { count: 0, amount: 0 } });
    expect(v.current.avgPerCover).toBe(Math.round((6000 + paid) / 15));
    expect(v.current.avgPerCheck).toBe(Math.round((6000 + paid) / 7));
    expect(v.current.compsPct).toBe(Math.round((600 / (6000 + paid)) * 1000) / 10);
    // Previous: exactly days 7..13, each counted once (7 checks, 7 × ₺10); day 15 never.
    expect(v.previous).toMatchObject({ revenue: 7000, checks: 7, covers: 14, avgPerCover: 500, avgPerCheck: 1000, compsPct: 0 });
    // Average per night over the 7 nights with checks.
    expect(v.byHour).toEqual([
      { hour: 20, revenue: Math.round(6000 / 7) },
      { hour: 21, revenue: Math.round(paid / 7) },
    ]);
    expect(v.ticketTimes.kitchen).toEqual([{ hour: 20, avgMin: 11.7 }]); // (1.2M + 0.9M) / 3 / 60k
    expect(v.ticketTimes.bar).toEqual([{ hour: 19, avgMin: 4 }]);
    expect(v.thresholdMin).toBe(15);
    expect(v.topItems.slice(0, 3)).toEqual([
      { name: { en: "Alpha", tr: "Alfa" }, qty: 12, revenue: 3600 },
      { name: { en: "Beta", tr: "Beta" }, qty: 6, revenue: 2400 },
      expect.objectContaining({ qty: 1, revenue: paid }),
    ]);

    const today = await c.view("today");
    expect([today.from, today.to]).toEqual(["2026-11-10", "2026-11-10"]);
    const month = await c.view("30d");
    expect([month.from, month.to]).toEqual(["2026-10-12", "2026-11-10"]);
  });

  it("today at 21:30: previous sums last week's same weekday buckets for hours 6..21 only", async () => {
    const c = await tenant();
    const last = "2026-11-03";
    await c.inTenant(async () => {
      await t.models.DailySummary.create(
        storedDay(last, {
          revenue: 1500 + 99_000,
          covers: 9,
          checks: 4,
          byHour: [
            { hour: 6, revenue: 50, covers: 0, checks: 0, comps: 0 },
            { hour: 18, revenue: 100, covers: 1, checks: 1, comps: 0 },
            { hour: 21, revenue: 200, covers: 2, checks: 1, comps: 30 },
            { hour: 22, revenue: 400, covers: 4, checks: 1, comps: 70 },
            { hour: 1, revenue: 99_000, covers: 2, checks: 1, comps: 0 },
          ],
        }),
      );
      // 21:10 comp counts; 22:30 void and the reversed 20:00 comp don't.
      await t.models.Adjustment.insertMany([
        adjustment(last, "2026-11-03T18:10:00Z", "comp", 30),
        adjustment(last, "2026-11-03T19:30:00Z", "void", 70),
        adjustment(last, "2026-11-03T17:00:00Z", "comp", 999, { reversedAt: at("2026-11-03T17:05:00Z") }),
      ]);
    });
    const v = await c.view("today");
    expect(v.previous).toEqual({
      revenue: 350,
      covers: 3,
      checks: 2,
      avgPerCover: Math.round(350 / 3),
      avgPerCheck: 175,
      comps: { count: 1, amount: 30 },
      voids: { count: 0, amount: 0 },
      compsPct: 8.6,
    });
    expect(v.current.revenue).toBe(0);
    expect(v.current.avgPerCover).toBe(0);
    expect(v.current.compsPct).toBe(0);
  });

  it("today: comps and voids made today are in the totals and the log (reversed flagged, newest first)", async () => {
    const c = await tenant(at("2026-11-10T17:00:00Z"));
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    const check = await c.seat("T7", 2);
    const order = await c.order("T7", [{ itemId: burrata.id, qty: 3 }]);
    const comp = await c.m("POST", `/api/checks/${check}/adjustments`, { lineRef: `${order}:0`, kind: "comp", qty: 1, reason: "celebration", note: "birthday" });
    expect(comp.statusCode, comp.body).toBe(201);
    t.clock.set(at("2026-11-10T17:10:00Z"));
    const second = await c.m("POST", `/api/checks/${check}/adjustments`, { lineRef: `${order}:0`, kind: "comp", qty: 1, reason: "celebration" });
    expect(second.statusCode, second.body).toBe(201);
    const ids = await c.inTenant(() => t.models.Adjustment.find({}).sort({ at: 1 }).lean());
    t.clock.set(at("2026-11-10T17:20:00Z"));
    expect((await c.m("DELETE", `/api/checks/${check}/adjustments/${String(ids[1]!._id)}`)).statusCode).toBe(200);
    // A generated entry from last week stays out of today's log.
    await c.inTenant(() => t.models.Adjustment.create(adjustment("2026-11-03", "2026-11-03T18:10:00Z", "comp", 30)));

    const v = await c.view("today");
    expect(v.current.comps).toEqual({ count: 1, amount: burrata.price });
    expect(v.log).toHaveLength(2);
    expect(v.log[0]).toMatchObject({ kind: "comp", reversed: true, tableName: "T7", amount: burrata.price });
    expect(v.log[1]).toEqual({
      at: "2026-11-10T17:00:00.000Z",
      kind: "comp",
      itemName: { en: expect.stringMatching(/^Burrata/), tr: expect.any(String) },
      tableName: "T7",
      reason: "celebration",
      note: "birthday",
      requestedByName: "Selin",
      approvedByName: "Selin",
      amount: burrata.price,
      reversed: false,
    });
  });

  it("a closed check with a comp and a void: revenue is the charged total; comps and voids are counted beside it", async () => {
    const c = await tenant(at("2026-11-10T17:00:00Z"));
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    const check = await c.seat("T7", 2);
    const order = await c.order("T7", [{ itemId: burrata.id, qty: 3 }]);
    for (const kind of ["comp", "void"] as const) {
      const r = await c.m("POST", `/api/checks/${check}/adjustments`, { lineRef: `${order}:0`, kind, qty: 1, reason: kind === "comp" ? "celebration" : "wrong_item" });
      expect(r.statusCode, r.body).toBe(201);
    }
    expect(await c.close(check, "card")).toBe(burrata.price);
    const v = await c.view("today");
    expect(v.current).toMatchObject({ revenue: burrata.price, checks: 1, covers: 2, comps: { count: 1, amount: burrata.price }, voids: { count: 1, amount: burrata.price } });
  });

  it("share payments count in today's revenue when they are made (moved from the Tonight endpoint)", async () => {
    const c = await tenant();
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    const check = await c.seat("T7", 3);
    await c.order("T7", [{ itemId: burrata.id, qty: 3 }]);
    expect((await c.w("PUT", `/api/checks/${check}/split`, { mode: "even", count: 3 })).statusCode).toBe(200);
    const shares = (await c.w("GET", `/api/checks/${check}/split`)).json().shares as { label: string; amount: number }[];
    const revenue = async () => (await c.view("today")).current.revenue;
    expect(await revenue()).toBe(0);
    expect((await c.w("POST", `/api/checks/${check}/shares/A/pay`, { method: "card", amount: shares[0]!.amount })).statusCode).toBe(200);
    expect(await revenue()).toBe(shares[0]!.amount);
    for (const sh of shares.slice(1)) expect((await c.w("POST", `/api/checks/${check}/shares/${sh.label}/pay`, { method: "cash", amount: sh.amount })).statusCode).toBe(200);
    expect(await revenue()).toBe(3 * burrata.price);
  });

  it("service-day boundary: a payment at 05:59 on D+1 is in D, at 06:00 in D+1", async () => {
    const c = await tenant(at("2026-11-11T02:30:00Z"));
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const a = await c.seat("T7", 2);
    await c.order("T7", [{ itemId: fries.id }]);
    const b = await c.seat("T8", 4);
    await c.order("T8", [{ itemId: fries.id, qty: 2 }]);
    t.clock.set(at("2026-11-11T02:59:00Z")); // 05:59
    await c.close(a, "card");
    t.clock.set(at("2026-11-11T03:00:00Z")); // 06:00
    await c.close(b, "cash");

    t.clock.set(at("2026-11-11T10:00:00Z"));
    const today = await c.view("today");
    expect(today.from).toBe("2026-11-11");
    expect(today.current).toMatchObject({ revenue: 2 * fries.price, checks: 1, covers: 4 });
    const week = await c.view("7d");
    expect(week.current).toMatchObject({ revenue: 3 * fries.price, checks: 2, covers: 6 });

    const rows = parseCsv((await c.csv("7d")).body.slice(1));
    expect(rows.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual([
      ["2026-11-10", "2026-11-11 05:59", "T7"],
      ["2026-11-11", "2026-11-11 06:00", "T8"],
    ]);
    const todayRows = parseCsv((await c.csv("today")).body.slice(1));
    expect(todayRows.slice(1).map((r) => r[2])).toEqual(["T8"]);
  });
});

describe("CSV export", () => {
  it("one row per paid check in the range; amounts match the checks and the bill", async () => {
    const c = await tenant(NOW, true); // the seed's paid checks tonight, one with a comp
    const burrata = await itemNamed(t, c.s.tenantId, "Burrata");
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    // A free table: split evenly, paid card + cash, with a void.
    const open = new Set((await c.inTenant(() => t.models.Check.find({ status: "open" }).lean())).map((x) => String(x.tableId)));
    const free = Object.keys(c.s.seed.tables).find((n) => !open.has(c.s.seed.tables[n]!.id) && n.startsWith("T"))!;
    const check = await c.seat(free, 2);
    const order = await c.order(free, [{ itemId: burrata.id }, { itemId: fries.id, qty: 2 }]);
    expect((await c.m("POST", `/api/checks/${check}/adjustments`, { lineRef: `${order}:1`, kind: "void", qty: 1, reason: "wrong_item" })).statusCode).toBe(201);
    expect((await c.w("PUT", `/api/checks/${check}/split`, { mode: "even", count: 2 })).statusCode).toBe(200);
    const shares = (await c.w("GET", `/api/checks/${check}/split`)).json().shares as { label: string; amount: number }[];
    expect((await c.w("POST", `/api/checks/${check}/shares/A/pay`, { method: "cash", amount: shares[0]!.amount })).statusCode).toBe(200);
    expect((await c.w("POST", `/api/checks/${check}/shares/B/pay`, { method: "card", amount: shares[1]!.amount })).statusCode).toBe(200);

    const paid = await c.inTenant(() => t.models.Check.find({ status: "paid" }).lean());
    expect(paid.length).toBeGreaterThanOrEqual(4);
    const paidTotal = paid.reduce((n, x) => n + (x.payment?.amount ?? 0) + (x.split?.shares ?? []).reduce((k, s) => k + (s.payment?.amount ?? 0), 0), 0);

    const res = await c.csv("today");
    const rows = parseCsv(res.body.slice(1));
    expect(rows[0]!.join(",")).toBe(HEADER);
    const data = rows.slice(1);
    expect(data).toHaveLength(paid.length);
    const num = (s: string) => Math.round(Number(s) * 100);
    expect(data.reduce((n, r) => n + num(r[8]!), 0)).toBe(paidTotal);
    for (const r of data) {
      expect(r).toHaveLength(10);
      expect(num(r[5]!) - num(r[6]!) - num(r[7]!)).toBe(num(r[8]!));
      for (const i of [5, 6, 7, 8]) expect(r[i]).toMatch(/^\d+\.\d{2}$/);
    }
    expect(data.some((r) => num(r[6]!) > 0)).toBe(true); // the seed's comped check
    const mine = data.find((r) => r[2] === free)!;
    expect(mine).toEqual([
      "2026-11-10",
      "2026-11-10 21:30",
      free,
      "2",
      "Deniz",
      lira(burrata.price + 2 * fries.price),
      "0.00",
      lira(fries.price),
      lira(burrata.price + fries.price),
      "card+cash",
    ]);
    // The view agrees with the export.
    expect((await c.view("today")).current.checks).toBe(paid.length);
  });

  it("CSV starts with a BOM and quotes Turkish names", async () => {
    const c = await tenant();
    await c.inTenant(() => t.models.Staff.updateOne({ _id: c.s.seed.staff.waiter }, { name: "Şule Çınar" }));
    const fries = await itemNamed(t, c.s.tenantId, "Truffle fries");
    const check = await c.seat("T7", 2);
    await c.order("T7", [{ itemId: fries.id }]);
    await c.close(check, "cash");

    const res = await c.csv("today");
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="lodos-sales-2026-11-10-2026-11-10.csv"');
    const raw = res.rawPayload;
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(res.body.startsWith("﻿" + HEADER + "\r\n")).toBe(true);
    const line = res.body.split("\r\n")[1]!;
    expect(line).toBe(`"2026-11-10","2026-11-10 21:30","T7",2,"Şule Çınar",${lira(fries.price)},0.00,0.00,${lira(fries.price)},"cash"`);
    expect(parseCsv(res.body.slice(1))[1]![4]).toBe("Şule Çınar");
  });

  it("text fields double their quotes", () => {
    expect(csvField('Ali "Kuzu" Şiş')).toBe('"Ali ""Kuzu"" Şiş"');
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("text fields that a spreadsheet would read as a formula get a leading apostrophe", () => {
    for (const x of ["=SUM(A1:A9)", "+90 555", "-1", "@cmd", "\tTab", "\rCR"]) expect(csvField(x)).toBe(`"'${x}"`);
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("Ali=Veli")).toBe('"Ali=Veli"');
    expect(csvField("")).toBe('""');
  });
});

describe("guards", () => {
  it("a waiter gets 403, anonymous 401, an unknown range 400; Tonight is gone", async () => {
    const c = await tenant();
    for (const url of ["/api/sales?range=7d", "/api/sales/export.csv?range=7d"]) {
      expect((await c.w("GET", url)).statusCode).toBe(403);
      expect((await t.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect((await c.m("GET", "/api/sales?range=week")).statusCode).toBe(400);
    expect((await c.m("GET", "/api/sales/export.csv?range=1y")).statusCode).toBe(400);
    expect((await c.m("GET", "/api/manager/tonight")).statusCode).toBe(404);
  });
});
