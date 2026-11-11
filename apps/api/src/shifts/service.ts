import {
  addDays,
  clockSpanMinutes,
  isStationRole,
  istanbulClock,
  SCHEDULE_GROUPS,
  scheduleGroupOf,
  scheduleWarnings,
  SHIFT_LIMITS,
  shiftMinutes,
  shiftSpan,
  weekDays,
  type ScheduleGroup,
  type ScheduleShift,
  type ScheduleWarning,
  type ShiftArea,
  type ShiftBody,
  type ShiftPatchBody,
  type ShiftTemplateBody,
  type ShiftTemplatePatchBody,
  type StaffRole,
} from "@lodos/shared";
import type { Types } from "mongoose";
import type { Models } from "../db/models";
import { ApiError } from "../errors";
import { isOid, notFound } from "../kds/service";

export type ShiftRow = {
  id: string;
  staffId: string;
  serviceDay: string;
  /** Wall-clock "HH:MM" (Istanbul). */
  start: string;
  end: string;
  /** ISO instants. */
  startAt: string;
  endAt: string;
  area: ShiftArea;
  note: string | null;
  minutes: number;
};

export type SchedulePerson = { id: string; name: string; role: StaffRole; group: ScheduleGroup; active: boolean };

export type WeekView = {
  week: string;
  days: string[];
  people: SchedulePerson[];
  shifts: ShiftRow[];
  totals: { byPerson: Record<string, number>; byDay: Record<string, number> };
  warnings: ScheduleWarning[];
};

export type TemplateRow = { id: string; name: string; start: string; end: string; area: ShiftArea; sort: number; minutes: number };

type ShiftLean = {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  serviceDay: string;
  start: Date;
  end: Date;
  area: ShiftArea;
  note?: string | null;
};

export function rowOf(s: ShiftLean): ShiftRow {
  return {
    id: String(s._id),
    staffId: String(s.staffId),
    serviceDay: s.serviceDay,
    start: istanbulClock(s.start),
    end: istanbulClock(s.end),
    startAt: s.start.toISOString(),
    endAt: s.end.toISOString(),
    area: s.area,
    note: s.note ?? null,
    minutes: shiftMinutes(s),
  };
}

const scheduleShift = (s: ShiftLean): ScheduleShift => ({
  id: String(s._id),
  staffId: String(s.staffId),
  serviceDay: s.serviceDay,
  start: s.start,
  end: s.end,
});

/** The hard length rule (spec §6.2): at most 16 h. */
function assertLength(start: string, end: string): void {
  if (clockSpanMinutes(start, end) > SHIFT_LIMITS.maxShiftH * 60) {
    throw new ApiError(400, "shift_too_long", `A shift can be at most ${SHIFT_LIMITS.maxShiftH} h`);
  }
}

/** A person who can be on the schedule: this tenant's (404) and not a station account (400). Inactive people can. */
async function assertSchedulable(models: Models, staffId: string): Promise<void> {
  if (!isOid(staffId)) throw notFound();
  const person = await models.Staff.findById(staffId, { role: 1 }).lean();
  if (!person) throw notFound();
  if (isStationRole(person.role)) throw new ApiError(400, "station", "Station accounts are not on the schedule");
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean => a.start < b.end && a.end > b.start;

/** A person can't have two overlapping shifts (touching is fine): 409 naming the other shift. */
async function assertNoOverlap(models: Models, staffId: string, span: { start: Date; end: Date }, exceptId?: Types.ObjectId): Promise<void> {
  const other = await models.Shift.findOne(
    { staffId, start: { $lt: span.end }, end: { $gt: span.start }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
    { _id: 1 },
  ).lean();
  if (other) throw new ApiError(409, "shift_overlap", "That person already has a shift at that time", { shiftId: String(other._id) });
}

const noteOf = (note: string | null | undefined): string | null => (note ? note : null);

/** GET /api/shifts: the week's people, shifts, totals (minutes) and warnings. */
export async function weekView(models: Models, week: string): Promise<WeekView> {
  const days = weekDays(week);
  // Two days before the week, for the rest rule: a shift of day −2 can end as late as 22:00 on day −1.
  const before = [addDays(week, -2), addDays(week, -1)];
  const [staff, fetched] = await Promise.all([
    models.Staff.find({}, { name: 1, role: 1, active: 1 }).lean(),
    models.Shift.find({ serviceDay: { $in: [...before, ...days] } }).sort({ start: 1 }).lean(),
  ]);
  const inWeek = new Set(days);
  const shifts = fetched.filter((s) => inWeek.has(s.serviceDay));
  const working = new Set(shifts.map((s) => String(s.staffId)));

  const people: SchedulePerson[] = [];
  for (const s of staff) {
    const group = scheduleGroupOf(s.role);
    const id = String(s._id);
    if (group && (s.active || working.has(id))) people.push({ id, name: s.name, role: s.role, group, active: s.active });
  }
  people.sort(
    (a, b) =>
      SCHEDULE_GROUPS.indexOf(a.group) - SCHEDULE_GROUPS.indexOf(b.group) ||
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, "tr"),
  );

  const byPerson: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  const byDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const s of shifts) {
    const minutes = shiftMinutes(s);
    byPerson[String(s.staffId)] = (byPerson[String(s.staffId)] ?? 0) + minutes;
    byDay[s.serviceDay] = (byDay[s.serviceDay] ?? 0) + minutes;
  }

  const inactive = new Set(staff.filter((s) => !s.active).map((s) => String(s._id)));
  return {
    week,
    days,
    people,
    shifts: shifts.map(rowOf),
    totals: { byPerson, byDay },
    warnings: scheduleWarnings(fetched.map(scheduleShift), { week: days, inactive }),
  };
}

/** POST /api/shifts. */
export async function createShift(models: Models, body: ShiftBody): Promise<ShiftRow> {
  assertLength(body.start, body.end);
  await assertSchedulable(models, body.staffId);
  const span = shiftSpan(body.serviceDay, body.start, body.end);
  await assertNoOverlap(models, body.staffId, span);
  const doc = await models.Shift.create({
    staffId: body.staffId,
    serviceDay: body.serviceDay,
    ...span,
    area: body.area,
    note: noteOf(body.note),
  });
  return rowOf(doc);
}

async function findShift(models: Models, id: string) {
  if (!isOid(id)) throw notFound();
  const doc = await models.Shift.findById(id);
  if (!doc) throw notFound();
  return doc;
}

/** PATCH /api/shifts/:id: any subset of the fields, checked as a whole (the shift itself never overlaps itself). */
export async function updateShift(models: Models, id: string, patch: ShiftPatchBody): Promise<ShiftRow> {
  const doc = await findShift(models, id);
  const next = {
    staffId: patch.staffId ?? String(doc.staffId),
    serviceDay: patch.serviceDay ?? doc.serviceDay,
    start: patch.start ?? istanbulClock(doc.start),
    end: patch.end ?? istanbulClock(doc.end),
    area: patch.area ?? doc.area,
    note: patch.note === undefined ? (doc.note ?? null) : noteOf(patch.note),
  };
  assertLength(next.start, next.end);
  await assertSchedulable(models, next.staffId);
  const span = shiftSpan(next.serviceDay, next.start, next.end);
  await assertNoOverlap(models, next.staffId, span, doc._id);
  doc.set({ staffId: next.staffId, serviceDay: next.serviceDay, ...span, area: next.area, note: next.note });
  await doc.save();
  return rowOf(doc);
}

/** DELETE /api/shifts/:id. */
export async function deleteShift(models: Models, id: string): Promise<void> {
  if (!isOid(id)) throw notFound();
  const res = await models.Shift.deleteOne({ _id: id });
  if (res.deletedCount === 0) throw notFound();
}

/**
 * POST /api/shifts/copy-last-week: the previous week's shifts, 7 days later, for people who are still active.
 * A copy that would overlap an existing shift (or an earlier copy) of the same person is skipped. Istanbul has no DST,
 * so +7 days is +7 × 24 h on the instants too.
 */
export async function copyLastWeek(models: Models, week: string): Promise<{ copied: number; skipped: number }> {
  const [source, staff] = await Promise.all([
    models.Shift.find({ serviceDay: { $in: weekDays(addDays(week, -7)) } }).sort({ start: 1 }).lean(),
    models.Staff.find({ active: true }, { role: 1 }).lean(),
  ]);
  const active = new Set(staff.filter((s) => !isStationRole(s.role)).map((s) => String(s._id)));
  const WEEK_MS = 7 * 86_400_000;
  const copies = source
    .filter((s) => active.has(String(s.staffId)))
    .map((s) => ({
      staffId: s.staffId,
      serviceDay: addDays(s.serviceDay, 7),
      start: new Date(s.start.getTime() + WEEK_MS),
      end: new Date(s.end.getTime() + WEEK_MS),
      area: s.area,
      note: s.note ?? null,
    }));
  if (copies.length === 0) return { copied: 0, skipped: 0 };

  const from = new Date(Math.min(...copies.map((c) => c.start.getTime())));
  const to = new Date(Math.max(...copies.map((c) => c.end.getTime())));
  const existing = await models.Shift.find(
    { staffId: { $in: [...new Set(copies.map((c) => c.staffId))] }, start: { $lt: to }, end: { $gt: from } },
    { staffId: 1, start: 1, end: 1 },
  ).lean();
  const taken = existing.map((s) => ({ staffId: String(s.staffId), start: s.start, end: s.end }));
  const insert: typeof copies = [];
  for (const c of copies) {
    const staffId = String(c.staffId);
    if (taken.some((x) => x.staffId === staffId && overlaps(x, c))) continue;
    taken.push({ staffId, start: c.start, end: c.end });
    insert.push(c);
  }
  if (insert.length > 0) await models.Shift.insertMany(insert);
  return { copied: insert.length, skipped: copies.length - insert.length };
}

/** GET /api/me/shifts: one person's shifts for `week` and the week after. */
export async function myShifts(models: Models, staffId: string, week: string): Promise<{ weeks: { week: string; shifts: ShiftRow[]; minutes: number }[] }> {
  const weeks = [week, addDays(week, 7)];
  const all = await models.Shift.find({ staffId, serviceDay: { $in: weeks.flatMap(weekDays) } }).sort({ start: 1 }).lean();
  return {
    weeks: weeks.map((w) => {
      const days = new Set(weekDays(w));
      const shifts = all.filter((s) => days.has(s.serviceDay)).map(rowOf);
      return { week: w, shifts, minutes: shifts.reduce((n, s) => n + s.minutes, 0) };
    }),
  };
}

type TemplateLean = { _id: Types.ObjectId; name: string; start: string; end: string; area: ShiftArea; sort: number };

const templateRow = (t: TemplateLean): TemplateRow => ({
  id: String(t._id),
  name: t.name,
  start: t.start,
  end: t.end,
  area: t.area,
  sort: t.sort,
  minutes: clockSpanMinutes(t.start, t.end),
});

/** GET /api/shift-templates, by `sort`. */
export async function listTemplates(models: Models): Promise<TemplateRow[]> {
  const rows = await models.ShiftTemplate.find({}).sort({ sort: 1, _id: 1 }).lean();
  return rows.map(templateRow);
}

/** POST /api/shift-templates. Without `sort`, it goes last. */
export async function createTemplate(models: Models, body: ShiftTemplateBody): Promise<TemplateRow> {
  assertLength(body.start, body.end);
  const last = await models.ShiftTemplate.findOne({}, { sort: 1 }).sort({ sort: -1 }).lean();
  const doc = await models.ShiftTemplate.create({ ...body, sort: body.sort ?? (last ? last.sort + 1 : 0) });
  return templateRow(doc);
}

/** PATCH /api/shift-templates/:id. */
export async function updateTemplate(models: Models, id: string, patch: ShiftTemplatePatchBody): Promise<TemplateRow> {
  if (!isOid(id)) throw notFound();
  const doc = await models.ShiftTemplate.findById(id);
  if (!doc) throw notFound();
  assertLength(patch.start ?? doc.start, patch.end ?? doc.end);
  doc.set(patch);
  await doc.save();
  return templateRow(doc);
}

/** DELETE /api/shift-templates/:id. */
export async function deleteTemplate(models: Models, id: string): Promise<void> {
  if (!isOid(id)) throw notFound();
  const res = await models.ShiftTemplate.deleteOne({ _id: id });
  if (res.deletedCount === 0) throw notFound();
}
