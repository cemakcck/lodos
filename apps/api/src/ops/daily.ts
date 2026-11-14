import { emptyAgg, mergeRatingAgg, serviceDayOf, serviceDayStartOf, TICKET_THRESHOLDS, type Agg, type RatingAgg } from "@lodos/shared";
import type { Models } from "../db/models";
import { ratingAggForDays } from "../ratings/service";
import { ensureSummaries, type SummaryData } from "../sales/summary";
import { labourForDays, type PersonDay } from "../timeclock/service";
import { attributeStations, emptyFigures, type Station, type StationDish, type StationEntry, type StationFigures, type StationTicket } from "./attribution";

/**
 * The daily ops reader every dashboard reads through (spec §13.1). A generated summary carries `ratings` and
 * `people` aggregates; a live day has raw `Rating` and `ClockEntry` documents. Both are merged per day, so seeded
 * and live data read the same way. Run inside the tenant.
 */
export type PersonOps = PersonDay & StationFigures;

export type DayOps = {
  serviceDay: string;
  ratings: RatingAgg;
  people: PersonOps[];
  byServer: SummaryData["byServer"];
  ticketTimes: SummaryData["ticketTimes"];
  generated: boolean;
};

const DAY_MS = 24 * 3_600_000;

/** The station a person's clocked time counts for: cooks make the kitchen's tickets, bartenders the bar's. */
const STATION_OF_ROLE: Record<string, Station> = { cook: "kitchen", bartender: "bar" };

const emptyRatings = (): RatingAgg => ({ waiter: [], dishes: [], food: emptyAgg(), cleanliness: emptyAgg(), atmosphere: emptyAgg() });

export async function opsForDays(models: Models, days: string[], now: Date): Promise<Map<string, DayOps>> {
  const out = new Map<string, DayOps>();
  const wanted = [...new Set(days)];
  if (wanted.length === 0) return out;
  const [summaries, generated, ratings, labour, stations] = await Promise.all([
    ensureSummaries(models, wanted, serviceDayOf(now)),
    generatedAggregates(models, wanted),
    ratingAggForDays(models, wanted),
    labourForDays(models, wanted, now),
    stationFiguresForDays(models, wanted, now),
  ]);
  for (const day of wanted) {
    const summary = summaries.get(day)!;
    const stored = generated.get(day);
    const live = (labour.get(day) ?? []).map((p): PersonOps => ({ ...p, ...emptyFigures(), ...stations.get(day)?.get(p.staffId) }));
    out.set(day, {
      serviceDay: day,
      ratings: mergeRatingAgg(stored?.ratings ?? emptyRatings(), ratings.get(day) ?? emptyRatings()),
      people: mergePeople([...(stored?.people ?? []), ...live]),
      byServer: summary.byServer,
      ticketTimes: summary.ticketTimes,
      generated: summary.generated,
    });
  }
  return out;
}

const PERSON_FIELDS = [
  "minutes", "overtimeMinutes", "labourCost", "shifts", "lateShifts",
  "stationTickets", "stationOnTime", "dishRatingSum", "dishRatingCount",
] as const;

/** Sums rows by staff id, first-seen order. */
function mergePeople(rows: PersonOps[]): PersonOps[] {
  const by = new Map<string, PersonOps>();
  for (const r of rows) {
    const prev = by.get(r.staffId);
    if (!prev) {
      by.set(r.staffId, { ...r });
      continue;
    }
    for (const k of PERSON_FIELDS) prev[k] += r[k];
  }
  return [...by.values()];
}

type StoredAgg = { sum?: number; count?: number; dist?: number[] } | undefined;
type StoredOps = {
  serviceDay: string;
  ratings?: { waiter?: ({ staffId: string } & StoredAgg)[]; dishes?: ({ itemId?: string | null; name: { en: string; tr: string } } & StoredAgg)[] } & Record<"food" | "cleanliness" | "atmosphere", StoredAgg>;
  people?: Partial<PersonOps>[];
};

const aggOf = (a: StoredAgg): Agg => ({ sum: a?.sum ?? 0, count: a?.count ?? 0, dist: [0, 1, 2, 3, 4].map((i) => a?.dist?.[i] ?? 0) as Agg["dist"] });

/** The `ratings` and `people` aggregates of generated summaries, field by field (no ids leak; missing reads as empty). */
async function generatedAggregates(models: Models, days: string[]): Promise<Map<string, { ratings: RatingAgg; people: PersonOps[] }>> {
  const docs = await models.DailySummary.find({ serviceDay: { $in: days }, generated: true }, { serviceDay: 1, ratings: 1, people: 1 }).lean<StoredOps[]>();
  return new Map(
    docs.map((d) => {
      const r = d.ratings;
      const ratings: RatingAgg = {
        waiter: (r?.waiter ?? []).map((w) => ({ staffId: w.staffId, ...aggOf(w) })),
        dishes: (r?.dishes ?? []).map((x) => ({ itemId: x.itemId ?? null, name: { en: x.name.en, tr: x.name.tr }, ...aggOf(x) })),
        food: aggOf(r?.food),
        cleanliness: aggOf(r?.cleanliness),
        atmosphere: aggOf(r?.atmosphere),
      };
      const people = (d.people ?? []).map((p): PersonOps => {
        const row = { staffId: String(p.staffId) } as PersonOps;
        for (const k of PERSON_FIELDS) row[k] = p[k] ?? 0;
        return row;
      });
      return [d.serviceDay, { ratings, people }] as const;
    }),
  );
}

/** Per day, per person: station tickets and dish ratings attributed from raw clock entries, tickets and ratings. */
async function stationFiguresForDays(models: Models, days: string[], now: Date): Promise<Map<string, Map<string, StationFigures>>> {
  const sorted = [...days].sort();
  const from = serviceDayStartOf(sorted[0]!);
  const to = new Date(serviceDayStartOf(sorted[sorted.length - 1]!).getTime() + DAY_MS);
  const [entries, tickets, ratings, setting] = await Promise.all([
    models.ClockEntry.find({ serviceDay: { $in: days } }, { staffId: 1, serviceDay: 1, in: 1, out: 1 }).lean(),
    // The same tickets as the summary's ticket times.
    models.Ticket.find({ sentAt: { $gte: from, $lt: to }, readyAt: { $ne: null }, voidedAt: null }, { station: 1, sentAt: 1, readyAt: 1 }).lean(),
    models.Rating.find({ serviceDay: { $in: days } }, { serviceDay: 1, paidAt: 1, dishes: 1 }).lean(),
    models.Setting.findOne({}, { lateMin: 1 }).lean(),
  ]);
  const staff = await models.Staff.find({ _id: { $in: [...new Set(entries.map((e) => String(e.staffId)))] } }, { role: 1 }).lean();
  const stationOf = new Map(staff.map((s) => [String(s._id), STATION_OF_ROLE[s.role]]));

  const perDay = new Map<string, { entries: StationEntry[]; tickets: StationTicket[]; dishes: StationDish[] }>(
    days.map((d) => [d, { entries: [], tickets: [], dishes: [] }]),
  );
  for (const e of entries) {
    const station = stationOf.get(String(e.staffId));
    if (station) perDay.get(e.serviceDay)?.entries.push({ staffId: String(e.staffId), station, in: e.in, out: e.out ?? null });
  }
  for (const tk of tickets) perDay.get(serviceDayOf(tk.sentAt))?.tickets.push({ station: tk.station, sentAt: tk.sentAt, readyAt: tk.readyAt! });
  for (const r of ratings) {
    for (const d of r.dishes) perDay.get(r.serviceDay)?.dishes.push({ station: d.station, stars: d.stars, paidAt: r.paidAt });
  }
  const lateMs = (setting?.lateMin ?? TICKET_THRESHOLDS.lateMin) * 60_000;
  return new Map([...perDay].map(([day, x]) => [day, attributeStations({ ...x, lateMs, now })]));
}
