import { z } from "zod";
import { COMP_REASONS, VOID_REASONS } from "./adjustments";
import { ALLERGENS } from "./allergens";
import { isMonday, SHIFT_AREAS } from "./shifts";
import { LOGIN_ROLES, SCHEDULE_ROLES } from "./staff";
import { TABLE_NAME_RE } from "./tables";

const OptionSelectionSchema = z.object({ groupId: z.string(), optionIds: z.array(z.string()) });

export const OrderItemRequest = z.object({
  itemId: z.string(),
  qty: z.number().int().min(1).max(20),
  options: z.array(OptionSelectionSchema),
  note: z.string().max(140).optional(),
  seat: z.number().int().min(1).max(20).optional(),
});
export type OrderItemRequest = z.infer<typeof OrderItemRequest>;

export const OrderRequest = z.object({
  idempotencyKey: z.uuid(),
  /**
   * The check (visit) the guest page was showing. When present and it is no longer the table's open check, the
   * order is refused with `check_closed`, so a stale page never orders onto the next party's check.
   */
  expectedCheckId: z.string().max(64).optional(),
  items: z
    .array(OrderItemRequest)
    .min(1)
    .refine((items) => items.reduce((n, i) => n + i.qty, 0) <= 20, { message: "Total quantity must be at most 20" }),
});
export type OrderRequest = z.infer<typeof OrderRequest>;

/** Login (waiter, manager), station (kitchen, bar) and schedule-only (cook, bartender, host, dishwasher): see staff.ts. */
export const StaffRole = z.enum(["waiter", "kitchen", "bar", "manager", "cook", "bartender", "host", "dishwasher"]);
export type StaffRole = z.infer<typeof StaffRole>;

export const DemoRole = z.enum(["guest", "waiter", "kitchen", "bar", "manager"]);
export type DemoRole = z.infer<typeof DemoRole>;

const Loc = z.object({ en: z.string().trim().min(1).max(200), tr: z.string().trim().min(1).max(200) });
const LocLong = z.object({ en: z.string().trim().min(1).max(1000), tr: z.string().trim().min(1).max(1000) });
const LocOptional = z.object({ en: z.string().trim().max(2000), tr: z.string().trim().max(2000) });

export const DIETARY = ["vegetarian", "vegan", "gluten-free"] as const;

const OptionInput = z.object({ id: z.string().min(1).max(64).optional(), name: Loc, priceDelta: z.number().int() });
const OptionGroupInput = z.object({
  /** Omit for a new group: the server generates one. Sent ids are kept, so edits stay stable. */
  id: z.string().min(1).max(64).optional(),
  name: Loc,
  type: z.enum(["single", "multi"]),
  required: z.boolean(),
  options: z.array(OptionInput).max(30),
});

/** Manager menu-item editor body (POST /api/manager/items; PATCH takes `.partial()`). Money in integer kuruş. */
export const MenuItemInput = z.object({
  categoryId: z.string().min(1),
  name: Loc,
  description: LocLong,
  story: LocOptional.optional(),
  price: z.number().int().min(1),
  station: z.enum(["kitchen", "bar"]),
  vatRate: z.union([z.literal(10), z.literal(20)]).default(10),
  dietary: z.array(z.enum(DIETARY)).max(DIETARY.length).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  optionGroups: z
    .array(OptionGroupInput)
    .max(20)
    .superRefine((groups, ctx) => {
      const seen = new Set<string>();
      groups.forEach((g, gi) => {
        if (g.id !== undefined) {
          if (seen.has(g.id)) ctx.addIssue({ code: "custom", path: [gi, "id"], message: `Duplicate option group id "${g.id}"` });
          seen.add(g.id);
        }
        const opts = new Set<string>();
        g.options.forEach((o, oi) => {
          if (o.id === undefined) return;
          if (opts.has(o.id)) ctx.addIssue({ code: "custom", path: [gi, "options", oi, "id"], message: `Duplicate option id "${o.id}" in group` });
          opts.add(o.id);
        });
      });
    })
    .default([]),
  active: z.boolean().default(true),
  sort: z.number().int().optional(),
});
export type MenuItemInput = z.input<typeof MenuItemInput>;

export const CategoryInput = z.object({
  name: Loc,
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
  /** VAT rate a new item in this category starts with. */
  defaultVatRate: z.union([z.literal(10), z.literal(20)]).optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const AvailabilityInput = z.object({
  soldOut: z.boolean().optional(),
  remaining: z.number().int().min(0).nullable().optional(),
});
export type AvailabilityInput = z.infer<typeof AvailabilityInput>;

export const TABLE_CAPACITY_MIN = 1;
export const TABLE_CAPACITY_MAX = 12;

/** The Tables screen's edit: the floor plan's seat range; the server also applies its name rules (`editTable`). */
export const TableEdit = z.object({
  name: z.string().regex(TABLE_NAME_RE).optional(),
  capacity: z.number().int().min(TABLE_CAPACITY_MIN).max(TABLE_CAPACITY_MAX).optional(),
});
export type TableEdit = z.infer<typeof TableEdit>;

/** Floor plan editor (spec §7). Every room is this size unless it says otherwise. */
export const ROOM_DEFAULT_WIDTH = 800;
export const ROOM_DEFAULT_HEIGHT = 480;
export const TABLE_MAX_SIZE = 400;

/** Per-table reasons a layout save is refused (`400 layout_invalid`, `details.problems: [{ key, code }]`). */
export const LAYOUT_PROBLEM_CODES = [
  "name_invalid",
  "name_taken",
  "out_of_bounds",
  "overlap",
  "capacity",
  "waiter",
  "unknown",
  "open_check_rename",
  "open_check_delete",
] as const;
export type LayoutProblemCode = (typeof LAYOUT_PROBLEM_CODES)[number];
export type LayoutProblem = { key: string; code: LayoutProblemCode };

/**
 * One table of a layout save. `id` is set for an existing table of the room (clients send `key = id` then); a new
 * table has only a `key`. Name, capacity and position are checked by the server and reported as problems, so they
 * are only shape-checked here; sizes are hard limits.
 */
export const LayoutTableInput = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(64),
  name: z.string().max(16),
  shape: z.enum(["round", "rect"]),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1).max(TABLE_MAX_SIZE),
  h: z.number().int().min(1).max(TABLE_MAX_SIZE),
  capacity: z.number().int(),
  sectionStaffId: z.string().nullable(),
});
export type LayoutTableInput = z.infer<typeof LayoutTableInput>;

const distinct = (xs: string[]) => new Set(xs).size === xs.length;

/** PUT /api/rooms/:id/layout: the whole room, saved against the `version` it was loaded at. */
export const LayoutBody = z
  .object({ version: z.number().int().min(0), tables: z.array(LayoutTableInput).max(300) })
  .refine((b) => distinct(b.tables.map((x) => x.key)), "Table keys must be unique")
  .refine((b) => distinct(b.tables.flatMap((x) => (x.id === undefined ? [] : [x.id]))), "Table ids must be unique");
export type LayoutBody = z.infer<typeof LayoutBody>;

export const RoomBody = z.object({ name: z.string().trim().min(1).max(40) });
export type RoomBody = z.infer<typeof RoomBody>;

/** 4 to 6 digits. The one PIN rule: the API's login and approval both use it. */
export const PinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

/** A manager's PIN entered on someone else's tablet (comps, voids). */
export const ApprovalBody = z.object({
  managerId: z.string().refine((s) => /^[0-9a-f]{24}$/i.test(s), "Invalid manager id"),
  pin: PinSchema,
});
export type ApprovalBody = z.infer<typeof ApprovalBody>;

const ObjectIdString = z.string().refine((s) => /^[0-9a-f]{24}$/i.test(s), "Invalid id");
/** A person's role in the Staff screen: login or schedule-only (stations are fixed, never picked). */
export const PersonRole = z.enum([...LOGIN_ROLES, ...SCHEDULE_ROLES]);
export type PersonRole = z.infer<typeof PersonRole>;
const StaffName = z.string().trim().min(1).max(60);

/** POST /api/staff. `pin` is required for waiter and manager and refused for schedule-only roles. */
export const StaffCreateBody = z.object({
  name: StaffName,
  role: PersonRole,
  pin: PinSchema.optional(),
  tableIds: z.array(ObjectIdString).max(200).optional(),
});
export type StaffCreateBody = z.infer<typeof StaffCreateBody>;

/** PATCH /api/staff/:id. `tableIds` is the person's full section: listed tables move to them, others they had are unassigned. */
export const StaffPatchBody = StaffCreateBody.partial();
export type StaffPatchBody = z.infer<typeof StaffPatchBody>;

/** POST /api/staff/:id/pin. */
export const StaffPinBody = z.object({ pin: PinSchema });

const ShareCount = z.number().int().min(2).max(20);

/** PUT /api/checks/:id/split. `full` removes the split; `items` sends every assignment (units absent are unassigned). */
export const SplitBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("full") }),
  z.object({ mode: z.literal("even"), count: ShareCount }),
  z.object({
    mode: z.literal("items"),
    count: ShareCount,
    assignments: z
      .array(z.object({ unit: z.string().min(1).max(100), labels: z.array(z.string().min(1).max(2)).max(20) }))
      .max(1000),
  }),
]);
export type SplitBody = z.infer<typeof SplitBody>;

/** POST /api/checks/:id/shares/:label/pay. `amount` confirms the share amount the client was shown (kuruş). */
export const PayShareBody = z.object({ method: z.enum(["card", "cash"]), amount: z.number().int().min(0) });
export type PayShareBody = z.infer<typeof PayShareBody>;

/**
 * POST /api/checks/:id/adjustments: comp or void `qty` units of one order line (`lineRef` = "<orderId>:<index>").
 * The reason comes from the kind's list; the note is required only for "other" (at most 140 characters).
 * `approval` is a manager's PIN, needed unless the requester is a manager.
 */
export const AdjustBody = z
  .object({
    lineRef: z.string().regex(/^[0-9a-f]{24}:\d{1,3}$/i, "Invalid line"),
    kind: z.enum(["comp", "void"]),
    qty: z.number().int().min(1).max(99),
    reason: z.string().min(1).max(40),
    note: z.string().trim().max(140).nullish(),
    approval: ApprovalBody.optional(),
  })
  .superRefine((b, ctx) => {
    const reasons: readonly string[] = b.kind === "comp" ? COMP_REASONS : VOID_REASONS;
    if (!reasons.includes(b.reason)) ctx.addIssue({ code: "custom", path: ["reason"], message: `Unknown ${b.kind} reason` });
    if (b.reason === "other" && !b.note) ctx.addIssue({ code: "custom", path: ["note"], message: "A note is required for Other" });
  });
export type AdjustBody = z.infer<typeof AdjustBody>;

/** "YYYY-MM-DD" that is a real calendar date. */
export const ServiceDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((d) => {
    const ms = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === d;
  }, "Invalid date");
/** A week is named by its Monday service day. */
export const WeekSchema = ServiceDaySchema.refine(isMonday, "A week starts on a Monday");
/** Wall-clock "HH:MM" (Istanbul). */
export const ClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const ShiftArea = z.enum(SHIFT_AREAS);

/** GET /api/shifts?week=<monday>. Without `week`: the week of today's service day. */
export const ShiftWeekQuery = z.object({ week: WeekSchema.optional() });

/** POST /api/shifts. A start before 06:00 is the next morning of `serviceDay`; an end at or before the start is the next day. */
export const ShiftBody = z.object({
  staffId: ObjectIdString,
  serviceDay: ServiceDaySchema,
  start: ClockSchema,
  end: ClockSchema,
  area: ShiftArea,
  note: z.string().trim().max(140).nullish(),
});
export type ShiftBody = z.infer<typeof ShiftBody>;

/** PATCH /api/shifts/:id: any subset, including a move to another person or day. */
export const ShiftPatchBody = ShiftBody.partial();
export type ShiftPatchBody = z.infer<typeof ShiftPatchBody>;

/** POST /api/shifts/copy-last-week. */
export const CopyWeekBody = z.object({ week: WeekSchema });

/** POST /api/shift-templates. */
export const ShiftTemplateBody = z.object({
  name: z.string().trim().min(1).max(40),
  start: ClockSchema,
  end: ClockSchema,
  area: ShiftArea,
  sort: z.number().int().min(0).max(999).optional(),
});
export type ShiftTemplateBody = z.infer<typeof ShiftTemplateBody>;

/** PATCH /api/shift-templates/:id. */
export const ShiftTemplatePatchBody = ShiftTemplateBody.partial();
export type ShiftTemplatePatchBody = z.infer<typeof ShiftTemplatePatchBody>;

const Stars = z.number().int().min(1).max(5);

/** A guest's rating of a paid check (phase 3): at least one star value, integers 1–5, comment up to 500. */
export const GuestRatingBody = z
  .object({
    checkId: z.string().min(1).max(64),
    waiter: Stars.optional(),
    dishes: z.array(z.object({ itemId: z.string().min(1).max(64), stars: Stars })).max(60).optional(),
    food: Stars.optional(),
    cleanliness: Stars.optional(),
    atmosphere: Stars.optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .refine(
    (b) => b.waiter !== undefined || b.food !== undefined || b.cleanliness !== undefined || b.atmosphere !== undefined || (b.dishes?.length ?? 0) > 0,
    "Give at least one rating",
  )
  .refine((b) => new Set(b.dishes?.map((d) => d.itemId)).size === (b.dishes?.length ?? 0), "Each dish can be rated once");
export type GuestRatingBody = z.infer<typeof GuestRatingBody>;

/** POST /api/clock/punch: no session, the person's own (clock) PIN. */
export const ClockPunchBody = z.object({ staffId: ObjectIdString, pin: PinSchema });
export type ClockPunchBody = z.infer<typeof ClockPunchBody>;

/** PUT /api/staff/:id/rate: kuruş per hour. */
export const StaffRateBody = z.object({ kurusPerHour: z.number().int().min(0).max(100_000_00) });
export type StaffRateBody = z.infer<typeof StaffRateBody>;

const ClockReason = z.string().trim().min(1).max(200);

/** PUT /api/timesheets/entries/:id: both instants are required, `out` after `in`. */
export const TimesheetEntryPatchBody = z
  .object({ in: z.coerce.date(), out: z.coerce.date(), reason: ClockReason })
  .refine((b) => b.out > b.in, { message: "Out must be after in", path: ["out"] });
export type TimesheetEntryPatchBody = z.infer<typeof TimesheetEntryPatchBody>;

/** POST /api/timesheets/entries (a missed punch added by a manager). */
export const TimesheetEntryBody = z
  .object({ staffId: ObjectIdString, in: z.coerce.date(), out: z.coerce.date(), reason: ClockReason })
  .refine((b) => b.out > b.in, { message: "Out must be after in", path: ["out"] });
export type TimesheetEntryBody = z.infer<typeof TimesheetEntryBody>;
