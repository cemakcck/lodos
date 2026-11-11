import { TENANT_SCOPED_MODELS } from "../src/db/models";
import { runWithTenant, unscoped } from "../src/db/tenancy";
import type { makeTestApp } from "./helpers";

/** Shared by the demo sandbox test files. */
export const NOW = new Date("2026-11-10T17:00:00Z");
export const MIN = 60_000;
export const H = 3_600_000;

export type T = Awaited<ReturnType<typeof makeTestApp>>;
export const cookie = (res: { cookies: { name: string; value: string }[] }, name: string) =>
  res.cookies.find((c) => c.name === name)?.value;

export const signIn = (t: T, role: string, cookies: Record<string, string> = {}, remoteAddress?: string) =>
  t.inject({
    method: "POST",
    url: "/api/demo/session",
    payload: { role },
    cookies,
    remoteAddress,
  });

export const sandboxIds = async (t: T) => (await unscoped("test", () => t.models.Sandbox.find({}).lean())).map((s) => s._id);
export const countAll = (t: T, tenantId: string) =>
  runWithTenant(tenantId, async () => {
    let n = 0;
    for (const name of TENANT_SCOPED_MODELS)
      n += await (t.models[name] as unknown as { countDocuments(f: object): PromiseLike<number> }).countDocuments({});
    return n;
  });
