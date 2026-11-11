import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Info, Printer } from "lucide-react";
import { QrSvg } from "../../lib/qr";
import { useTableRows } from "./Tables";
import type { ManagerTable } from "./types";

export const CARDS_PER_PAGE = 6;
/** The scan line printed on every card, in both languages regardless of the UI language. */
export const SCAN_LINE = "Scan to see the menu and order · Menüyü görmek ve sipariş vermek için okutun";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
export const isLocalOrigin = (host: string) => LOCAL.has(host) || host.endsWith(".localhost");

/** The guest URL a table's QR encodes. */
export const guestUrl = (origin: string, token: string) => `${origin}/t/${token}`;

const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * `/staff/tables/qr`: the printable QR sheet. A4 portrait, 2 × 3 cards per page, each with the Lodos wordmark,
 * the table name, the QR (an SVG of `origin + "/t/" + token`) and the bilingual scan line. `?room=<id>` limits it
 * to one room, `?table=<id>` to one table (the floor plan editor's "QR code for this table"). On a localhost origin
 * an on-screen note (never printed) says the codes only work on the deployed address.
 */
export function QrSheet() {
  const { t } = useTranslation();
  const { tables, rooms, rows, roomOf } = useTableRows();
  const [params, setParams] = useSearchParams();
  const room = rooms.find((r) => r.id === params.get("room")) ?? null;
  const single = params.get("table");
  const shown = single ? rows.filter((r) => r.id === single) : room ? rows.filter((r) => r.roomId === room.id) : rows;
  const pages = chunk(shown, CARDS_PER_PAGE);
  const origin = window.location.origin;
  const local = isLocalOrigin(window.location.hostname);
  const setRoom = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set("room", id);
      else n.delete("room");
      return n;
    }, { replace: true });

  return (
    <div className="qr-screen">
      <div className="qr-toolbar no-print">
        <Link to="/staff/tables" className="staff-btn">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("manager.qr.back")}
        </Link>
        <h1 className="staff-title">{t("manager.qr.title")}</h1>
        {rooms.length > 1 && !single && (
          <div className="staff-seg" role="group" aria-label={t("manager.qr.rooms")}>
            <button type="button" aria-pressed={!room} onClick={() => setRoom(null)}>{t("manager.qr.allRooms")}</button>
            {rooms.map((r) => (
              <button key={r.id} type="button" aria-pressed={room?.id === r.id} onClick={() => setRoom(r.id)}>
                {roomOf(r.id)}
              </button>
            ))}
          </div>
        )}
        <div className="staff-grow" />
        {tables.data && <span className="qr-summary">{t("manager.qr.summary", { cards: shown.length, pages: pages.length })}</span>}
        <button type="button" className="staff-btn primary" disabled={!tables.data || shown.length === 0} onClick={() => window.print()}>
          <Printer size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("manager.qr.print")}
        </button>
      </div>

      {local && (
        <p className="staff-notice qr-hint no-print">
          <Info size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>{t("manager.qr.localhost", { origin })}</span>
        </p>
      )}

      {!tables.data ? (
        <p className="qr-status no-print" role={tables.isError ? "alert" : "status"}>
          {tables.isError ? t("manager.qr.loadError") : t("manager.qr.loading")}
        </p>
      ) : (
        pages.map((page, i) => (
          <section key={i} className="qr-page" aria-label={t("manager.qr.sheet", { n: i + 1 })}>
            {page.map((tb) => (
              <QrCard key={tb.id} table={tb} origin={origin} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function QrCard({ table, origin }: { table: ManagerTable; origin: string }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <article className="qr-card" aria-labelledby={id}>
      <p className="qr-wordmark">Lodos</p>
      <h2 id={id} className="qr-name">{table.name}</h2>
      <QrSvg value={guestUrl(origin, table.token)} size={200} label={t("manager.qr.qrLabel", { name: table.name })} dark="#000000" className="qr-code" />
      <p className="qr-line">{SCAN_LINE}</p>
    </article>
  );
}
