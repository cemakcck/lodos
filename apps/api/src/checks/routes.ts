import { PayShareBody, SHARE_LABELS, SplitBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { staffRoute } from "../auth/guard";
import { notFound } from "../kds/service";
import type { Audience } from "../realtime/emit";
import { getSplit, payShare, setSplit } from "./split";

const WAITER = ["waiter"] as const;
/** Split changes interest the staff only; the guest page learns about a close through `check.updated`. */
const SPLIT_AUDIENCE: readonly Audience[] = ["floor", "manager"];
const TABLE_AUDIENCE: readonly Audience[] = ["floor", "manager", "table"];

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
      const { view, tableId } = await setSplit(req.server.models, { checkId: req.params.id, body });
      req.server.realtime.emit(req.staff.tenantId, "split.updated", { ids: [view.checkId], tableId }, SPLIT_AUDIENCE);
      return view;
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
        if (r.closed) {
          if (r.answeredCallIds.length > 0) req.server.realtime.emit(tenantId, "call.answered", { ids: r.answeredCallIds, tableId: r.tableId }, TABLE_AUDIENCE);
          req.server.realtime.emit(tenantId, "check.updated", { ids, tableId: r.tableId }, TABLE_AUDIENCE);
        }
      }
      return { changed: r.changed, share: r.share, closed: r.closed };
    }),
  );
}
