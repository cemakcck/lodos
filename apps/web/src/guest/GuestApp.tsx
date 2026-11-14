import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "../lib/api";
import { useLive } from "../lib/useLive";
import { useCart } from "./cart";
import { useGuestGeneration } from "./session";
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
export function GuestApp(props: GuestAppProps = {}) {
  const { token = "" } = useParams();
  const generation = useGuestGeneration();
  // One page session per table token; `restartGuestPages()` (the demo's guest role switch) starts a fresh one.
  return <GuestSession key={`${token}#${generation}`} token={token} {...props} />;
}

/** The visit this page session belongs to, and the table snapshot it was taken against. */
type OwnVisit = { checkId: string; seen: TableResponse | undefined };

function GuestSession({ token, afterFirstOrder, onOrderPlaced }: GuestAppProps & { token: string }) {
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
  const firstSynced = useRef(false);
  const [own, setOwn] = useState<OwnVisit | null>(null);

  // Only a table snapshot fetched while this page is open counts (not a cached one from an earlier page).
  const snapshot = table.isFetchedAfterMount ? table.data : undefined;
  const visitId = snapshot ? (snapshot.visit?.checkId ?? null) : undefined;
  const { checkId } = cart.cart;

  // VisitEnded only when the visit this page adopted closes or changes while the page is open: a newer table
  // snapshot (not the one we adopted against) shows no visit or another one. A returning guest never lands on it.
  if (!ended && snapshot && own && visitId !== own.checkId && snapshot !== own.seen) setEnded(true);
  // The table confirms the visit the cart holds: from now on this page belongs to it.
  if (!ended && snapshot && visitId && checkId === visitId && own?.checkId !== visitId) {
    setOwn({ checkId: visitId, seen: snapshot });
  }

  const { update } = cart;
  useEffect(() => {
    if (ended) {
      update((c) => (c.checkId === null && c.lines.length === 0 && c.idempotencyKey === null ? c : { checkId: null, lines: [], idempotencyKey: null }));
      return;
    }
    if (visitId === undefined) return;
    if (!firstSynced.current) {
      // First load: a cart saved for an earlier visit is dropped quietly (lines and all) and the menu shows.
      firstSynced.current = true;
      update((c) =>
        c.checkId === visitId ? c : c.checkId === null ? { ...c, checkId: visitId } : { checkId: visitId, lines: [], idempotencyKey: null },
      );
    } else if (visitId && checkId === null) {
      // Adopt a visit opened after the page loaded (a waiter seated the table): later orders must land on it.
      update((c) => (c.checkId === null ? { ...c, checkId: visitId } : c));
    }
  }, [ended, visitId, checkId, update]);

  /** An order reply names its check: adopt it at once, before the table refetch catches up. */
  const adoptVisit = useCallback(
    (id: string) => {
      setOwn((o) => (o?.checkId === id ? o : { checkId: id, seen: table.data }));
      update((c) => ({ ...c, checkId: id }));
    },
    [table.data, update],
  );

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

  const ctx: GuestContextValue = { token, table, menu, itemsById, cart, endVisit, adoptVisit, orderPlaced, cartOpen, setCartOpen };

  const invalid = table.error instanceof ApiClientError && table.error.status === 404;

  return (
    <GuestContext.Provider value={ctx}>
      <div className="theme-guest guest-page">
        <SalonDefs />
        <div className="guest-column">
          {invalid ? (
            <InvalidTable />
          ) : ended ? (
            <VisitEnded checkId={own?.checkId} />
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
