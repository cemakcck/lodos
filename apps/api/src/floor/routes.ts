import { OrderRequest } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { staffRoute } from "../auth/guard";
import { isOid, notFound } from "../kds/service";
import { emitOrderPlaced, placeOrder } from "../orders/place";
import type { Audience } from "../realtime/emit";
import { answerCall, checkPrint, closeCheck, floorSnapshot, markServed, seatTable, tableCheck } from "./service";

const SeatBody = z.object({ covers: z.number().int().min(1).max(20) });
const CloseBody = z.object({ method: z.enum(["card", "cash"]) });

/** Everyone who follows a table: the floor, managers, and the table's guests. */
const TABLE_AUDIENCE: readonly Audience[] = ["floor", "manager", "table"];
const WAITER = ["waiter"] as const;

type IdParams = { Params: { id: string } };

/**
 * The waiter floor (waiter + manager). Every action emits after its write has committed, and only when it changed
 * something: a double tap (served, answer, close) returns 200 with the current state and no second event.
 */
export function registerFloorRoutes(app: FastifyInstance): void {
  app.get(
    "/api/floor",
    staffRoute(WAITER, async (req) => floorSnapshot(req.server.models, req.server.clock.now())),
  );

  app.get<IdParams>(
    "/api/tables/:id/check",
    staffRoute(WAITER, async (req) => tableCheck(req.server.models, req.params.id)),
  );

  app.post<IdParams>(
    "/api/tables/:id/seat",
    staffRoute(WAITER, async (req, reply) => {
      if (!isOid(req.params.id)) throw notFound();
      const { covers } = SeatBody.parse(req.body);
      const r = await seatTable(req.server.models, { tableId: req.params.id, covers, staffId: req.staff.id, now: req.server.clock.now() });
      req.server.realtime.emit(req.staff.tenantId, "check.updated", { ids: [r.checkId], tableId: r.tableId }, TABLE_AUDIENCE);
      return reply.status(r.opened ? 201 : 200).send(r);
    }),
  );

  app.post<IdParams>(
    "/api/tables/:id/orders",
    staffRoute(WAITER, async (req, reply) => {
      if (!isOid(req.params.id)) throw notFound();
      const body = OrderRequest.parse(req.body);
      const result = await placeOrder(req.server.models, {
        tableId: req.params.id,
        source: "staff",
        placedBy: req.staff.id,
        req: body,
        now: req.server.clock.now(),
      });
      emitOrderPlaced(req.server.realtime, req.staff.tenantId, result);
      return reply.status(result.replayed ? 200 : 201).send({
        orderId: String(result.order._id),
        checkId: String(result.order.checkId),
        ticketIds: result.tickets.map((t) => String(t._id)),
      });
    }),
  );

  app.post<IdParams>(
    "/api/tickets/:id/served",
    staffRoute(WAITER, async (req) => {
      const r = await markServed(req.server.models, req.params.id, req.server.clock.now());
      if (r.changed) {
        req.server.realtime.emit(req.staff.tenantId, "ticket.updated", { ids: [r.ticket.id], tableId: r.ticket.tableId }, [
          r.ticket.station,
          ...TABLE_AUDIENCE,
        ]);
      }
      return { ticket: r.ticket };
    }),
  );

  app.post<IdParams>(
    "/api/calls/:id/answer",
    staffRoute(WAITER, async (req) => {
      const r = await answerCall(req.server.models, { callId: req.params.id, staffId: req.staff.id, now: req.server.clock.now() });
      if (r.changed) {
        req.server.realtime.emit(req.staff.tenantId, "call.answered", { ids: [r.call.id], tableId: r.call.tableId }, TABLE_AUDIENCE);
      }
      return { call: r.call };
    }),
  );

  app.post<IdParams>(
    "/api/checks/:id/close",
    staffRoute(WAITER, async (req) => {
      if (!isOid(req.params.id)) throw notFound();
      const { method } = CloseBody.parse(req.body);
      const r = await closeCheck(req.server.models, { checkId: req.params.id, method, staffId: req.staff.id, now: req.server.clock.now() });
      if (r.changed) {
        const { tenantId } = req.staff;
        const tableId = r.check.tableId;
        if (r.answeredCallIds.length > 0) req.server.realtime.emit(tenantId, "call.answered", { ids: r.answeredCallIds, tableId }, TABLE_AUDIENCE);
        // The guest page listens on its table room for this to show "visit ended".
        req.server.realtime.emit(tenantId, "check.updated", { ids: [r.check.id], tableId }, TABLE_AUDIENCE);
      }
      return { check: r.check };
    }),
  );

  app.get<IdParams>(
    "/api/checks/:id/print",
    staffRoute(WAITER, async (req) => checkPrint(req.server.models, req.params.id)),
  );
}
