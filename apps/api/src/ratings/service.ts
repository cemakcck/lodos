import { addStar, emptyAgg, serviceDayOf, type Agg, type GuestRatingBody, type RatingAgg } from "@lodos/shared";
import { Types } from "mongoose";
import { billOf } from "../checks/bill";
import type { Models } from "../db/models";
import { ApiError } from "../errors";

export const RATING_WINDOW_MS = 24 * 60 * 60_000;

type Stars = 1 | 2 | 3 | 4 | 5;
export type RatingCard = { state: "open" | "done" | "closed"; waiter: { name: string } | null; dishes: { itemId: string; name: { en: string; tr: string } }[] };

const isOid = (s: string) => /^[0-9a-f]{24}$/i.test(s);

/** The check if it is this table's, paid, and still inside the 24 h window; otherwise null. Run inside the tenant. */
async function ratableCheck(models: Models, tableId: string, checkId: string, now: Date) {
  if (!isOid(checkId)) return null;
  const check = await models.Check.findOne({ _id: checkId, tableId, status: "paid" }).lean();
  if (!check?.closedAt || now.getTime() - check.closedAt.getTime() > RATING_WINDOW_MS) return null;
  return check;
}

/** The distinct items still on the bill (comped units count, fully voided lines do not), first-seen order. */
async function billDishes(models: Models, checkId: string) {
  const bill = await billOf(models, checkId);
  const out = new Map<string, { itemId: string; name: { en: string; tr: string }; station: "kitchen" | "bar" }>();
  for (const l of bill.lines) {
    if (l.units.length > 0 && !out.has(l.itemId)) out.set(l.itemId, { itemId: l.itemId, name: l.name, station: l.station });
  }
  return out;
}

export async function ratingCard(models: Models, tableId: string, checkId: string, now: Date): Promise<RatingCard> {
  const closed: RatingCard = { state: "closed", waiter: null, dishes: [] };
  const check = await ratableCheck(models, tableId, checkId, now);
  if (!check) return closed;
  if (await models.Rating.exists({ checkId: check._id })) return { ...closed, state: "done" };
  const staff = check.serverStaffId ? await models.Staff.findOne({ _id: check.serverStaffId }, { name: 1 }).lean() : null;
  const dishes = [...(await billDishes(models, String(check._id))).values()].map(({ itemId, name }) => ({ itemId, name }));
  return { state: "open", waiter: staff ? { name: staff.name } : null, dishes };
}

export async function createRating(models: Models, tableId: string, body: GuestRatingBody, now: Date): Promise<string> {
  const check = await ratableCheck(models, tableId, body.checkId, now);
  if (!check) throw new ApiError(409, "rating_closed", "This check can no longer be rated");
  if (await models.Rating.exists({ checkId: check._id })) throw new ApiError(409, "already_rated", "This check was already rated");
  const onBill = await billDishes(models, String(check._id));
  const dishes = (body.dishes ?? []).map((d) => {
    const line = onBill.get(d.itemId);
    if (!line) throw new ApiError(400, "invalid_dish", "That dish is not on this check");
    return { itemId: new Types.ObjectId(line.itemId), name: line.name, station: line.station, stars: d.stars };
  });
  try {
    const rating = await models.Rating.create({
      checkId: check._id,
      tableId: check.tableId,
      serviceDay: serviceDayOf(check.closedAt!),
      paidAt: check.closedAt!,
      submittedAt: now,
      serverStaffId: check.serverStaffId ?? null,
      waiter: body.waiter ?? null,
      dishes,
      food: body.food ?? null,
      cleanliness: body.cleanliness ?? null,
      atmosphere: body.atmosphere ?? null,
      comment: body.comment ? body.comment : null,
    });
    return String(rating._id);
  } catch (err) {
    // The unique index decides between parallel submissions.
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, "already_rated", "This check was already rated");
    throw err;
  }
}

/** Sets `commentHidden`; null when the rating does not exist in this tenant. */
export async function setCommentHidden(models: Models, id: string, hidden: boolean): Promise<{ id: string; commentHidden: boolean } | null> {
  if (!isOid(id)) return null;
  const r = await models.Rating.findOneAndUpdate({ _id: id }, { $set: { commentHidden: hidden } }, { returnDocument: "after" }).lean();
  return r ? { id: String(r._id), commentHidden: r.commentHidden } : null;
}

/** Aggregates the raw ratings of the given service days (per day). Days without ratings are absent. Run inside the tenant. */
export async function ratingAggForDays(models: Models, days: string[]): Promise<Map<string, RatingAgg>> {
  const out = new Map<string, RatingAgg>();
  if (days.length === 0) return out;
  const rows = await models.Rating.find({ serviceDay: { $in: days } }).sort({ _id: 1 }).lean();
  const waiters = new Map<string, Map<string, Agg>>();
  const dishes = new Map<string, Map<string, Agg & { itemId: string | null; name: { en: string; tr: string } }>>();
  for (const r of rows) {
    let agg = out.get(r.serviceDay);
    if (!agg) {
      agg = { waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() };
      out.set(r.serviceDay, agg);
    }
    for (const c of ["food", "cleanliness", "atmosphere"] as const) if (r[c] != null) agg[c] = addStar(agg[c], r[c] as Stars);
    if (r.waiter != null && r.serverStaffId) {
      const m = waiters.get(r.serviceDay) ?? new Map<string, Agg>();
      waiters.set(r.serviceDay, m);
      const id = String(r.serverStaffId);
      m.set(id, addStar(m.get(id) ?? emptyAgg(), r.waiter as Stars));
    }
    const dm = dishes.get(r.serviceDay) ?? new Map();
    dishes.set(r.serviceDay, dm);
    for (const d of r.dishes) {
      const itemId = d.itemId ? String(d.itemId) : null;
      const key = itemId ?? `name:${d.name.en}`;
      const prev = dm.get(key) ?? { ...emptyAgg(), itemId, name: { en: d.name.en, tr: d.name.tr } };
      dm.set(key, { ...prev, ...addStar(prev, d.stars as Stars) });
    }
  }
  for (const [day, agg] of out) {
    agg.waiter = [...(waiters.get(day) ?? [])].map(([staffId, a]) => ({ staffId, ...a }));
    agg.dishes = [...(dishes.get(day)?.values() ?? [])];
  }
  return out;
}
