/** Staff performance scores (phase 3 plan Rulings): all points on a 0–100 scale, pure, no I/O. */
export const SCORE_MINIMUMS = { waiter: { ratings: 5, shifts: 2 }, station: { ratings: 10, shifts: 2 } } as const;

export type BreakdownKey = "rating" | "workload" | "reliability" | "throughput" | "onTime";
export type Breakdown = { key: BreakdownKey; points: number; max: number; value: number }[];
export type Scored = { score: number; breakdown: Breakdown } | { score: null; reason: "not_enough_data" };

export type WaiterInput = { ratingAvg: number | null; ratingCount: number; covers: number; minutes: number; shifts: number; lateShifts: number };
export type StationInput = { dishAvg: number | null; dishCount: number; tickets: number; onTime: number; minutes: number; shifts: number; lateShifts: number };

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Per-hour rate of `count` over `minutes`; 0 when nothing was worked. */
export const perHour = (count: number, minutes: number): number => (minutes > 0 ? (count * 60) / minutes : 0);

const ratingPoints = (avg: number): number => (50 * (clamp(avg, 1, 5) - 1)) / 4;
const share = (value: number, best: number, max: number): number => (best > 0 ? clamp((max * value) / best, 0, max) : 0);

/** Waiters need 5 waiter ratings and 2 shifts. */
export const waiterEligible = (i: Pick<WaiterInput, "ratingCount" | "shifts">): boolean =>
  i.ratingCount >= SCORE_MINIMUMS.waiter.ratings && i.shifts >= SCORE_MINIMUMS.waiter.shifts;
/** Kitchen and bar need 10 dish ratings and 2 shifts. */
export const stationEligible = (i: Pick<StationInput, "dishCount" | "shifts">): boolean =>
  i.dishCount >= SCORE_MINIMUMS.station.ratings && i.shifts >= SCORE_MINIMUMS.station.shifts;

const total = (breakdown: Breakdown): number => round1(breakdown.reduce((s, b) => s + b.points, 0));
const onTimeShare = (shifts: number, late: number): number => (shifts > 0 ? 1 - late / shifts : 0);

export function scoreWaiter(i: WaiterInput, bestCoversPerHour: number): Scored {
  if (!waiterEligible(i) || i.ratingAvg === null) return { score: null, reason: "not_enough_data" };
  const cph = perHour(i.covers, i.minutes);
  const breakdown: Breakdown = [
    { key: "rating", points: round1(ratingPoints(i.ratingAvg)), max: 50, value: i.ratingAvg },
    { key: "workload", points: round1(share(cph, bestCoversPerHour, 35)), max: 35, value: cph },
    { key: "reliability", points: round1(15 * onTimeShare(i.shifts, i.lateShifts)), max: 15, value: onTimeShare(i.shifts, i.lateShifts) },
  ];
  return { score: total(breakdown), breakdown };
}

export function scoreStation(i: StationInput, bestTicketsPerHour: number): Scored {
  if (!stationEligible(i) || i.dishAvg === null) return { score: null, reason: "not_enough_data" };
  const tph = perHour(i.tickets, i.minutes);
  const onTime = i.tickets > 0 ? clamp(i.onTime / i.tickets, 0, 1) : 0;
  const breakdown: Breakdown = [
    { key: "rating", points: round1(ratingPoints(i.dishAvg)), max: 50, value: i.dishAvg },
    { key: "throughput", points: round1(share(tph, bestTicketsPerHour, 20)), max: 20, value: tph },
    { key: "onTime", points: round1(15 * onTime), max: 15, value: onTime },
    { key: "reliability", points: round1(15 * onTimeShare(i.shifts, i.lateShifts)), max: 15, value: onTimeShare(i.shifts, i.lateShifts) },
  ];
  return { score: total(breakdown), breakdown };
}

/** Score descending, then name; unranked (null score) rows go last, also by name. */
export function rankGroup<T extends { name: string; score: number | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.score !== b.score) return (b.score ?? 0) - (a.score ?? 0);
    return a.name.localeCompare(b.name);
  });
}
