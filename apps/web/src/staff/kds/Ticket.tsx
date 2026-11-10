import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Pause, Play } from "lucide-react";
import { maskProfanity, noteMentionsAllergy, ticketAgeState } from "@lodos/shared";
import { useFormat } from "../../lib/format";
import { loc, spokenElapsed } from "./lib";
import { NEW_FOR_MS, type KdsItem, type KdsTicket, type Thresholds } from "./types";

export interface TicketProps {
  ticket: KdsTicket;
  /** Server-corrected current time, from the board's one shared tick. */
  now: Date;
  thresholds: Thresholds;
  onBump: () => void;
  onHold: () => void;
  /** Held tab: the primary action resumes the ticket. */
  onUnhold?: () => void;
  onToggle: (index: number) => void;
  /** A request for this ticket is in flight. */
  busy?: boolean;
  /** A brief inline notice, e.g. after a 409. */
  message?: string | null;
}

/**
 * One station's slice of one order. Header: table, server or "QR order", covers, sent time and a mono timer
 * whose style follows `ticketAgeState`. Items tick off on tap. Done tickets show how long they took, neutrally.
 */
export const Ticket = memo(function Ticket({ ticket, now, thresholds, onBump, onHold, onUnhold, onToggle, busy, message }: TicketProps) {
  const { t } = useTranslation();
  const { lang, clock, elapsed } = useFormat();
  const sent = new Date(ticket.sentAt);
  const done = ticket.status === "ready";
  const held = ticket.status === "held";
  const ms = done && ticket.readyAt ? new Date(ticket.readyAt).getTime() - sent.getTime() : now.getTime() - sent.getTime();
  const age = done ? "done" : ticketAgeState(sent, now, thresholds);
  const isNew = !done && !held && now.getTime() - sent.getTime() < NEW_FOR_MS;
  const spoken = spokenElapsed(ms, t);
  const label = t(`kds.ticket.aria.${held && age === "ok" ? "held" : age}`, { table: ticket.tableName, time: spoken });

  return (
    <article className={`kds-tk is-${age}${isNew ? " is-new" : ""}`} data-age={age} aria-label={label} aria-busy={busy || undefined}>
      <header className="kds-tk-h">
        <span className="kds-tno">{ticket.tableName}</span>
        <span className="kds-tmeta">
          <b>{ticket.serverName ?? t("kds.ticket.qr")}</b>
          {ticket.covers != null && <> · {t("kds.ticket.covers", { count: ticket.covers })}</>}
          {isNew && <span className="kds-tag">{t("kds.ticket.new")}</span>}
          <br />
          {t("kds.ticket.sent", { time: clock(sent) })}
        </span>
        <span className={`kds-timer${age === "warn" ? " is-warn" : age === "late" ? " is-late" : ""}`} aria-hidden="true">
          {elapsed(ms)}
        </span>
      </header>

      <ul className="kds-items">
        {ticket.items.map((item) => (
          <li key={item.index}>
            <ItemRow item={item} lang={lang} disabled={done} onToggle={onToggle} />
          </li>
        ))}
      </ul>

      {message && (
        <p className="kds-tk-msg" role="status">
          {message}
        </p>
      )}

      <footer className="kds-tk-f">
        {done ? (
          <span className="kds-tk-done">
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            {t("kds.ticket.readyAt", { time: clock(new Date(ticket.readyAt ?? ticket.sentAt)) })}
          </span>
        ) : held ? (
          <button type="button" className="kds-bump" disabled={busy} onClick={onUnhold} aria-label={t("kds.ticket.resumeAria", { table: ticket.tableName })}>
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("kds.ticket.resume")}
          </button>
        ) : (
          <>
            <button type="button" className="kds-bump" disabled={busy} onClick={onBump} aria-label={t("kds.ticket.bumpAria", { table: ticket.tableName })}>
              <Check size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("kds.ticket.bump")}
            </button>
            <button type="button" className="kds-ghost" disabled={busy} onClick={onHold} aria-label={t("kds.ticket.holdAria", { table: ticket.tableName })}>
              <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        )}
      </footer>
    </article>
  );
});

function ItemRow({ item, lang, disabled, onToggle }: { item: KdsItem; lang: "en" | "tr"; disabled: boolean; onToggle: (i: number) => void }) {
  const { t } = useTranslation();
  const note = item.note ? maskProfanity(item.note) : null;
  // Red is earned: only a guest who wrote about an allergy gets the red chip. The dish's own allergens are a quiet line.
  const allergyNote = !!note && noteMentionsAllergy(note);
  const contains = item.allergens.map((a) => t(`guest.allergens.${a}`, { defaultValue: a }).toLocaleLowerCase(lang)).join(", ");

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={item.checked}
      disabled={disabled}
      className={`kds-it${item.checked ? " is-done" : ""}`}
      onClick={() => onToggle(item.index)}
    >
      <span className="q">{item.qty}</span>
      <span className="n">
        <span className="nm">{loc(item.name, lang)}</span>
        {item.options.map((o, i) => (
          <span key={i} className="mod">
            {loc(o, lang)}
          </span>
        ))}
        {note && !allergyNote && <span className="mod note">{note}</span>}
        {allergyNote && (
          <span className="alg">
            <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>{t("kds.ticket.allergy")}</b> <span className="alg-note">{note}</span>
            </span>
          </span>
        )}
        {contains && <span className="contains">{t("kds.ticket.contains", { list: contains })}</span>}
      </span>
      <span className="cb" aria-hidden="true">
        {item.checked && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  );
}
