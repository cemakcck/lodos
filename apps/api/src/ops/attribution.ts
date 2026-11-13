/**
 * Station attribution (spec §13.4), pure. Each kitchen or bar ticket is credited to the people of that station
 * clocked in at its `sentAt`, split equally; each dish rating likewise at the paying check's `paidAt`, to the
 * station that makes the dish. Clocked intervals are `in` ≤ t < `out`, an open entry running until `now`.
 * Something with nobody of its station clocked in is credited to no one. Shares are fractional.
 */
export type Station = "kitchen" | "bar";
export type StationEntry = { staffId: string; station: Station; in: Date; out: Date | null };
export type StationTicket = { station: Station; sentAt: Date; readyAt: Date };
export type StationDish = { station: Station; stars: number; paidAt: Date };
export type StationFigures = { stationTickets: number; stationOnTime: number; dishRatingSum: number; dishRatingCount: number };

export const emptyFigures = (): StationFigures => ({ stationTickets: 0, stationOnTime: 0, dishRatingSum: 0, dishRatingCount: 0 });

export function attributeStations(input: {
  entries: StationEntry[];
  tickets: StationTicket[];
  dishes: StationDish[];
  lateMs: number;
  now: Date;
}): Map<string, StationFigures> {
  const { entries, now } = input;
  const out = new Map<string, StationFigures>();
  const onDuty = (station: Station, at: Date): string[] => {
    const t = at.getTime();
    const ids = entries
      .filter((e) => e.station === station && e.in.getTime() <= t && t < (e.out ?? now).getTime())
      .map((e) => e.staffId);
    return [...new Set(ids)];
  };
  const credit = (station: Station, at: Date, add: (f: StationFigures, share: number) => void) => {
    const ids = onDuty(station, at);
    for (const id of ids) {
      let f = out.get(id);
      if (!f) out.set(id, (f = emptyFigures()));
      add(f, 1 / ids.length);
    }
  };
  for (const tk of input.tickets) {
    const onTime = tk.readyAt.getTime() - tk.sentAt.getTime() <= input.lateMs;
    credit(tk.station, tk.sentAt, (f, share) => {
      f.stationTickets += share;
      if (onTime) f.stationOnTime += share;
    });
  }
  for (const d of input.dishes) {
    credit(d.station, d.paidAt, (f, share) => {
      f.dishRatingSum += d.stars * share;
      f.dishRatingCount += share;
    });
  }
  return out;
}
