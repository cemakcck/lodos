import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { wantsAppShell } from "./web";

export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "sold_out"
  | "item_unavailable"
  | "check_closed"
  | "rate_limited"
  | "limit_exceeded"
  | "conflict"
  | "demo_busy"
  | "approval_required"
  | "not_a_manager"
  | "split_locked"
  | "amount_changed"
  | "void_after_ready"
  | "pin_required"
  | "name_taken"
  | "last_manager"
  | "self"
  | "station"
  | "demo_protected"
  | "shift_too_long"
  | "shift_overlap";

export type ErrorBody = { error: { code: ErrorCode | "internal"; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

function body(code: ErrorBody["error"]["code"], message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Maps a framework 4xx status (bad JSON, body too large, …) onto our closed set of codes. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "validation";
  }
}

export function registerErrorHandling(app: FastifyInstance, opts: { appShell?: boolean } = {}): void {
  app.setNotFoundHandler((req, reply) => {
    if (opts.appShell && wantsAppShell(req.method, req.url)) {
      void reply.header("cache-control", "no-cache").sendFile("index.html");
      return;
    }
    void reply.status(404).send(body("not_found", `Route ${req.method} ${req.url} not found`));
  });

  app.setErrorHandler((err: FastifyError | ApiError | ZodError | Error, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send(body(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(body("validation", "Invalid request", err.issues));
    }
    const status = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      const details = "validation" in err ? err.validation : undefined;
      return reply.status(status).send(body(codeForStatus(status), err.message, details));
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send(body("internal", "Internal server error"));
  });
}
