import { mondayOf, serviceDayOf } from "@lodos/shared";
import type { Models } from "../db/models";
import { ApiError } from "../errors";

/** The months a manager can open: the first month with data … the current service day's month. */
export type DataRange = { first: string; last: string };

/**
 * The tenant's data range. The first month is the earlier of the tenant's creation day and the earliest summary
 * that holds data (a generated one, or one with checks). Empty summaries are ignored: reads store those for any
 * past day they touch, so counting them would let the range creep back. Run inside the tenant.
 */
export async function dataRange(models: Models, now: Date): Promise<DataRange> {
  const [tenant, earliest] = await Promise.all([
    models.Tenant.findOne({}, { createdAt: 1 }).lean(),
    models.DailySummary.findOne({ $or: [{ generated: true }, { checks: { $gt: 0 } }] }, { serviceDay: 1 }).sort({ serviceDay: 1 }).lean(),
  ]);
  const today = serviceDayOf(now);
  const candidates = [today, ...(tenant ? [serviceDayOf(tenant.createdAt)] : []), ...(earliest ? [earliest.serviceDay] : [])];
  const first = candidates.reduce((a, b) => (b < a ? b : a));
  return { first: first.slice(0, 7), last: today.slice(0, 7) };
}

const outOfRange = () => new ApiError(400, "validation", "Outside the months with data");

/** A month ("YYYY-MM") inside the range, or 400. */
export function assertMonth(range: DataRange, month: string): void {
  if (month < range.first || month > range.last) throw outOfRange();
}

/** A week (its Monday) touching the range, or 400: from the week holding the first month's 1st to the current week. */
export function assertWeek(range: DataRange, week: string, now: Date): void {
  if (week < mondayOf(`${range.first}-01`) || week > mondayOf(serviceDayOf(now))) throw outOfRange();
}
