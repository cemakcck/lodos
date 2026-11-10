import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";
import type { Models } from "../db/models";
import { runWithTenant, unscoped } from "../db/tenancy";
import { ApiError } from "../errors";

export const TABLE_TOKEN_HEADER = "x-table-token";

/** The table a guest's QR token resolves to. */
export type GuestTable = { id: string; tenantId: string; name: string; sectionStaffId: string | null };

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `guestRoute` before the handler runs. */
    table?: GuestTable;
  }
}

export type GuestRequest<R extends RouteGenericInterface = RouteGenericInterface> = FastifyRequest<R> & { table: GuestTable };

/** Looks a raw QR token up across tenants (tokens are globally unique). Unknown token or inactive table → null. */
export async function resolveTable(models: Models, token: string): Promise<GuestTable | null> {
  const table = await unscoped("guest token: the token alone names its tenant", () =>
    models.Table.findOne({ token, active: true }).lean(),
  );
  if (!table) return null;
  return {
    id: String(table._id),
    tenantId: table.tenantId,
    name: table.name,
    sectionStaffId: table.sectionStaffId ? String(table.sectionStaffId) : null,
  };
}

/**
 * The only way to register a guest route. It resolves the `X-Table-Token` header to its table (404 when unknown or
 * inactive), sets `req.table` and runs `handler` inside `runWithTenant(table.tenantId)`, so a guest can only ever
 * reach their own table's tenant. Guests are never given a cookie, and cookies are ignored here.
 */
export function guestRoute<R extends RouteGenericInterface = RouteGenericInterface, T = unknown>(
  handler: (req: GuestRequest<R>, reply: FastifyReply) => Promise<T>,
) {
  return async (req: FastifyRequest<R>, reply: FastifyReply): Promise<T> => {
    const raw = req.headers[TABLE_TOKEN_HEADER];
    const token = typeof raw === "string" ? raw.trim() : "";
    const table = token && token.length <= 128 ? await resolveTable(req.server.models, token) : null;
    if (!table) throw new ApiError(404, "not_found", "Unknown table");
    req.table = table;
    return runWithTenant(table.tenantId, () => handler(req as GuestRequest<R>, reply));
  };
}
