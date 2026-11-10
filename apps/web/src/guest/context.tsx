import { createContext, useContext } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { CartApi } from "./cart";
import type { MenuItem, MenuResponse, TableResponse } from "./types";

export type GuestContextValue = {
  token: string;
  table: UseQueryResult<TableResponse>;
  menu: UseQueryResult<MenuResponse>;
  itemsById: Map<string, MenuItem>;
  cart: CartApi;
  /** Ends the visit on this page: shows VisitEnded and clears the cart. */
  endVisit: () => void;
  /** Adopts the check an order reply named as this page's visit. */
  adoptVisit: (checkId: string) => void;
  /** Called by the cart after every successful order. */
  orderPlaced: (orderId: string) => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
};

export const GuestContext = createContext<GuestContextValue | null>(null);

export function useGuest(): GuestContextValue {
  const v = useContext(GuestContext);
  if (!v) throw new Error("useGuest must be used inside <GuestApp>");
  return v;
}

export const guestKeys = {
  table: (token: string) => ["guest", "table", token] as const,
  menu: (token: string) => ["guest", "menu", token] as const,
  orders: (token: string) => ["guest", "orders", token] as const,
};
