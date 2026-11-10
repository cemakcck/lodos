export type ApiErrorCode =
  | "validation" | "unauthorized" | "forbidden" | "not_found" | "sold_out" | "item_unavailable"
  | "check_closed" | "rate_limited" | "limit_exceeded" | "conflict" | "demo_busy" | "internal";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiInit = RequestInit & { tableToken?: string };

/** Same-origin JSON fetch. Staff use the lodos_sid cookie; guests pass tableToken. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { tableToken, headers, body, ...rest } = init;
  const h = new Headers(headers);
  if (tableToken) h.set("X-Table-Token", tableToken);
  // FormData and Blobs carry their own type (multipart needs the browser-made boundary).
  if (body !== undefined && body !== null && !isRawBody(body) && !h.has("Content-Type")) h.set("Content-Type", "application/json");
  if (!h.has("Accept")) h.set("Accept", "application/json");
  const res = await fetch(path.startsWith("/") ? path : `/api/${path}`, {
    credentials: "include",
    ...rest,
    headers: h,
    body: body !== undefined && body !== null && typeof body === "object" && !isRawBody(body) ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try { data = JSON.parse(text); } catch { data = undefined; }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiClientError(res.status, err?.code ?? "internal", err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

function isRawBody(b: unknown): boolean {
  return b instanceof FormData || b instanceof Blob || b instanceof URLSearchParams || b instanceof ArrayBuffer;
}
