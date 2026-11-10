import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, MessageSquareText, Minus, Plus, Trash2 } from "lucide-react";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import type { MenuItem } from "../../guest/types";
import type { LineProblem } from "../../guest/cart";
import { MAX_SEAT, NOTE_MAX, type DraftLine } from "./draft";

export interface OrderTicketProps {
  tableName: string;
  lines: DraftLine[];
  itemsById: ReadonlyMap<string, MenuItem>;
  /** The line's problem: refused on the last send, or sold out / gone on the live menu since it was added. */
  problemOf: (line: DraftLine) => LineProblem | undefined;
  /** False once the order holds 20 items. */
  canGrow: boolean;
  onQty: (key: string, qty: number) => void;
  onSeat: (key: string, seat: number | null) => void;
  onNote: (key: string, note: string) => void;
  onRemove: (key: string) => void;
  /** The total, messages and Send. */
  footer: ReactNode;
}

/** Unit price of a line: the item plus its chosen options' deltas. */
export function linePrice(line: DraftLine, item: MenuItem | undefined): number {
  if (!item) return 0;
  const chosen = new Set(line.options.flatMap((o) => o.optionIds.map((id) => `${o.groupId}:${id}`)));
  const delta = item.optionGroups.flatMap((g) => g.options.filter((o) => chosen.has(`${g.id}:${o.id}`)).map((o) => o.priceDelta)).reduce((a, b) => a + b, 0);
  return item.price + delta;
}

/** The right column: the order being built, one line per item/options, with qty, seat, note and remove. */
export function OrderTicket({ tableName, lines, itemsById, problemOf, canGrow, onQty, onSeat, onNote, onRemove, footer }: OrderTicketProps) {
  const { t } = useTranslation();
  const count = lines.reduce((n, l) => n + l.qty, 0);
  return (
    <section className="oe-ticket" aria-label={t("order.ticket.label", { table: tableName })}>
      <header className="oe-ticket-h">
        <h2>{t("order.ticket.heading")}</h2>
        <span className="text-staff-fg-3">{t("order.ticket.count", { count })}</span>
      </header>
      {lines.length === 0 ? (
        <div className="oe-empty">
          <p className="font-medium text-staff-fg-2">{t("order.ticket.empty")}</p>
          <p>{t("order.ticket.emptyHint")}</p>
        </div>
      ) : (
        <ul className="oe-lines">
          {lines.map((l) => (
            <Line
              key={l.key}
              line={l}
              item={itemsById.get(l.itemId)}
              problem={problemOf(l)}
              canGrow={canGrow}
              onQty={onQty}
              onSeat={onSeat}
              onNote={onNote}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      <footer className="oe-ticket-f">{footer}</footer>
    </section>
  );
}

type LineProps = Pick<OrderTicketProps, "canGrow" | "onQty" | "onSeat" | "onNote" | "onRemove"> & {
  line: DraftLine;
  item: MenuItem | undefined;
  problem: LineProblem | undefined;
};

function Line({ line, item, problem, canGrow, onQty, onSeat, onNote, onRemove }: LineProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const [noteOpen, setNoteOpen] = useState(false);
  const id = useId();
  const name = item ? loc(item.name, lang) : "…";
  const optionNames = item
    ? line.options.flatMap((o) => {
        const g = item.optionGroups.find((x) => x.id === o.groupId);
        return o.optionIds.map((oid) => {
          const opt = g?.options.find((x) => x.id === oid);
          return opt ? loc(opt.name, lang) : oid;
        });
      })
    : [];
  const showNote = noteOpen || line.note.length > 0;

  return (
    <li className={`oe-line ${problem ? "has-problem" : ""}`}>
      <div className="oe-line-top">
        <div className="min-w-0 flex-1">
          <span className="nm">{name}</span>
          {optionNames.length > 0 && <span className="mod">{optionNames.join(", ")}</span>}
        </div>
        <span className="price font-mono">{money(linePrice(line, item) * line.qty)}</span>
      </div>
      {problem && (
        <p className="oe-problem" id={`${id}-problem`}>
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          {t(problem === "sold_out" ? "order.ticket.soldOut" : "order.ticket.unavailable")}
        </p>
      )}
      <div className="oe-line-ctl">
        <div className="oe-stepper" role="group" aria-label={`${t("order.ticket.qty")}, ${name}`}>
          <button type="button" className="staff-btn" aria-label={t("order.ticket.less", { name })} onClick={() => onQty(line.key, line.qty - 1)}>
            <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <output className="oe-qty" data-testid="line-qty">{line.qty}</output>
          <button type="button" className="staff-btn" aria-label={t("order.ticket.more", { name })} disabled={!canGrow} onClick={() => onQty(line.key, line.qty + 1)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <label className="oe-seat">
          <span className="sr-only">{t("order.ticket.seatFor", { name })}</span>
          <select value={line.seat ?? ""} onChange={(e) => onSeat(line.key, e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t("order.ticket.noSeat")}</option>
            {Array.from({ length: MAX_SEAT }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{t("order.ticket.seatN", { n })}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`staff-icon-btn oe-note-btn ${showNote ? "is-on" : ""}`}
          aria-label={t(line.note ? "order.ticket.editNoteFor" : "order.ticket.addNoteFor", { name })}
          aria-expanded={showNote}
          aria-controls={`${id}-note`}
          // Keep focus in the note while the button is pressed, so it can close an empty note instead of reopening it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setNoteOpen((o) => !o || line.note.length > 0)}
        >
          <MessageSquareText size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="staff-icon-btn oe-remove" aria-label={t("order.ticket.remove", { name })} onClick={() => onRemove(line.key)}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {showNote && (
        <div className="oe-note" id={`${id}-note`}>
          <label htmlFor={`${id}-ta`} className="sr-only">{t("order.ticket.noteFor", { name })}</label>
          <textarea
            id={`${id}-ta`}
            rows={2}
            maxLength={NOTE_MAX}
            value={line.note}
            placeholder={t("order.ticket.notePlaceholder")}
            autoFocus={noteOpen && line.note.length === 0}
            aria-describedby={`${id}-count`}
            onChange={(e) => onNote(line.key, e.target.value)}
            onBlur={() => setNoteOpen(false)}
          />
          <span id={`${id}-count`} className="oe-count font-mono">{t("order.ticket.noteCount", { count: line.note.length, max: NOTE_MAX })}</span>
        </div>
      )}
    </li>
  );
}
