import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import type { GuestItemStatus } from "@lodos/shared";
import { api } from "../lib/api";
import { useFormat } from "../lib/format";
import { guestKeys, useGuest } from "./context";
import { CallWaiter } from "./CallWaiter";
import { RequestBill } from "./RequestBill";
import { GuestFooter } from "./PhotoCredits";
import { LangToggle, LeopardBand, Ornament } from "./ui";
import { loc, type OrderLine, type OrdersResponse } from "./types";

/** `/t/:token/table`: every line on the table's open check with live status, plus Call the waiter and Request the bill. */
export function TableStatus() {
  const { t } = useTranslation();
  const { money } = useFormat();
  const { token, table } = useGuest();
  const location = useLocation();
  const justOrdered = (location.state as { justOrdered?: boolean } | null)?.justOrdered === true;
  const orders = useQuery({
    queryKey: guestKeys.orders(token),
    queryFn: () => api<OrdersResponse>("/api/guest/orders", { tableToken: token }),
    enabled: table.isSuccess,
  });
  const name = table.data?.table.name ?? "";
  const data = orders.data;

  return (
    <>
      <header className="guest-hero relative">
        <div className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
          <Link to={`/t/${token}`} className="guest-ghost-pill">
            <ArrowLeft size={14} aria-hidden="true" />
            {t("guest.nav.menu")}
          </Link>
          <span className="guest-wordmark text-[26px]" aria-hidden="true">Lodos</span>
          <LangToggle />
        </div>
        <div className="px-5 pt-7 pb-6 text-center">
          <p className="guest-label text-guest-brass">{name}</p>
          <h1 className="mt-1 font-guest-dish text-[38px] leading-none font-medium text-guest-cream italic">{t("guest.table.title")}</h1>
          {name && <p className="mt-2 text-[12.5px] text-[#e2cdd2]">{t("guest.table.subtitle", { table: name })}</p>}
        </div>
        <LeopardBand height={8} />
      </header>

      <main className="px-4 pb-32">
        {justOrdered && (
          <p role="status" className="guest-toast mt-5">
            <Check size={16} aria-hidden="true" /> {t("guest.cart.sent")}
          </p>
        )}

        {data && data.visit === null && (
          <div className="py-12 text-center">
            <p className="font-guest-dish text-[22px] text-guest-beige italic">{t("guest.table.nothingYet")}</p>
            <Link to={`/t/${token}`} className="guest-secondary mt-4 inline-flex">{t("guest.table.browse")}</Link>
          </div>
        )}

        {data && data.visit !== null && (
          <>
            <LineGroup title={t("guest.table.food")} lines={data.food} />
            <LineGroup title={t("guest.table.drinks")} lines={data.drinks} />
            <dl className="guest-totals mt-6">
              <div><dt>{t("guest.table.foodTotal")}</dt><dd>{money(data.totals.food)}</dd></div>
              <div><dt>{t("guest.table.drinksTotal")}</dt><dd>{money(data.totals.drinks)}</dd></div>
              <div className="is-total"><dt>{t("guest.table.total")}</dt><dd>{money(data.totals.total)}</dd></div>
            </dl>
            <p className="mt-3 text-center text-[12px] text-[#cdb7bf]">{t("guest.table.noCancel")}</p>
          </>
        )}

        <Ornament className="mx-auto mt-9 block text-guest-brass" />
        <CallWaiter />
        <RequestBill />
      </main>
      <GuestFooter />
    </>
  );
}

function LineGroup({ title, lines }: { title: string; lines: OrderLine[] }) {
  const { lang, money } = useFormat();
  if (lines.length === 0) return null;
  return (
    <section className="mt-7">
      <h2 className="guest-group-title">{title}</h2>
      <ul className="mt-1 divide-y divide-[#3a1630]">
        {lines.map((l, i) => (
          <li key={`${l.orderId}-${i}`} className="flex items-start gap-3 py-3">
            <span className="w-7 shrink-0 pt-0.5 text-[13px] font-semibold text-guest-brass">{l.qty}×</span>
            <div className="min-w-0 flex-1">
              <p className="font-guest-dish text-[19px] leading-tight font-semibold text-guest-cream">{loc(l.name, lang)}</p>
              {l.options.length > 0 && <p className="mt-0.5 text-[12px] text-[#cdb7bf]">{l.options.map((o) => loc(o, lang)).join(", ")}</p>}
              {l.note && <p className="mt-0.5 text-[12px] text-[#cdb7bf] italic">“{l.note}”</p>}
              <div className="mt-1.5"><StatusPill status={l.status} /></div>
            </div>
            <span className="shrink-0 pt-0.5 text-[13px] font-semibold text-guest-beige">{money(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StatusPill({ status }: { status: GuestItemStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`guest-status is-${status}`}>
      <span className="dot" aria-hidden="true" />
      {t(`guest.table.status.${status}`)}
    </span>
  );
}
