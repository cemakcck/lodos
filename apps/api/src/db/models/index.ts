import type { Connection } from "mongoose";
import { adjustmentSchema } from "./adjustment";
import { availabilitySchema } from "./availability";
import { callSchema } from "./call";
import { categorySchema } from "./category";
import { checkSchema } from "./check";
import { clockEntrySchema } from "./clockEntry";
import { dailySummarySchema } from "./dailySummary";
import { expenseSchema } from "./expense";
import { expenseCategorySchema } from "./expenseCategory";
import { menuItemSchema } from "./menuItem";
import { orderSchema } from "./order";
import { photoSchema } from "./photo";
import { ratingSchema } from "./rating";
import { rateClaimSchema } from "./rateClaim";
import { rateEventSchema } from "./rateEvent";
import { roomSchema } from "./room";
import { sandboxSchema } from "./sandbox";
import { sessionSchema } from "./session";
import { settingSchema } from "./setting";
import { shiftSchema } from "./shift";
import { shiftTemplateSchema } from "./shiftTemplate";
import { staffSchema } from "./staff";
import { tableSchema } from "./table";
import { tenantSchema } from "./tenant";
import { ticketSchema } from "./ticket";

/** Compiles every model on `conn`. Models are per connection, so several apps can coexist in one process. */
export function registerModels(conn: Connection) {
  return {
    Tenant: conn.model("Tenant", tenantSchema),
    Sandbox: conn.model("Sandbox", sandboxSchema),
    Category: conn.model("Category", categorySchema),
    MenuItem: conn.model("MenuItem", menuItemSchema),
    Room: conn.model("Room", roomSchema),
    Table: conn.model("Table", tableSchema),
    Check: conn.model("Check", checkSchema),
    Order: conn.model("Order", orderSchema),
    Ticket: conn.model("Ticket", ticketSchema),
    Call: conn.model("Call", callSchema),
    Availability: conn.model("Availability", availabilitySchema),
    Staff: conn.model("Staff", staffSchema),
    Session: conn.model("Session", sessionSchema),
    RateEvent: conn.model("RateEvent", rateEventSchema),
    RateClaim: conn.model("RateClaim", rateClaimSchema),
    Photo: conn.model("Photo", photoSchema),
    Setting: conn.model("Setting", settingSchema),
    Adjustment: conn.model("Adjustment", adjustmentSchema),
    DailySummary: conn.model("DailySummary", dailySummarySchema),
    Shift: conn.model("Shift", shiftSchema),
    ShiftTemplate: conn.model("ShiftTemplate", shiftTemplateSchema),
    Rating: conn.model("Rating", ratingSchema),
    ClockEntry: conn.model("ClockEntry", clockEntrySchema),
    Expense: conn.model("Expense", expenseSchema),
    ExpenseCategory: conn.model("ExpenseCategory", expenseCategorySchema),
  };
}

export type Models = ReturnType<typeof registerModels>;

/** Hydrated document types, for function signatures in later modules. */
export type TenantDoc = InstanceType<Models["Tenant"]>;
export type SandboxDoc = InstanceType<Models["Sandbox"]>;
export type CategoryDoc = InstanceType<Models["Category"]>;
export type MenuItemDoc = InstanceType<Models["MenuItem"]>;
export type RoomDoc = InstanceType<Models["Room"]>;
export type TableDoc = InstanceType<Models["Table"]>;
export type CheckDoc = InstanceType<Models["Check"]>;
export type OrderDoc = InstanceType<Models["Order"]>;
export type TicketDoc = InstanceType<Models["Ticket"]>;
export type CallDoc = InstanceType<Models["Call"]>;
export type AvailabilityDoc = InstanceType<Models["Availability"]>;
export type StaffDoc = InstanceType<Models["Staff"]>;
export type SessionDoc = InstanceType<Models["Session"]>;
export type RateEventDoc = InstanceType<Models["RateEvent"]>;
export type PhotoDoc = InstanceType<Models["Photo"]>;
export type SettingDoc = InstanceType<Models["Setting"]>;
export type AdjustmentDoc = InstanceType<Models["Adjustment"]>;
export type DailySummaryDoc = InstanceType<Models["DailySummary"]>;
export type ShiftDoc = InstanceType<Models["Shift"]>;
export type ShiftTemplateDoc = InstanceType<Models["ShiftTemplate"]>;
export type RatingDoc = InstanceType<Models["Rating"]>;
export type ClockEntryDoc = InstanceType<Models["ClockEntry"]>;
export type ExpenseDoc = InstanceType<Models["Expense"]>;
export type ExpenseCategoryDoc = InstanceType<Models["ExpenseCategory"]>;

/** Model names whose collections are tenant-scoped (everything except Sandbox, RateEvent and RateClaim). */
export const TENANT_SCOPED_MODELS = [
  "Tenant",
  "Category",
  "MenuItem",
  "Room",
  "Table",
  "Check",
  "Order",
  "Ticket",
  "Call",
  "Availability",
  "Staff",
  "Session",
  "Photo",
  "Setting",
  "Adjustment",
  "DailySummary",
  "Shift",
  "ShiftTemplate",
  "Rating",
  "ClockEntry",
  "Expense",
  "ExpenseCategory",
] as const satisfies readonly (keyof Models)[];

/**
 * Models of the most recently built, still-open app. For domain modules (e.g. `placeOrder`) whose signatures
 * take no models argument. Several open apps in one process (tests) share one database, so any of them is correct.
 */
const active: Models[] = [];

export function getModels(): Models {
  const m = active.at(-1);
  if (!m) throw new Error("no models bound: build the app first");
  return m;
}

/** Called by `buildApp`; returns the unbind function `close()` runs. */
export function bindModels(m: Models): () => void {
  active.push(m);
  return () => {
    const i = active.lastIndexOf(m);
    if (i >= 0) active.splice(i, 1);
  };
}
