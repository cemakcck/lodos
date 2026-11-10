import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "../lib/api";
import { useLive } from "../lib/useLive";
import { useCart } from "./cart";
import { GuestContext, guestKeys, type GuestContextValue } from "./context";
import { CartBar, CartSheet } from "./Cart";
import { VisitEnded, InvalidTable } from "./VisitEnded";
import { SalonDefs } from "./ui";
import type { MenuResponse, TableResponse } from "./types";

export type FirstOrderInfo = { orderId: string; dismiss: () => void };

export type GuestAppProps = {
  /**
   * Task 15 hook: rendered once, after this page's first successful order (the "kitchen callout" in demo mode).
   * Call `dismiss()` to hide it. Nothing renders when omitted.
   */
  afterFirstOrder?: (info: FirstOrderInfo) => ReactNode;
  /** Called after every successful order, with its id. */
  onOrderPlaced?: (orderId: string) => void;
};

/** Layout route for `/t/:token` and `/t/:token/table`: data, live updates, cart, visit tracking. */
export function GuestApp({ afterFirstOrder, onOrderPlaced }: GuestAppProps = {}) {
  const { token = "" } = useParams();
  const table = useQuery({
    queryKey: guestKeys.table(token),
    queryFn: () => api<TableResponse>("/api/guest/table", { tableToken: token }),
  });
  const menu = useQuery({
    queryKey: guestKeys.menu(token),
    queryFn: () => api<MenuResponse>("/api/guest/menu", { tableToken: token }),
    enabled: table.isSuccess,
  });
  const cart = useCart(token);
  useLive({ audience: "guest", tableToken: token });

  const [ended, setEnded] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [firstOrder, setFirstOrder] = useState<string | null>(null);
  const hadOrder = useRef(false);

  // Visit ended: the table now shows a different (or no) visit than the one this cart belonged to.
  const visitId = table.data ? (table.data.visit?.checkId ?? null) : undefined;
  const { checkId } = cart.cart;
  if (!ended && visitId !== undefined && checkId !== null && visitId !== checkId) setEnded(true);

  const { update } = cart;
  useEffect(() => {
    if (ended) {
      update((c) => (c.checkId === null && c.lines.length === 0 && c.idempotencyKey === null ? c : { checkId: null, lines: [], idempotencyKey: null }));
    } else if (visitId && checkId === null) {
      // Adopt the open visit: later orders must land on this check or be refused.
      update((c) => (c.checkId === null ? { ...c, checkId: visitId } : c));
    }
  }, [ended, visitId, checkId, update]);

  const endVisit = useCallback(() => {
    setEnded(true);
    setCartOpen(false);
  }, []);

  const orderPlaced = useCallback(
    (orderId: string) => {
      if (!hadOrder.current) {
        hadOrder.current = true;
        setFirstOrder(orderId);
      }
      onOrderPlaced?.(orderId);
    },
    [onOrderPlaced],
  );

  const itemsById = useMemo(() => new Map((menu.data?.items ?? []).map((i) => [i.id, i])), [menu.data]);

  const ctx: GuestContextValue = { token, table, menu, itemsById, cart, endVisit, orderPlaced, cartOpen, setCartOpen };

  const invalid = table.error instanceof ApiClientError && table.error.status === 404;

  return (
    <GuestContext.Provider value={ctx}>
      <div className="theme-guest guest-page">
        <SalonDefs />
        <div className="guest-column">
          {invalid ? (
            <InvalidTable />
          ) : ended ? (
            <VisitEnded />
          ) : (
            <>
              <Outlet />
              <CartBar />
              {cartOpen && <CartSheet onClose={() => setCartOpen(false)} />}
            </>
          )}
          {firstOrder && afterFirstOrder && !ended && (
            <div data-slot="kitchen-callout">{afterFirstOrder({ orderId: firstOrder, dismiss: () => setFirstOrder(null) })}</div>
          )}
        </div>
      </div>
    </GuestContext.Provider>
  );
}
