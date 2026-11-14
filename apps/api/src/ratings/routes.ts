import { GuestRatingBody } from "@lodos/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { staffRoute } from "../auth/guard";
import { hit } from "../auth/rate-limit";
import { ApiError } from "../errors";
import { guestRoute } from "../guest/guard";
import { notFound } from "../kds/service";
import { createRating, ratingCard, setCommentHidden } from "./service";

const CardQuery = z.object({ checkId: z.string().max(64).default("") });
const TEN_MIN = 10 * 60_000;

/** Guest ratings (spec phase 3): the card and the submission by QR token; comment moderation is manager only. */
export function registerRatingRoutes(app: FastifyInstance): void {
  const { models } = app;

  app.get(
    "/api/guest/rating",
    guestRoute(async (req) => ratingCard(models, req.table.id, CardQuery.parse(req.query).checkId, app.clock.now())),
  );

  app.post(
    "/api/guest/ratings",
    guestRoute(async (req, reply) => {
      const body = GuestRatingBody.parse(req.body);
      const now = app.clock.now();
      if (!(await hit(models, `rating-ip:${req.ip}`, 20, TEN_MIN, now))) {
        throw new ApiError(429, "rate_limited", "Too many ratings from this network, please wait a few minutes");
      }
      const id = await createRating(models, req.table.id, body, now);
      app.realtime.emit(req.table.tenantId, "rating.created", { ids: [id] }, ["manager"]);
      return reply.status(201).send({ id });
    }),
  );

  for (const [action, hidden] of [["hide", true], ["unhide", false]] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/ratings/:id/${action}`,
      staffRoute([], async (req) => {
        const res = await setCommentHidden(models, req.params.id, hidden);
        if (!res) throw notFound();
        return res;
      }),
    );
  }
}
