import { OrderRequest } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { claim, hit } from "../auth/rate-limit";
import { CALL_REASONS } from "../db/models/call";
import { ApiError } from "../errors";
import { menuView } from "../menu/view";
import { emitOrderPlaced, placeOrder } from "../orders/place";
import { guestRoute } from "./guard";
import { guestOrdersView, openVisit } from "./orders";

const MIN = 60_000;
export const GUEST_LIMITS = {
  ordersPerToken: { limit: 10, windowMs: 10 * MIN },
  ordersPerIp: { limit: 30, windowMs: 10 * MIN },
  callCooldownMs: 60_000,
} as const;

const CallBody = z.object({ reason: z.enum(CALL_REASONS) });
const BillBody = z.object({ method: z.enum(["card", "cash"]) });

const tooMany = (msg: string) => new ApiError(429, "rate_limited", msg);

/** Guest (QR) API. Every route is scoped to the table named by the `X-Table-Token` header (see `guestRoute`). */
export function registerGuestRoutes(app: FastifyInstance): void {
  app.get(
    "/api/guest/table",
    guestRoute(async (req) => ({
      table: { id: req.table.id, name: req.table.name },
      visit: await openVisit(app.models, req.table.id),
    })),
  );

  app.get(
    "/api/guest/menu",
    guestRoute(async () => menuView(app.models, app.clock.now())),
  );

  app.post(
    "/api/guest/orders",
    guestRoute(async (req, reply) => {
      const body = OrderRequest.parse(req.body);
      const { models } = app;
      const { table } = req;

      // A retry of a placed order is answered without counting against the limits.
      const done = await models.Order.findOne({ idempotencyKey: body.idempotencyKey, tableId: table.id }).lean();
      if (done) return reply.status(200).send({ orderId: String(done._id) });

      const now = app.clock.now();
      const { ordersPerIp, ordersPerToken } = GUEST_LIMITS;
      if (!(await hit(models, `order-ip:${req.ip}`, ordersPerIp.limit, ordersPerIp.windowMs, now))) {
        throw tooMany("Too many orders from this network, please wait a few minutes");
      }
      if (!(await hit(models, `order-table:${table.tenantId}:${table.id}`, ordersPerToken.limit, ordersPerToken.windowMs, now))) {
        throw tooMany("Too many orders from this table, please wait a few minutes or call your waiter");
      }

      const result = await placeOrder(models, { tableId: table.id, source: "qr", placedBy: null, req: body, now });
      emitOrderPlaced(app.realtime, table.tenantId, result);
      return reply.status(result.replayed ? 200 : 201).send({ orderId: String(result.order._id) });
    }),
  );

  app.get(
    "/api/guest/orders",
    guestRoute(async (req) => guestOrdersView(app.models, req.table.id)),
  );

  app.post(
    "/api/guest/calls",
    guestRoute(async (req, reply) => {
      const { reason } = CallBody.parse(req.body);
      const { models } = app;
      const { table } = req;
      const now = app.clock.now();
      if (!(await claim(models, `call:${table.tenantId}:${table.id}`, 1, GUEST_LIMITS.callCooldownMs, now))) {
        throw tooMany("Your waiter has been called and is on the way");
      }
      const visit = await openVisit(models, table.id);
      const call = await models.Call.create({ tableId: table.id, checkId: visit?.checkId ?? null, reason, openedAt: now });
      app.realtime.emit(table.tenantId, "call.opened", { ids: [String(call._id)], tableId: table.id }, ["floor", "manager", "table"]);
      return reply.status(201).send({ callId: String(call._id) });
    }),
  );

  app.post(
    "/api/guest/bill",
    guestRoute(async (req) => {
      const { method } = BillBody.parse(req.body);
      const { table } = req;
      const now = app.clock.now();
      const check = await app.models.Check.findOneAndUpdate(
        { tableId: table.id, status: "open" },
        { $set: { billRequestedAt: now, billMethod: method } },
        { new: true },
      );
      if (!check) throw new ApiError(409, "conflict", "There is no open check at this table");
      app.realtime.emit(table.tenantId, "check.updated", { ids: [String(check._id)], tableId: table.id }, ["floor", "manager", "table"]);
      return { checkId: String(check._id), billRequestedAt: check.billRequestedAt, billMethod: check.billMethod };
    }),
  );
}
