import { AsyncLocalStorage } from "node:async_hooks";
import type { Aggregate, MongooseDefaultQueryMiddleware, Query, Schema } from "mongoose";

/**
 * Multi-tenancy is enforced here, once. A request runs inside `runWithTenant(id, …)`; every query,
 * aggregate and write on a tenant-scoped model is then filtered by / stamped with that tenantId.
 * Touching a scoped model with no context at all throws; `unscoped(reason, …)` is the explicit escape hatch.
 */
type Ctx = { kind: "tenant"; tenantId: string } | { kind: "unscoped"; reason: string };

const als = new AsyncLocalStorage<Ctx>();

export const TENANT_CONTEXT_MISSING = "tenant context missing";
export const TENANT_MISMATCH = "tenantId does not match tenant context";

/**
 * `fn` may return a mongoose Query/Aggregate (a lazy thenable): it is awaited *inside* the context, because
 * the query only executes, and its hooks only read the context, when it is awaited.
 */
export function runWithTenant<T>(tenantId: string, fn: () => PromiseLike<T>): Promise<T> {
  if (typeof tenantId !== "string" || tenantId === "") throw new Error("runWithTenant: tenantId is required");
  return als.run({ kind: "tenant", tenantId }, async () => await fn());
}

/** The tenant of the current context. Throws inside `unscoped` too: there is no tenant there. */
export function currentTenant(): string {
  const ctx = als.getStore();
  if (ctx?.kind !== "tenant") throw new Error(TENANT_CONTEXT_MISSING);
  return ctx.tenantId;
}

/** Runs `fn` with tenant enforcement off (e.g. a global token lookup). `reason` documents why at the call site. */
export function unscoped<T>(reason: string, fn: () => PromiseLike<T>): Promise<T> {
  if (!reason) throw new Error("unscoped: a reason is required");
  return als.run({ kind: "unscoped", reason }, async () => await fn());
}

/** The tenantId to scope by, `null` when explicitly unscoped; throws when there is no context. */
function scope(): string | null {
  const ctx = als.getStore();
  if (!ctx) throw new Error(TENANT_CONTEXT_MISSING);
  return ctx.kind === "tenant" ? ctx.tenantId : null;
}

/** Spread into a schema definition so the inferred document type includes `tenantId`. */
export const tenantIdField = { type: String, required: true, index: true, immutable: true } as const;

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);

/** Sets a missing tenantId; throws when an explicit one differs. Works on plain objects and documents. */
function stamp(doc: unknown, tenantId: string): void {
  if (!isBag(doc)) return;
  if (doc.tenantId == null) doc.tenantId = tenantId;
  else if (doc.tenantId !== tenantId) throw new Error(TENANT_MISMATCH);
}

/** Refuses operator updates that would move a doc to another tenant (or strip its tenant). */
function guardUpdate(update: unknown, tenantId: string): void {
  if (!isBag(update)) return; // aggregation-pipeline updates are not inspected (documented gap)
  for (const bag of [update, update.$set, update.$setOnInsert]) {
    if (isBag(bag) && bag.tenantId !== undefined && bag.tenantId !== tenantId) throw new Error(TENANT_MISMATCH);
  }
  for (const op of ["$unset", "$rename"]) {
    const bag = update[op];
    if (isBag(bag) && "tenantId" in bag) throw new Error(TENANT_MISMATCH);
  }
}

const QUERY_OPS: MongooseDefaultQueryMiddleware[] = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "distinct",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
];

const REPLACE_OPS = new Set(["replaceOne", "findOneAndReplace"]);

type BulkOp = Record<string, { filter?: Bag; update?: unknown; replacement?: unknown; document?: unknown }>;

export function tenantPlugin(schema: Schema): void {
  if (!schema.path("tenantId")) schema.add({ tenantId: tenantIdField });

  schema.pre(QUERY_OPS, { document: false, query: true }, function (this: Query<unknown, unknown>) {
    const t = scope();
    if (t === null) return;
    this.where({ tenantId: t });
    const update = this.getUpdate();
    const op = (this as unknown as { op?: string }).op;
    if (op && REPLACE_OPS.has(op)) stamp(update, t);
    else guardUpdate(update, t);
  });

  schema.pre("estimatedDocumentCount", function () {
    if (scope() !== null) throw new Error("estimatedDocumentCount cannot be tenant-scoped; use countDocuments");
  });

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    const t = scope();
    if (t !== null) this.pipeline().unshift({ $match: { tenantId: t } });
  });

  // `validate` runs before `save`'s own pre hooks, so the tenant must be stamped here for `required` to pass.
  schema.pre("validate", function () {
    const t = scope();
    if (t !== null) stamp(this, t);
  });
  schema.pre("save", function () {
    const t = scope();
    if (t !== null) stamp(this, t);
  });

  schema.pre("insertMany", function (docs: unknown) {
    const t = scope();
    if (t === null) return;
    for (const d of Array.isArray(docs) ? docs : [docs]) stamp(d, t);
  });

  schema.pre("bulkWrite", function (ops) {
    const t = scope();
    if (t === null) return;
    for (const op of ops as unknown as BulkOp[]) {
      for (const [kind, spec] of Object.entries(op)) {
        if (kind === "insertOne") {
          stamp(spec.document, t);
          continue;
        }
        spec.filter = { ...spec.filter, tenantId: t };
        if (kind === "replaceOne") stamp(spec.replacement, t);
        else guardUpdate(spec.update, t);
      }
    }
  });
}
