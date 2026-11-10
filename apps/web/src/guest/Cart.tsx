import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ConciergeBell, Trash2 } from "lucide-react";
import { api, ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useFormat } from "../lib/format";
import {
  cartCount, markProblem, orderSucceeded, toOrderRequest, withIdempotencyKey, MAX_LINE_QTY, MAX_ORDER_QTY,
  type Cart, type CartLine, type LineProblem,
} from "./cart";
import { useGuest } from "./context";
import { ArchPhoto, Sheet, Stepper } from "./ui";
import { loc, type MenuItem } from "./types";

/** Unit price of a cart line (base + chosen option deltas), or null when the item left the menu. */
function unitPrice(line: CartLine, item: MenuItem | undefined): number | null {
  if (!item) return null;
  const deltas = line.options.flatMap((s) => {
    const g = item.optionGroups.find((x) => x.id === s.groupId);
    return s.optionIds.map((id) => g?.options.find((o) => o.id === id)?.priceDelta ?? 0);
  });
  return item.price + deltas.reduce((a, b) => a + b, 0);
}

export function cartTotal(cart: Cart, items: Map<string, MenuItem>): number {
  return cart.lines.reduce((sum, l) => sum + (unitPrice(l, items.get(l.itemId)) ?? 0) * l.qty, 0);
}

/** The line's problem: refused by the server last time, or now sold out / gone from the live menu. */
function problemOf(line: CartLine, item: MenuItem | undefined, menuLoaded: boolean): LineProblem | null {
  if (line.problem) return line.problem;
  if (menuLoaded && !item) return "unavailable";
  if (item?.availability.soldOut) return "sold_out";
  return null;
}

/** Sticky red bar: "View order · N" with the total. With an empty cart, a quiet link to "Your table" instead. */
export function CartBar() {
  const { t } = useTranslation();
  const { money } = useFormat();
  const { cart, itemsById, setCartOpen, table, token } = useGuest();
  const { pathname } = useLocation();
  const count = cartCount(cart.cart);
  const onTable = pathname.endsWith("/table");

  if (count === 0) {
    if (onTable || !table.data?.visit) return null;
    return (
      <div className="guest-bar-wrap">
        <Link to={`/t/${token}/table`} className="guest-bar guest-bar-quiet">
          <span className="flex items-center gap-2">
            <ConciergeBell size={16} aria-hidden="true" />
            {t("guest.nav.yourTable")}
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>
    );
  }
  return (
    <div className="guest-bar-wrap">
      <button type="button" className="guest-bar" onClick={() => setCartOpen(true)}>
        <span>{t("guest.cart.view", { count })}</span>
        <small>{money(cartTotal(cart.cart, itemsById))}</small>
      </button>
    </div>
  );
}

/** The cart sheet: lines with qty, problems, and Place order. */
export function CartSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { token, cart, itemsById, menu, endVisit, orderPlaced } = useGuest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = cart.cart.lines;
  const count = cartCount(cart.cart);
  const problems = lines.filter((l) => problemOf(l, itemsById.get(l.itemId), menu.isSuccess));
  const tooMany = count > MAX_ORDER_QTY;
  const canPlace = lines.length > 0 && problems.length === 0 && !tooMany && !busy;

  const place = async () => {
    if (!canPlace) return;
    setBusy(true);
    setError(null);
    cart.update((c) => withIdempotencyKey(c));
    try {
      const res = await api<{ orderId: string }>("/api/guest/orders", {
        method: "POST",
        tableToken: token,
        body: toOrderRequest(cart.get()) as unknown as BodyInit,
      });
      cart.update(orderSucceeded);
      void qc.invalidateQueries({ queryKey: ["guest"] });
      onClose();
      orderPlaced(res.orderId);
      navigate(`/t/${token}/table`, { state: { justOrdered: true } });
    } catch (err) {
      if (err instanceof ApiClientError) {
        const itemId = (err.details as { itemId?: string } | undefined)?.itemId;
        if ((err.code === "sold_out" || err.code === "item_unavailable") && itemId) {
          cart.update((c) => markProblem(c, itemId, err.code === "sold_out" ? "sold_out" : "unavailable"));
          void qc.invalidateQueries({ queryKey: ["guest", "menu"] });
          setError(errorMessage(t, err));
        } else if (err.code === "check_closed") {
          endVisit();
          return;
        } else if (err.code === "rate_limited") {
          setError(t("guest.cart.rateLimited"));
        } else if (err.status >= 500) {
          setError(t("guest.cart.failed"));
        } else {
          setError(errorMessage(t, err));
        }
      } else {
        setError(errorMessage(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={t("guest.cart.title")}
      onClose={onClose}
      footer={
        lines.length > 0 && (
          <div>
            {error && <p role="alert" className="guest-alert mb-3">{error}</p>}
            {problems.length > 0 && <p className="mb-2 text-center text-[12.5px] text-guest-beige">{t("guest.cart.removeToContinue")}</p>}
            {tooMany && <p className="mb-2 text-center text-[12.5px] text-guest-beige">{t("guest.cart.tooMany", { max: MAX_ORDER_QTY })}</p>}
            <button type="button" className="guest-primary w-full" disabled={!canPlace} onClick={() => void place()} aria-busy={busy}>
              {busy ? t("guest.cart.placing") : <>{t("guest.cart.place")} <span aria-hidden="true">·</span> {money(cartTotal(cart.cart, itemsById))}</>}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-[#cdb7bf]">{t("guest.cart.straightTo")}</p>
          </div>
        )
      }
    >
      {lines.length === 0 ? (
        <p className="py-8 text-center font-guest-dish text-[20px] text-guest-beige italic">{t("guest.cart.empty")}</p>
      ) : (
        <ul className="divide-y divide-[#3a1630]">
          {lines.map((l) => {
            const item = itemsById.get(l.itemId);
            const name = item ? loc(item.name, lang) : l.itemId;
            const problem = problemOf(l, item, menu.isSuccess);
            const unit = unitPrice(l, item);
            const opts = l.options.flatMap((s) => {
              const g = item?.optionGroups.find((x) => x.id === s.groupId);
              return s.optionIds.map((id) => loc(g?.options.find((o) => o.id === id)?.name, lang) || id);
            });
            return (
              <li key={l.key} className={`flex gap-3 py-3.5 ${problem ? "is-problem" : ""}`}>
                <ArchPhoto src={item?.photo} size={52} dim={!!problem} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`font-guest-dish text-[19px] leading-tight font-semibold ${problem ? "text-[#bfa9b3]" : "text-guest-cream"}`}>{name}</span>
                    {unit !== null && <span className="shrink-0 text-[13px] font-semibold text-guest-beige">{money(unit * l.qty)}</span>}
                  </div>
                  {opts.length > 0 && <p className="mt-0.5 text-[12px] text-[#cdb7bf]">{opts.join(", ")}</p>}
                  {l.note && <p className="mt-0.5 text-[12px] text-[#cdb7bf] italic">“{l.note}”</p>}
                  {problem && (
                    <p className="guest-tag guest-tag-soldout mt-1.5 inline-block">
                      {problem === "sold_out" ? t("guest.cart.soldOut") : t("guest.cart.unavailable")}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    {problem ? (
                      <span />
                    ) : (
                      <Stepper
                        size="sm"
                        value={l.qty}
                        min={1}
                        max={MAX_LINE_QTY}
                        onChange={(n) => cart.setQty(l.key, n)}
                        decLabel={t("guest.cart.decrease", { name })}
                        incLabel={t("guest.cart.increase", { name })}
                        valueLabel={t("guest.cart.lineQty", { name })}
                      />
                    )}
                    <button type="button" className="guest-icon-btn" aria-label={t("guest.cart.remove", { name })} onClick={() => cart.remove(l.key)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
