import { AdjustBody, PayShareBody, SHARE_LABELS, SplitBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { approve, listApprovers } from "../auth/approval";
import { staffRoute } from "../auth/guard";
import { notFound } from "../kds/service";
import type { Audience, Realtime } from "../realtime/emit";
import { addAdjustment, assertCheckExists, reverseAdjustment, type AdjustResult, type ReverseResult } from "./adjust";
import { receiptView } from "./receipt";
import { getSplit, payShare, setSplit } from "./split";

const WAITER = ["waiter"] as const;
const MANAGER = ["manager"] as const;
/** Split changes interest the staff only; the guest page learns about a close through `check.updated`. */
const SPLIT_AUDIENCE: readonly Audience[] = ["floor", "manager"];
const TABLE_AUDIENCE: readonly Audience[] = ["floor", "manager", "table"];

/** A split check was settled and closed: the answered calls, then the check (the guest page shows "visit ended"). */
function emitClosed(realtime: Realtime, tenantId: string, checkId: string, tableId: string, answeredCallIds: string[]): void {
  if (answeredCallIds.length > 0) realtime.emit(tenantId, "call.answered", { ids: answeredCallIds, tableId }, TABLE_AUDIENCE);
  realtime.emit(tenantId, "check.updated", { ids: [checkId], tableId }, TABLE_AUDIENCE);
}

/**
 * After an adjustment (or its reversal) committed: the adjustment to floor, managers, the table and the line's station;
 * a void's ticket to the station; returned portions to everyone; a split's new share amounts to the staff.
 */
function emitAdjusted(realtime: Realtime, tenantId: string, r: AdjustResult | ReverseResult): void {
  const { tableId, checkId } = r;
  realtime.emit(tenantId, "adjustment.changed", { ids: [r.adjustment.id], tableId }, [...TABLE_AUDIENCE, r.station]);
  if (r.ticketIds.length > 0) realtime.emit(tenantId, "ticket.updated", { ids: r.ticketIds, tableId }, [r.station]);
  if (r.availabilityChanged.length > 0) realtime.emit(tenantId, "availability.changed", { ids: r.availabilityChanged }, ["all"]);
  if (r.split) realtime.emit(tenantId, "split.updated", { ids: [checkId], tableId }, SPLIT_AUDIENCE);
}

type IdParams = { Params: { id: string } };
type AdjParams = { Params: { id: string; adjId: string } };
type ShareParams = { Params: { id: string; label: string } };

/** Closing the check by share (waiter + manager). Events go out after the transaction has committed. */
export function registerCheckRoutes(app: FastifyInstance): void {
  app.get<IdParams>(
    "/api/checks/:id/split",
    staffRoute(WAITER, async (req) => getSplit(req.server.models, req.params.id)),
  );

  app.put<IdParams>(
    "/api/checks/:id/split",
    staffRoute(WAITER, async (req) => {
      const body = SplitBody.parse(req.body);
      const r = await setSplit(req.server.models, { checkId: req.params.id, body, staffId: req.staff.id, now: req.server.clock.now() });
      req.server.realtime.emit(req.staff.tenantId, "split.updated", { ids: [r.view.checkId], tableId: r.tableId }, SPLIT_AUDIENCE);
      if (r.closed) emitClosed(req.server.realtime, req.staff.tenantId, r.view.checkId, r.tableId, r.answeredCallIds);
      return r.view;
    }),
  );

  app.post<ShareParams>(
    "/api/checks/:id/shares/:label/pay",
    staffRoute(WAITER, async (req) => {
      if (!SHARE_LABELS.includes(req.params.label)) throw notFound();
      const { method, amount } = PayShareBody.parse(req.body);
      const r = await payShare(req.server.models, {
        checkId: req.params.id,
        label: req.params.label,
        method,
        amount,
        staffId: req.staff.id,
        now: req.server.clock.now(),
      });
      if (r.changed) {
        const { tenantId } = req.staff;
        const ids = [r.checkId];
        req.server.realtime.emit(tenantId, "split.updated", { ids, tableId: r.tableId }, SPLIT_AUDIENCE);
        if (r.closed) emitClosed(req.server.realtime, tenantId, r.checkId, r.tableId, r.answeredCallIds);
      }
      return { changed: r.changed, share: r.share, closed: r.closed };
    }),
  );

  app.get<IdParams & { Querystring: { share?: string } }>(
    "/api/checks/:id/receipt",
    staffRoute(WAITER, async (req) => receiptView(req.server.models, req.params.id, { share: req.query.share ?? null, now: req.server.clock.now() })),
  );

  app.get(
    "/api/approvers",
    staffRoute(WAITER, async (req) => listApprovers(req.server.models)),
  );

  app.post<IdParams>(
    "/api/checks/:id/adjustments",
    staffRoute(WAITER, async (req, reply) => {
      const body = AdjustBody.parse(req.body);
      const { models, clock } = req.server;
      await assertCheckExists(models, req.params.id);
      // Outside the transaction: argon2 is slow.
      const approver = await approve(models, { tenantId: req.staff.tenantId, ip: req.ip, approval: body.approval, requester: req.staff, now: clock.now() });
      const r = await addAdjustment(models, { checkId: req.params.id, body, requester: req.staff, approver, now: clock.now() });
      emitAdjusted(req.server.realtime, req.staff.tenantId, r);
      if (r.closed) emitClosed(req.server.realtime, req.staff.tenantId, r.checkId, r.tableId, r.answeredCallIds);
      return reply.status(201).send({ adjustment: r.adjustment });
    }),
  );

  app.delete<AdjParams>(
    "/api/checks/:id/adjustments/:adjId",
    staffRoute(MANAGER, async (req) => {
      const r = await reverseAdjustment(req.server.models, {
        checkId: req.params.id,
        adjustmentId: req.params.adjId,
        staffId: req.staff.id,
        now: req.server.clock.now(),
      });
      if (r.changed) emitAdjusted(req.server.realtime, req.staff.tenantId, r);
      return { changed: r.changed, adjustment: r.adjustment };
    }),
  );
}
