import type { TFunction } from "i18next";
import type { CheckLine, FloorTable, TableCheck, TableState } from "./types";

type Lang = "en" | "tr";
const pad = (n: number) => String(n).padStart(2, "0");

/** Compact hours and minutes for tables, stats and the panel: "06m", "1h 12m" (TR "06dk", "1sa 12dk"). */
export function hm(ms: number, lang: Lang): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const [H, M] = lang === "tr" ? ["sa", "dk"] : ["h", "m"];
  return h > 0 ? `${h}${H} ${pad(m)}${M}` : `${pad(m)}${M}`;
}

/** The same duration for screen readers: "1 hour 12 minutes", "6 minutes", "under a minute". */
export function spokenHm(ms: number, t: TFunction): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  if (total === 0) return t("floor.time.underMinute");
  const h = Math.floor(total / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(t("floor.time.hours", { count: h }));
  if (m > 0) parts.push(t("floor.time.minutes", { count: m }));
  return parts.join(" ");
}

/** Milliseconds since an ISO time, measured on the server clock. */
export const since = (iso: string | null, now: Date) => (iso ? now.getTime() - Date.parse(iso) : 0);

/** "B2" before "T1" before "T10": the tab order on the canvas and every list. */
export const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "en", { numeric: true });

/** "T12, food ready, 4 covers, 1 hour 12 minutes[, your section]". The state word always pairs the colour. */
export function tableLabel(table: FloorTable, now: Date, t: TFunction, mine: boolean): string {
  const parts = [table.name, t(`floor.state.aria.${table.state}`)];
  if (table.state === "free") parts.push(t("floor.table.seats", { count: table.capacity }));
  else {
    parts.push(table.covers == null ? t("floor.table.noCovers") : t("floor.table.covers", { count: table.covers }));
    parts.push(spokenHm(since(table.seatedAt, now), t));
    if (table.paying) parts.push(t("floor.table.paying", table.paying));
  }
  if (mine) parts.push(t("floor.table.mine"));
  return parts.join(", ");
}

/** The detail panel's state, derived from the check itself so it is right even before the floor refetches. */
export function checkState(data: TableCheck): TableState {
  if (data.calls.length > 0) return "calling";
  if (data.check === null) return "free";
  if ([...data.food, ...data.drinks].some((l) => l.status === "ready")) return "ready";
  if (data.check.billRequestedAt) return "bill";
  return "seated";
}

/** Ready tickets on the check, each with its lines, in first-seen order: one "Mark picked up" per ticket. */
export function readyTickets(lines: CheckLine[]): { ticketId: string; lines: CheckLine[] }[] {
  const out = new Map<string, CheckLine[]>();
  for (const l of lines) if (l.status === "ready") out.set(l.ticketId, [...(out.get(l.ticketId) ?? []), l]);
  return [...out].map(([ticketId, ls]) => ({ ticketId, lines: ls }));
}

/** Known room names localised; anything else as named. */
export function roomName(name: string, t: TFunction): string {
  const key = `floor.rooms.${name.toLowerCase()}`;
  const s = t(key);
  return s === key ? name : s;
}
