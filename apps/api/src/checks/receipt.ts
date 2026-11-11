import { allocate, formatTRY, fractionLabel, vatBreakdown, vatOf } from "@lodos/shared";
import type { Types } from "mongoose";
import type { Models } from "../db/models";
import { isOid, notFound } from "../kds/service";
import type { Payment } from "../floor/service";
import { billOf, type Bill, type BillLine, type VatRate } from "./bill";
import { splitView, type ShareView, type SplitCheck } from "./split";

/**
 * Receipt data for a whole check or one share of it (spec §3.3): the lines, the total, the KDV (VAT) per rate and how it
 * was paid. Printing the same receipt is the web's job; every amount here comes from `billOf` and `splitView`.
 */

type Name = { en: string; tr: string };
export type ReceiptLine = { label: string; name: Name; options: Name[]; amount: number; comp: string | null };
export type ReceiptView = {
  table: { name: string };
  checkNo: string;
  serverName: string | null;
  covers: number | null;
  printedAt: Date;
  openedAt: Date;
  closedAt: Date | null;
  share: { label: string; index: number; of: number } | null;
  lines: ReceiptLine[];
  total: number;
  vat: { rate: VatRate; amount: number }[];
  payment: Payment | null;
  /** A whole-check receipt of a check closed by shares: how each share was paid (empty otherwise). */
  payments: { label: string; method: "card" | "cash"; amount: number; last4: string | null }[];
  /** Active comps on the whole check. */
  comps: { count: number; amount: number };
  paid: boolean;
};

type ReceiptCheck = SplitCheck & {
  tableId: Types.ObjectId;
  serverStaffId?: Types.ObjectId | null;
  covers?: number | null;
  openedAt: Date;
  closedAt?: Date | null;
};

/** `#0427`-style number derived from the check id (plan ruling "Check number"). */
export const checkNumber = (id: string): string => String(parseInt(id.slice(-6), 16) % 10000).padStart(4, "0");

const times = (n: number, rest: string) => [n > 1 ? `${n} ×` : "", rest].filter(Boolean).join(" ");

function wholeLines(bill: Bill): ReceiptLine[] {
  return bill.lines.flatMap((l) => {
    const charged = l.qty - l.compedQty - l.voidedQty;
    const out: ReceiptLine[] = [];
    if (charged > 0) out.push({ label: charged > 1 ? `${charged} ×` : "", name: l.name, options: l.options, amount: l.lineTotal, comp: null });
    for (const u of l.units) if (u.comp) out.push({ label: "", name: l.name, options: l.options, amount: 0, comp: u.comp.reason });
    return out;
  });
}

function shareLines(bill: Bill, share: ShareView): { lines: ReceiptLine[]; gross: Record<VatRate, number> } {
  const unitLine = new Map<string, { line: BillLine; comp: string | null }>();
  for (const l of bill.lines) for (const u of l.units) unitLine.set(u.ref, { line: l, comp: u.comp?.reason ?? null });
  const gross: Record<VatRate, number> = { 10: 0, 20: 0 };
  const groups = new Map<string, { line: BillLine; parts: number; n: number; amount: number }>();
  const comped: ReceiptLine[] = [];
  const order = new Map(bill.lines.map((l, i) => [l.lineRef, i]));
  for (const p of share.units) {
    const hit = unitLine.get(p.ref);
    if (!hit) continue;
    gross[hit.line.vatRate] += p.part;
    if (hit.comp) {
      comped.push({ label: "", name: hit.line.name, options: hit.line.options, amount: 0, comp: hit.comp });
      continue;
    }
    const key = `${hit.line.lineRef}|${p.parts}`;
    const g = groups.get(key) ?? { line: hit.line, parts: p.parts, n: 0, amount: 0 };
    g.n++;
    g.amount += p.part;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => order.get(a.line.lineRef)! - order.get(b.line.lineRef)! || a.parts - b.parts);
  const lines = sorted.map((g): ReceiptLine => ({ label: times(g.n, fractionLabel(g.parts)), name: g.line.name, options: g.line.options, amount: g.amount, comp: null }));
  return { lines: [...lines, ...comped], gross };
}

/** GET /api/checks/:id/receipt?share=A (and /print, the whole check). Unknown check or share label → 404. */
export async function receiptView(models: Models, checkId: string, opts: { share: string | null; now: Date }): Promise<ReceiptView> {
  if (!isOid(checkId)) throw notFound();
  const check = await models.Check.findOne({ _id: checkId }).lean<ReceiptCheck>();
  if (!check) throw notFound();
  const [bill, table, server] = await Promise.all([
    billOf(models, check._id),
    models.Table.findOne({ _id: check.tableId }, { name: 1 }).lean(),
    check.serverStaffId ? models.Staff.findById(check.serverStaffId, { name: 1 }).lean() : null,
  ]);
  const view = splitView({ check, tableName: table?.name ?? "", bill });
  const id = String(check._id);
  const checkNo = checkNumber(id);

  let lines: ReceiptLine[];
  let total: number;
  let vat: ReceiptView["vat"];
  let payment: Payment | null;
  let shareInfo: ReceiptView["share"] = null;
  let paid: boolean;
  let payments: ReceiptView["payments"] = [];

  if (opts.share === null) {
    lines = wholeLines(bill);
    total = bill.total;
    vat = vatBreakdown(bill.grossByRate).map((v) => ({ rate: v.rate, amount: v.vat }));
    payment = view.mode === "full" ? view.shares[0]!.payment : null;
    paid = check.status === "paid";
    if (view.mode !== "full") {
      payments = view.shares.flatMap((s) => (s.payment ? [{ label: s.label, method: s.payment.method, amount: s.payment.amount, last4: s.payment.last4 }] : []));
    }
  } else {
    const index = view.mode === "full" ? -1 : view.shares.findIndex((s) => s.label === opts.share);
    if (index < 0) throw notFound();
    const share = view.shares[index]!;
    shareInfo = { label: share.label, index, of: view.shares.length };
    total = share.amount;
    payment = share.payment;
    paid = share.payment != null;
    if (view.mode === "even") {
      const [g10, g20] = allocate(share.amount, [bill.grossByRate[10], bill.grossByRate[20]]) as [number, number];
      vat = ([[10, g10], [20, g20]] as const).filter(([, g]) => g > 0).map(([rate, g]) => ({ rate, amount: vatOf(g, rate) }));
      lines = [
        {
          label: fractionLabel(view.count),
          name: { en: `of check #${checkNo} (${formatTRY(bill.total, "en")})`, tr: `#${checkNo} hesabın (${formatTRY(bill.total, "tr")})` },
          options: [],
          amount: share.amount,
          comp: null,
        },
      ];
    } else {
      const r = shareLines(bill, share);
      lines = r.lines;
      vat = vatBreakdown(r.gross).map((v) => ({ rate: v.rate, amount: v.vat }));
    }
  }

  const active = bill.lines.flatMap((l) => l.adjustments).filter((a) => a.kind === "comp");
  return {
    table: { name: table?.name ?? "" },
    checkNo,
    serverName: server?.name ?? null,
    covers: check.covers ?? null,
    printedAt: opts.now,
    openedAt: check.openedAt,
    closedAt: check.closedAt ?? null,
    share: shareInfo,
    lines,
    total,
    vat,
    payment,
    payments,
    comps: { count: active.length, amount: bill.compsAmount },
    paid,
  };
}
