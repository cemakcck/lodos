export type TableState = "free" | "seated" | "ready" | "calling" | "bill";

export const TABLE_NAME_RE = /^(T|B)[1-9]\d{0,2}$/;

/** Precedence: calling > ready (food) > bill > seated > free. */
export function deriveTableState(f: { openCheck: boolean; openCall: boolean; readyUnserved: boolean; billRequested: boolean }): TableState {
  if (f.openCall) return "calling";
  if (f.readyUnserved) return "ready";
  if (f.billRequested) return "bill";
  if (f.openCheck) return "seated";
  return "free";
}
