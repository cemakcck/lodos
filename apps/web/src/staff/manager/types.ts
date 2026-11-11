/* Wire types for the manager API (`/api/manager/*`). Money is integer kuruş; names are { en, tr }. */
import type { Loc } from "../kds/types";

export type { Loc };
export type Station = "kitchen" | "bar";

export interface OptionView {
  id: string;
  name: Loc;
  priceDelta: number;
}
export interface OptionGroupView {
  id: string;
  name: Loc;
  type: "single" | "multi";
  required: boolean;
  options: OptionView[];
}

export interface Availability {
  soldOut: boolean;
  remaining: number | null;
}

/** One item on `GET /api/manager/menu`, inactive ones included. */
export interface ItemView {
  id: string;
  categoryId: string;
  name: Loc;
  description: Loc;
  story: Loc;
  price: number;
  station: Station;
  /** VAT (KDV) rate in percent. */
  vatRate: 10 | 20;
  dietary: string[];
  allergens: string[];
  /** "/photos/x.jpg" (seeded, served by the web app) or "/api/photos/<id>" (uploaded). */
  photo: string | null;
  optionGroups: OptionGroupView[];
  active: boolean;
  sort: number;
  availability: Availability;
}

export interface CategoryView {
  id: string;
  name: Loc;
  sort: number;
  active: boolean;
  /** VAT rate a new item in this category starts with. */
  defaultVatRate: 10 | 20;
}

export interface ManagerMenu {
  categories: CategoryView[];
  items: ItemView[];
}

/** `GET /api/manager/tables`: the raw token is what the QR encodes. */
export interface ManagerTable {
  id: string;
  name: string;
  capacity: number;
  roomId: string;
  active: boolean;
  token: string;
}

/** All under ["manager", …] so useLive refreshes them on menu, availability and table events. */
export const managerMenuKey = ["manager", "menu"] as const;
export const managerTablesKey = ["manager", "tables"] as const;
export const managerFloorKey = ["manager", "floor"] as const;
export const managerStaffKey = ["manager", "staff"] as const;
