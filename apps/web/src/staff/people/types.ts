/* Wire types for `/api/staff`. */
import type { StaffRole } from "../auth";

export type WhyNot = "self" | "last_manager" | "station" | "demo_protected" | null;

export interface StaffRow {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  lastSignInAt: string | null;
  tables: { id: string; name: string; roomId: string }[];
  tableRanges: string;
  demoProtected: boolean;
  canDeactivate: boolean;
  whyNot: WhyNot;
}

export interface StaffList {
  people: StaffRow[];
  stations: StaffRow[];
}

/** The roles the form offers, in order. Stations are fixed accounts and never picked. */
export const PERSON_ROLES = ["waiter", "manager", "cook", "bartender", "host", "dishwasher"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

/** Under ["manager", …] so table events (a section changed) refresh it. */
export const peopleKey = ["manager", "people"] as const;
