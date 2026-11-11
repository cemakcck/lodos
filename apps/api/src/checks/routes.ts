import { PayShareBody, SHARE_LABELS, SplitBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { notFound } from "../kds/service";
import type { Audience, Realtime } from "../realtime/emit";
import { getSplit, payShare, setSplit } from "./split";

const WAITER = ["waiter"] as const;
/** Split changes interest the staff only; the guest page learns about a close through `check.updated`. */
const SPLIT_AUDIENCE: readonly Audience[] = ["floor", "manager"];
const TABLE_AUDIENCE: readonly Audience[] = ["floor", "manager", "table"];

/** A split check was settled and closed: the answered calls, then the check (the guest page shows "visit ended"). */
function emitClosed(realtime: Realtime, tenantId: string, checkId: string, tableId: string, answeredCallIds: string[]): void {
  if (answeredCallIds.length > 0) realtime.emit(tenantId, "call.answered", { ids: answeredCallIds, tableId }, TABLE_AUDIENCE);
  realtime.emit(tenantId, "check.updated", { ids: [checkId], tableId }, TABLE_AUDIENCE);
}

type IdParams = { Params: { id: string } };
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
}
