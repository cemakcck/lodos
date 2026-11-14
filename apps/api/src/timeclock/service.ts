import {
  addDays,
  allocateOvertime,
  entryCost,
  entryMinutes,
  mondayOf,
  rateAt,
  scheduleGroupOf,
  serviceDayOf,
  TIME_CLOCK,
  weekDays,
  type StaffRole,
} from "@lodos/shared";
import type { Types } from "mongoose";
import { verifyStaffPin } from "../auth/approval";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { isOid, notFound } from "../kds/service";
import { rowOf as shiftRow, type ShiftRow } from "../shifts/service";

const HOUR_MS = 3_600_000;

export type ClockPerson = { id: string; name: string; clockedIn: boolean };

/** GET /api/clock/people: everyone active on the schedule (never a station account), with whether they are clocked in. */
export async function clockPeople(models: Models): Promise<ClockPerson[]> {
  const [staff, open] = await Promise.all([
    models.Staff.find({ active: true }, { name: 1, role: 1 }).lean(),
    models.ClockEntry.find({ out: null }, { staffId: 1 }).lean(),
  ]);
  const openIds = new Set(open.map((e) => String(e.staffId)));
  return staff
    .filter((s) => scheduleGroupOf(s.role) !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .map((s) => ({ id: String(s._id), name: s.name, clockedIn: openIds.has(String(s._id)) }));
}

export type PunchResult = { action: "in" | "out"; at: string; minutesToday: number; staffId: string };

/** Minutes of closed entries on a service day (open ones don't count yet). */
async function minutesOnDay(models: Models, staffId: Types.ObjectId, serviceDay: string, now: Date): Promise<number> {
  const entries = await models.ClockEntry.find({ staffId, serviceDay }).lean();
  return entries.reduce((n, e) => n + (entryMinutes({ in: e.in, out: e.out ?? null }, now) ?? 0), 0);
}

/**
 * POST /api/clock/punch: a PIN check (the login lock and limits, plus the per-IP limit), then a toggle. With no open
 * entry it opens one priced at the current rate; otherwise it closes it. An entry open past 16 h is never closed here.
 */
export async function punch(models: Models, a: { tenantId: string; ip: string; staffId: string; pin: string; now: Date }): Promise<PunchResult> {
  const staff = await verifyStaffPin(models, { ...a, clock: true });
  const open = await models.ClockEntry.findOne({ staffId: staff._id, out: null });
  if (open) {
    if (a.now.getTime() - open.in.getTime() > TIME_CLOCK.forgotOutH * HOUR_MS) {
      throw new ApiError(409, "forgot_clock_out", "Your last clock-in is more than 16 hours old: ask your manager");
    }
    // Conditional, so two simultaneous punches close it once.
    const res = await models.ClockEntry.updateOne({ _id: open._id, out: null }, { $set: { out: a.now } });
    if (res.modifiedCount === 0) throw new ApiError(409, "conflict", "Already punched, try again");
    return { action: "out", at: a.now.toISOString(), minutesToday: await minutesOnDay(models, staff._id, open.serviceDay, a.now), staffId: String(staff._id) };
  }
  const serviceDay = serviceDayOf(a.now);
  try {
    await models.ClockEntry.create({ staffId: staff._id, serviceDay, in: a.now, out: null, rate: rateAt(staff.rates, a.now) });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, "conflict", "Already punched, try again");
    throw err;
  }
  return { action: "in", at: a.now.toISOString(), minutesToday: await minutesOnDay(models, staff._id, serviceDay, a.now), staffId: String(staff._id) };
}

/** A person's overtime-aware entries: closed ones get minutes; open ones none. */
type Lean = { _id: Types.ObjectId; staffId: Types.ObjectId; serviceDay: string; in: Date; out?: Date | null; rate: number };

function priced(entries: Lean[], now: Date) {
  const closed = entries.flatMap((e) => {
    const minutes = entryMinutes({ in: e.in, out: e.out ?? null }, now);
    return minutes === null ? [] : [{ id: String(e._id), staffId: String(e.staffId), serviceDay: e.serviceDay, minutes, in: e.in }];
  });
  const overtime = allocateOvertime(closed);
  return new Map(
    entries.map((e) => {
      const minutes = entryMinutes({ in: e.in, out: e.out ?? null }, now);
      const ot = overtime.get(String(e._id)) ?? 0;
      return [String(e._id), { minutes, overtimeMinutes: ot, cost: minutes === null ? 0 : entryCost(minutes, ot, e.rate) }] as const;
    }),
  );
}

export type PersonDay = { staffId: string; minutes: number; overtimeMinutes: number; labourCost: number; shifts: number; lateShifts: number };

/**
 * Labour per person for the given service days, from raw clock entries. Overtime is allocated over the whole
 * Monday–Sunday weeks that touch `days`, then only the entries on `days` are counted. A shift counts once started; it is late when its
 * own first entry began more than 5 min after the start, or it ended with no entry (no-show).
 * Days without a shift but with entries count minutes and cost with `shifts: 0`. Shifts on a generated day whose
 * labour is aggregated in `DailySummary.people` are left to that aggregate.
 */
export async function labourForDays(models: Models, days: string[], now: Date): Promise<Map<string, PersonDay[]>> {
  const result = new Map<string, PersonDay[]>(days.map((d) => [d, []]));
  if (days.length === 0) return result;
  const sorted = [...days].sort();
  const from = mondayOf(sorted[0]!);
  const to = addDays(mondayOf(sorted[sorted.length - 1]!), 6);
  const [entries, allShifts, aggregated] = await Promise.all([
    models.ClockEntry.find({ serviceDay: { $gte: from, $lte: to } }).lean(),
    models.Shift.find({ serviceDay: { $in: days } }).lean(),
    // Generated days whose labour is aggregated (`people` shifts, demo history): their shifts count there, not again here.
    models.DailySummary.find({ serviceDay: { $in: days }, generated: true, "people.shifts": { $gt: 0 } }, { serviceDay: 1 }).lean(),
  ]);
  const aggregatedDays = new Set(aggregated.map((d) => d.serviceDay));
  const shifts = allShifts.filter((s) => !aggregatedDays.has(s.serviceDay));
  const price = priced(entries, now);
  const wanted = new Set(days);
  const per = new Map<string, Map<string, PersonDay>>(); // day → staff → row
  const rowFor = (day: string, staffId: string): PersonDay => {
    const m = per.get(day) ?? new Map<string, PersonDay>();
    per.set(day, m);
    let r = m.get(staffId);
    if (!r) m.set(staffId, (r = { staffId, minutes: 0, overtimeMinutes: 0, labourCost: 0, shifts: 0, lateShifts: 0 }));
    return r;
  };
  const byPersonDay = new Map<string, Lean[]>();
  for (const e of entries) {
    if (!wanted.has(e.serviceDay)) continue;
    const p = price.get(String(e._id))!;
    const r = rowFor(e.serviceDay, String(e.staffId));
    r.minutes += p.minutes ?? 0;
    r.overtimeMinutes += p.overtimeMinutes;
    r.labourCost += p.cost;
    const k = `${e.serviceDay}|${String(e.staffId)}`;
    byPersonDay.set(k, [...(byPersonDay.get(k) ?? []), e]);
  }
  for (const s of shifts) {
    if (s.start.getTime() > now.getTime()) continue; // not started yet: not counted
    const r = rowFor(s.serviceDay, String(s.staffId));
    r.shifts += 1;
    // This shift's own entry: the first one that overlaps the shift or starts after its start (a split shift's
    // second half is judged on its own entry). Late when it begins after the grace; a finished shift with none is a no-show.
    const mine = (byPersonDay.get(`${s.serviceDay}|${String(s.staffId)}`) ?? []).filter((e) => !e.out || e.out.getTime() > s.start.getTime());
    if (mine.length === 0) {
      if (s.end.getTime() <= now.getTime()) r.lateShifts += 1;
    } else if (Math.min(...mine.map((e) => e.in.getTime())) > s.start.getTime() + TIME_CLOCK.lateGraceMin * 60_000) {
      r.lateShifts += 1;
    }
  }
  for (const [day, m] of per) result.set(day, [...m.values()]);
  return result;
}

export type TimesheetEntry = {
  id: string;
  serviceDay: string;
  in: string;
  out: string | null;
  minutes: number | null;
  overtimeMinutes: number;
  cost: number;
  rate: number;
  edited: boolean;
  forgot: boolean;
};

export type TimesheetPerson = {
  staffId: string;
  name: string;
  role: StaffRole;
  entries: TimesheetEntry[];
  shifts: ShiftRow[];
  minutes: number;
  overtimeMinutes: number;
  cost: number;
};

/** GET /api/timesheets?week=: per person with entries or shifts in the week, entries with their minutes, overtime and cost. */
export async function timesheets(models: Models, week: string, now: Date): Promise<{ week: string; days: string[]; people: TimesheetPerson[] }> {
  const days = weekDays(week);
  const [entries, shifts] = await Promise.all([
    models.ClockEntry.find({ serviceDay: { $in: days } }).sort({ in: 1 }).lean(),
    models.Shift.find({ serviceDay: { $in: days } }).sort({ start: 1 }).lean(),
  ]);
  const ids = [...new Set([...entries.map((e) => String(e.staffId)), ...shifts.map((s) => String(s.staffId))])];
  const staff = await models.Staff.find({ _id: { $in: ids } }, { name: 1, role: 1 }).lean();
  const price = priced(entries, now);
  const people: TimesheetPerson[] = staff.map((s) => {
    const id = String(s._id);
    const mine = entries.filter((e) => String(e.staffId) === id);
    const rows = mine.map((e): TimesheetEntry => {
      const p = price.get(String(e._id))!;
      return {
        id: String(e._id),
        serviceDay: e.serviceDay,
        in: e.in.toISOString(),
        out: e.out ? e.out.toISOString() : null,
        minutes: p.minutes,
        overtimeMinutes: p.overtimeMinutes,
        cost: p.cost,
        rate: e.rate,
        edited: e.edits.length > 0,
        forgot: !e.out && now.getTime() - e.in.getTime() > TIME_CLOCK.forgotOutH * HOUR_MS,
      };
    });
    const myShifts = shifts.filter((x) => String(x.staffId) === id);
    return {
      staffId: id,
      name: s.name,
      role: s.role,
      entries: rows,
      shifts: myShifts.map(shiftRow),
      minutes: rows.reduce((n, r) => n + (r.minutes ?? 0), 0),
      overtimeMinutes: rows.reduce((n, r) => n + r.overtimeMinutes, 0),
      cost: rows.reduce((n, r) => n + r.cost, 0),
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return { week, days, people };
}

const assertSpan = (inAt: Date, outAt: Date): void => {
  if (outAt.getTime() - inAt.getTime() > TIME_CLOCK.forgotOutH * HOUR_MS) {
    throw new ApiError(400, "validation", `An entry can be at most ${TIME_CLOCK.forgotOutH} h`);
  }
};

/** POST /api/timesheets/entries: a closed entry for a missed punch, priced at the rate in force at `in`. */
export async function addEntry(models: Models, b: { staffId: string; in: Date; out: Date; reason: string }, by: { staffId: string; now: Date }): Promise<string> {
  if (!isOid(b.staffId)) throw notFound();
  const s = await models.Staff.findById(b.staffId, { role: 1, rates: 1 }).lean();
  if (!s) throw notFound();
  if (scheduleGroupOf(s.role) === null) throw new ApiError(400, "station", "Station accounts have no time clock");
  assertSpan(b.in, b.out);
  const e = await models.ClockEntry.create({ staffId: s._id, serviceDay: serviceDayOf(b.in), in: b.in,
    out: b.out,
    rate: rateAt(s.rates, b.in),
    edits: [{ at: by.now, byStaffId: by.staffId, reason: b.reason, before: null }],
  });
  return String(e._id);
}

/** PUT /api/timesheets/entries/:id: records the old times in `edits`, re-derives the service day and reprices at the new start. */
export async function editEntry(
  models: Models,
  id: string,
  b: { in: Date; out: Date; reason: string },
  by: { staffId: string; now: Date },
): Promise<string> {
  if (!isOid(id)) throw notFound();
  const e = await models.ClockEntry.findById(id);
  if (!e) throw notFound();
  assertSpan(b.in, b.out);
  const s = await models.Staff.findById(e.staffId, { rates: 1 }).lean();
  await models.ClockEntry.updateOne(
    { _id: e._id },
    {
      $set: { in: b.in, out: b.out, serviceDay: serviceDayOf(b.in), rate: rateAt(s?.rates ?? [], b.in) },
      $push: { edits: { at: by.now, byStaffId: by.staffId, reason: b.reason, before: { in: e.in, out: e.out } } },
    },
  );
  return String(e.staffId);
}
