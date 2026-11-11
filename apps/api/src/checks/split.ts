import { SHARE_LABELS, divide, type SplitBody } from "@lodos/shared";
import type { ClientSession, Types } from "mongoose";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { CheckChangedError, inCheckTransaction, markPaid, newPayment, type Payment } from "../floor/service";
import { isOid, notFound } from "../kds/service";
import { billOf, type Bill, type VatRate } from "./bill";

/**
 * Splitting a check (spec §3.1). The split lives on the check document; every share amount is derived here from the
 * bill on each read, except a paid share's, which is frozen in its payment. All functions must run inside the
 * check's tenant (the routes use `staffRoute`).
 */

type Id = string | Types.ObjectId;
type Name = { en: string; tr: string };
type StoredPayment = { method: "card" | "cash"; amount: number; at: Date; last4?: string | null };
export type StoredSplit = {
  mode: "even" | "items";
  count: number;
  shares: { label: string; payment?: StoredPayment | null }[];
  assignments: { unit: string; labels: string[] }[];
};
/** The parts of a check document `splitView` reads. */
export type SplitCheck = { _id: Id; status: "open" | "paid"; payment?: StoredPayment | null; split?: StoredSplit | null };

export type SplitUnit = {
  ref: string;
  lineRef: string;
  name: Name;
  options: Name[];
  /** Kuruş; 0 when comped. */
  unitAmount: number;
  station: "kitchen" | "bar";
  vatRate: VatRate;
  comp: { reason: string } | null;
  /** By item: the shares this unit is divided between, in label order. */
  labels: string[];
  /** It can't be reassigned: it is in a paid share, the Evenly split is locked, or the check is paid. */
  frozen: boolean;
};
export type SharePart = { ref: string; /** Kuruş of this unit for this share. */ part: number; parts: number };
export type ShareView = { label: string; amount: number; units: SharePart[]; payment: Payment | null };
export type SplitView = {
  checkId: string;
  tableName: string;
  status: "open" | "paid";
  total: number;
  mode: "full" | "even" | "items";
  count: number;
  /** Any share is paid. */
  locked: boolean;
  units: SplitUnit[];
  shares: ShareView[];
  /** Units worth more than ₺0 with no label (By item). */
  unassigned: { count: number; amount: number };
  paidCount: number;
  /** total − Σ paid. */
  left: number;
};

const LABEL_INDEX = new Map(SHARE_LABELS.map((l, i) => [l, i]));
const inLabelOrder = (labels: string[]) => [...labels].sort((a, b) => (LABEL_INDEX.get(a) ?? 99) - (LABEL_INDEX.get(b) ?? 99));
const paymentOf = (p: StoredPayment | null | undefined): Payment | null =>
  p ? { method: p.method, amount: p.amount, at: p.at, last4: p.last4 ?? null } : null;
const sameLabels = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

const splitLocked = (message: string) => new ApiError(409, "split_locked", message);
const invalid = (message: string) => new ApiError(400, "validation", message);
const checkClosed = () => new ApiError(409, "check_closed", "This check is already paid");

/** The close view's data: pure over the bill and the check's split (no database access). */
export function splitView(input: { check: SplitCheck; tableName: string; bill: Bill }): SplitView {
  const { check, tableName, bill } = input;
  const split = check.split ?? null;
  const paidLabels = new Set((split?.shares ?? []).filter((s) => s.payment != null).map((s) => s.label));
  const locked = paidLabels.size > 0;

  const labelsOf = new Map<string, string[]>();
  if (split?.mode === "items") for (const a of split.assignments) if (a.labels.length > 0) labelsOf.set(a.unit, inLabelOrder(a.labels));

  const units: SplitUnit[] = bill.lines.flatMap((line) =>
    line.units.map((u) => {
      const labels = labelsOf.get(u.ref) ?? [];
      return {
        ref: u.ref,
        lineRef: u.lineRef,
        name: line.name,
        options: line.options,
        unitAmount: u.unitAmount,
        station: line.station,
        vatRate: line.vatRate,
        comp: u.comp ? { reason: u.comp.reason } : null,
        labels,
        frozen: check.status === "paid" || (split?.mode === "even" && locked) || labels.some((l) => paidLabels.has(l)),
      };
    }),
  );
  const base = { checkId: String(check._id), tableName, status: check.status, total: bill.total, units };

  if (!split) {
    const payment = paymentOf(check.payment);
    return {
      ...base,
      mode: "full",
      count: 1,
      locked: false,
      shares: [{ label: "A", amount: bill.total, units: units.map((u) => ({ ref: u.ref, part: u.unitAmount, parts: 1 })), payment }],
      unassigned: { count: 0, amount: 0 },
      paidCount: payment ? 1 : 0,
      left: bill.total - (payment?.amount ?? 0),
    };
  }

  const paidSum = split.shares.reduce((n, s) => n + (s.payment?.amount ?? 0), 0);
  let shares: ShareView[];
  let unassigned = { count: 0, amount: 0 };
  if (split.mode === "even") {
    const unpaid = split.shares.filter((s) => s.payment == null).length;
    const amounts = unpaid > 0 ? divide(bill.total - paidSum, unpaid) : [];
    let next = 0;
    shares = split.shares.map((s) => ({
      label: s.label,
      amount: s.payment ? s.payment.amount : amounts[next++]!,
      units: [],
      payment: paymentOf(s.payment),
    }));
  } else {
    const parts = new Map<string, SharePart[]>();
    for (const u of units) {
      if (u.labels.length === 0) {
        if (u.unitAmount > 0) unassigned = { count: unassigned.count + 1, amount: unassigned.amount + u.unitAmount };
        continue;
      }
      const pieces = divide(u.unitAmount, u.labels.length);
      u.labels.forEach((label, i) => parts.set(label, [...(parts.get(label) ?? []), { ref: u.ref, part: pieces[i]!, parts: u.labels.length }]));
    }
    shares = split.shares.map((s) => {
      const own = parts.get(s.label) ?? [];
      return { label: s.label, amount: s.payment ? s.payment.amount : own.reduce((n, p) => n + p.part, 0), units: own, payment: paymentOf(s.payment) };
    });
  }
  return { ...base, mode: split.mode, count: split.count, locked, shares, unassigned, paidCount: paidLabels.size, left: bill.total - paidSum };
}

/**
 * The one auto-close rule for a split check, inside the caller's transaction: when every share is paid and nothing
 * worth more than ₺0 is unassigned, the check is closed with `markPaid` (status paid, closedAt, the table's open calls
 * answered). `view` must be computed from the check as just written in this transaction. Used by `payShare`,
 * `setSplit` (dropping the last unpaid, empty share) and adjustments (a void that removes the last unassigned unit).
 */
export async function closeIfSettled(
  models: Models,
  session: ClientSession,
  input: { checkId: Id; tableId: Id; view: SplitView; staffId: string; now: Date },
): Promise<{ closed: boolean; answeredCallIds: string[] }> {
  const { checkId, tableId, view, staffId, now } = input;
  const settled = view.mode !== "full" && view.status === "open" && view.shares.every((s) => s.payment != null) && view.unassigned.amount === 0;
  if (!settled) return { closed: false, answeredCallIds: [] };
  const { answeredCallIds } = await markPaid(models, session, { checkId, tableId, staffId, now });
  return { closed: true, answeredCallIds };
}

async function tableNameOf(models: Models, tableId: Id, session?: ClientSession): Promise<string> {
  return (await models.Table.findOne({ _id: tableId }, { name: 1 }).session(session ?? null).lean())?.name ?? "";
}

/** GET /api/checks/:id/split. */
export async function getSplit(models: Models, checkId: string): Promise<SplitView> {
  if (!isOid(checkId)) throw notFound();
  const check = await models.Check.findOne({ _id: checkId }).lean<SplitCheck & { tableId: Types.ObjectId }>();
  if (!check) throw notFound();
  const [bill, tableName] = await Promise.all([billOf(models, check._id), tableNameOf(models, check.tableId)]);
  return splitView({ check, tableName, bill });
}

/**
 * PUT /api/checks/:id/split. One transaction that writes the check (`$inc splitVersion`), so it write-conflicts with
 * `placeOrder`, `payShare`, `closeCheck` and adjustments and is re-run on a fresh snapshot.
 * Locks (409 `split_locked`) once any share is paid: the mode can't change, nor an Evenly count; By item can add
 * letters but not drop a paid one, and a unit in a paid share (or a unit moving into one) keeps its labels.
 * A change that leaves every share paid and nothing unassigned (e.g. dropping an empty unpaid letter) closes the check.
 */
export type SetSplitResult = {
  view: SplitView;
  tableId: string;
  /** The change settled the check (every share paid, nothing unassigned), so it was closed. */
  closed: boolean;
  answeredCallIds: string[];
};

export async function setSplit(
  models: Models,
  input: { checkId: string; body: SplitBody; staffId: string; now: Date },
): Promise<SetSplitResult> {
  const { checkId, body, staffId, now } = input;
  if (!isOid(checkId)) throw notFound();
  return inCheckTransaction(models, async (session) => {
    const check = await models.Check.findOne({ _id: checkId }).session(session).lean<SplitCheck & { tableId: Types.ObjectId }>();
    if (!check) throw notFound();
    if (check.status === "paid") throw checkClosed();
    const bill = await billOf(models, check._id, session);
    const current = check.split ?? null;
    const paid = (current?.shares ?? []).filter((s) => s.payment != null);
    const paidLabels = new Set(paid.map((s) => s.label));

    let next: StoredSplit | null = null;
    if (body.mode === "full") {
      if (paid.length > 0) throw splitLocked("Part of this check is already paid");
    } else {
      if (current && paid.length > 0 && current.mode !== body.mode) throw splitLocked("The split mode can't change once a share is paid");
      if (current && paid.length > 0 && body.mode === "even" && current.count !== body.count) {
        throw splitLocked("The number of shares can't change once a share is paid");
      }
      const labels = SHARE_LABELS.slice(0, body.count);
      if (paid.some((s) => !labels.includes(s.label))) throw splitLocked("A paid share can't be removed");
      const shares = labels.map((label) => ({ label, payment: current?.shares.find((s) => s.label === label)?.payment ?? null }));

      let assignments: StoredSplit["assignments"] = [];
      if (body.mode === "items") {
        const refs = new Set(bill.lines.flatMap((l) => l.units.map((u) => u.ref)));
        const seen = new Set<string>();
        for (const a of body.assignments) {
          if (!refs.has(a.unit)) throw invalid(`Unknown unit ${a.unit}`);
          if (seen.has(a.unit)) throw invalid(`Unit ${a.unit} is listed twice`);
          seen.add(a.unit);
          if (new Set(a.labels).size !== a.labels.length || a.labels.some((l) => !labels.includes(l))) throw invalid(`Invalid labels for unit ${a.unit}`);
        }
        assignments = body.assignments.filter((a) => a.labels.length > 0).map((a) => ({ unit: a.unit, labels: inLabelOrder(a.labels) }));
        if (paidLabels.size > 0) {
          const before = new Map((current?.mode === "items" ? current.assignments : []).map((a) => [a.unit, inLabelOrder(a.labels)]));
          const after = new Map(assignments.map((a) => [a.unit, a.labels]));
          for (const ref of refs) {
            const was = before.get(ref) ?? [];
            const will = after.get(ref) ?? [];
            if ((was.some((l) => paidLabels.has(l)) || will.some((l) => paidLabels.has(l))) && !sameLabels(was, will)) {
              throw splitLocked("Items in a paid share can't be moved");
            }
          }
        }
      }
      next = { mode: body.mode, count: body.count, shares, assignments };
    }

    const updated = await models.Check.findOneAndUpdate(
      { _id: check._id, status: "open" },
      { $set: { split: next }, $inc: { splitVersion: 1 } },
      { session, returnDocument: "after" },
    ).lean<SplitCheck>();
    if (!updated) throw new CheckChangedError();
    const tableName = await tableNameOf(models, check.tableId, session);
    const view = splitView({ check: updated, tableName, bill });
    const { closed, answeredCallIds } = await closeIfSettled(models, session, { checkId: check._id, tableId: check.tableId, view, staffId, now });
    return {
      view: closed ? splitView({ check: { ...updated, status: "paid" }, tableName, bill }) : view,
      tableId: String(check.tableId),
      closed,
      answeredCallIds,
    };
  });
}

export type PayShareResult = {
  /** False when the share was already paid (a double tap or another tablet): nothing was written. */
  changed: boolean;
  share: ShareView;
  /** The check is paid: this payment closed it (or, when `changed` is false, it already was). */
  closed: boolean;
  checkId: string;
  tableId: string;
  /** Calls at the table that closing the check answered. */
  answeredCallIds: string[];
};

/**
 * POST /api/checks/:id/shares/:label/pay. One transaction that writes the check, so two tablets paying the same share
 * (or a payment racing an order, a split change, a full close or an adjustment) write-conflict and the loser re-runs
 * on a fresh snapshot: a share is paid exactly once (the loser gets `changed: false` and the stored payment), and the
 * amount charged is the one computed in the same snapshot. When every share is paid and nothing is unassigned, the
 * check is closed in the same transaction (`closeIfSettled` → `markPaid`, shared with `closeCheck`).
 */
export async function payShare(
  models: Models,
  input: { checkId: string; label: string; method: "card" | "cash"; amount: number; staffId: string; now: Date },
): Promise<PayShareResult> {
  const { checkId, label, method, amount, staffId, now } = input;
  if (!isOid(checkId)) throw notFound();
  return inCheckTransaction(models, async (session) => {
    const check = await models.Check.findOne({ _id: checkId }).session(session).lean<SplitCheck & { tableId: Types.ObjectId }>();
    if (!check) throw notFound();
    const stored = check.split?.shares.find((s) => s.label === label);
    const ids = { checkId: String(check._id), tableId: String(check.tableId) };
    if (!stored?.payment) {
      if (check.status === "paid") throw checkClosed();
      if (!stored) throw notFound();
    }
    const bill = await billOf(models, check._id, session);
    const share = splitView({ check, tableName: "", bill }).shares.find((s) => s.label === label)!;
    if (stored?.payment) return { changed: false, share, closed: check.status === "paid", ...ids, answeredCallIds: [] };

    if (check.split!.mode === "items" && share.units.length === 0) throw new ApiError(409, "conflict", "This share has no items");
    if (amount !== share.amount) throw new ApiError(409, "amount_changed", "The amount of this share changed", { amount: share.amount });

    const updated = await models.Check.findOneAndUpdate(
      { _id: check._id, status: "open", "split.shares": { $elemMatch: { label, payment: null } } },
      { $set: { "split.shares.$.payment": newPayment(method, share.amount, now) }, $inc: { splitVersion: 1 } },
      { session, returnDocument: "after" },
    ).lean<SplitCheck>();
    if (!updated) throw new CheckChangedError();
    const after = splitView({ check: updated, tableName: "", bill });
    const paidShare = after.shares.find((s) => s.label === label)!;
    const { closed, answeredCallIds } = await closeIfSettled(models, session, { checkId: check._id, tableId: check.tableId, view: after, staffId, now });
    return { changed: true, share: paidShare, closed, ...ids, answeredCallIds };
  });
}
