import type { FastifyInstance } from "fastify";
import type { StaffRole } from "@lodos/shared";
import { staffRoute, type StaffRequest } from "../auth/guard";
import { ApiError } from "../errors";
import { kdsView, recall, ticketAction, toggleItem, type Action, type ActionResult, type Station, type Tab } from "./service";

const stationRoles = (req: { params: unknown }): readonly StaffRole[] => {
  const { station } = req.params as { station: string };
  return station === "kitchen" || station === "bar" ? [station] : [];
};
const anyStation: readonly StaffRole[] = ["kitchen", "bar"];
/** Manager sees both stations; kitchen and bar accounts only their own. */
const scopeOf = (req: StaffRequest): Station | null => (req.staff.role === "manager" ? null : (req.staff.role as Station));

const TABS: readonly Tab[] = ["active", "held", "done"];

/** Emitted after the write succeeded: station screen, floor, managers, and the table's guests. */
function emitUpdated(req: StaffRequest, r: ActionResult): void {
  if (!r.changed) return;
  req.server.realtime.emit(req.staff.tenantId, "ticket.updated", { ids: [r.ticket.id], tableId: r.ticket.tableId }, [
    r.ticket.station,
    "floor",
    "manager",
    "table",
  ]);
}

export function registerKdsRoutes(app: FastifyInstance): void {
  app.get<{ Params: { station: string }; Querystring: { tab?: string } }>(
    "/api/kds/:station",
    staffRoute(stationRoles, async (req) => {
      const { station } = req.params;
      if (station !== "kitchen" && station !== "bar") throw new ApiError(404, "not_found");
      const tab = (req.query.tab ?? "active") as Tab;
      if (!TABS.includes(tab)) throw new ApiError(400, "validation");
      return kdsView(req.server.models, station, tab, req.server.clock.now());
    }),
  );

  for (const action of ["start", "hold", "unhold", "bump"] as Action[]) {
    app.post<{ Params: { id: string } }>(
      `/api/tickets/:id/${action}`,
      staffRoute(anyStation, async (req) => {
        const r = await ticketAction(req.server.models, req.params.id, scopeOf(req), action, req.server.clock.now());
        emitUpdated(req, r);
        return { ticket: r.ticket };
      }),
    );
  }

  app.post<{ Params: { id: string; idx: string } }>(
    "/api/tickets/:id/items/:idx/toggle",
    staffRoute(anyStation, async (req) => {
      const r = await toggleItem(req.server.models, req.params.id, scopeOf(req), req.params.idx, req.server.clock.now());
      emitUpdated(req, r);
      return { ticket: r.ticket };
    }),
  );

  app.post<{ Params: { station: string } }>(
    "/api/kds/:station/recall",
    staffRoute(stationRoles, async (req) => {
      const { station } = req.params;
      if (station !== "kitchen" && station !== "bar") throw new ApiError(404, "not_found");
      const r = await recall(req.server.models, station, req.server.clock.now(), req.staff.tenantId);
      emitUpdated(req, r);
      return { ticket: r.ticket };
    }),
  );
}
