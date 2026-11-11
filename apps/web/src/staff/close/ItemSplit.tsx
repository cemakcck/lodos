import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Lock, Minus, Plus } from "lucide-react";
import { SHARE_LABELS } from "@lodos/shared";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import { MAX_SHARES, MIN_SHARES, type SplitBody, type SplitUnit, type SplitView } from "./types";

export interface ItemSplitProps {
  view: SplitView;
  /** Sends `PUT split`; resolves (or rejects) when the server answers. */
  onSend: (body: Extract<SplitBody, { mode: "items" }>) => Promise<unknown>;
}

type Draft = { count: number; labels: Map<string, string[]> };

const inOrder = (labels: string[]) => [...labels].sort((a, b) => SHARE_LABELS.indexOf(a) - SHARE_LABELS.indexOf(b));

/**
 * By item's left side: every unit of the check (a line with qty > 1 is one row per unit) with its letters and price.
 * Select a unit, then tap letters to toggle them; "+ Guest" adds a letter and "− Guest D" removes the
 * last one while it is unpaid and empty. Each change sends the full assignments.
 * Taps show at once (a local draft over the server view) and the server's answer replaces the draft when the last
 * request in flight settles. The amber banner shows what is not assigned yet, from the server.
 */
export function ItemSplit({ view, onSend }: ItemSplitProps) {
  const { t } = useTranslation();
  const { lang, money } = useFormat();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const inFlight = useRef(0);

  const server: Draft = useMemo(() => ({ count: view.count, labels: new Map(view.units.map((u) => [u.ref, u.labels])) }), [view]);
  const current = draft ?? server;
  const letters = SHARE_LABELS.slice(0, current.count);
  const paidLetters = new Set(view.shares.filter((s) => s.payment).map((s) => s.label));
  const closed = view.status !== "open";

  // "1 of 2" for units of the same line.
  const unitIndex = useMemo(() => {
    const seen = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const u of view.units) totals.set(u.lineRef, (totals.get(u.lineRef) ?? 0) + 1);
    return new Map(
      view.units.map((u) => {
        const i = (seen.get(u.lineRef) ?? 0) + 1;
        seen.set(u.lineRef, i);
        return [u.ref, { i, of: totals.get(u.lineRef)! }];
      }),
    );
  }, [view.units]);

  const send = (next: Draft) => {
    setDraft(next);
    inFlight.current += 1;
    const assignments = view.units.flatMap((u) => {
      const ls = next.labels.get(u.ref) ?? [];
      return ls.length > 0 ? [{ unit: u.ref, labels: ls }] : [];
    });
    void onSend({ mode: "items", count: next.count, assignments })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0) setDraft(null);
      });
  };

  const toggle = (u: SplitUnit, letter: string) => {
    const was = current.labels.get(u.ref) ?? [];
    const will = was.includes(letter) ? was.filter((l) => l !== letter) : inOrder([...was, letter]);
    send({ count: current.count, labels: new Map(current.labels).set(u.ref, will) });
  };
  const addGuest = () => {
    if (current.count < MAX_SHARES) send({ count: current.count + 1, labels: current.labels });
  };
  // Only the last letter can go, and only while it is unpaid and has nothing on it (the server enforces it too), so an
  // unused letter never keeps the check from closing.
  const last = SHARE_LABELS[current.count - 1]!;
  const lastShare = view.shares.find((s) => s.label === last);
  const lastInUse = [...current.labels.values()].some((ls) => ls.includes(last));
  const canRemove = !closed && current.count > MIN_SHARES && !lastShare?.payment && !lastInUse;
  const removeGuest = () => {
    if (canRemove) send({ count: current.count - 1, labels: current.labels });
  };

  const spokenLetters = (ls: string[]) =>
    ls.length === 0 ? t("close.items.nobody") : t("close.items.who", { guests: ls.map((l) => t("close.share.guest", { label: l })).join(", ") });

  return (
    <div className="cv-items">
      <div className="cv-items-h">
        <span className="staff-label">{t("close.items.onCheck", { count: view.units.length })}</span>
        <span className="cv-acts">
          <button type="button" className="staff-btn cv-add" aria-label={t("close.items.removeGuest", { label: last })} disabled={!canRemove} onClick={removeGuest}>
            <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("close.items.addGuestShort")} {last}
          </button>
          <button type="button" className="staff-btn cv-add" aria-label={t("close.items.addGuest")} disabled={closed || current.count >= MAX_SHARES} onClick={addGuest}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("close.items.addGuestShort")}
          </button>
        </span>
      </div>
      <p className="fl-hint cv-items-hint">{t("close.items.hint")}</p>
      <ul className="cv-units">
        {view.units.map((u) => {
          const ls = current.labels.get(u.ref) ?? [];
          const idx = unitIndex.get(u.ref)!;
          const name = loc(u.name, lang);
          const sel = selected === u.ref;
          const price = money(u.unitAmount);
          const sub = [...u.options.map((o) => loc(o, lang)), idx.of > 1 ? t("close.items.unitOf", { n: idx.i, of: idx.of }) : null].filter(Boolean).join(" · ");
          return (
            <li key={u.ref} className={`cv-unit ${sel ? "is-sel" : ""} ${u.comp ? "is-comp" : ""}`}>
              <button
                type="button"
                className="cv-unit-b"
                aria-pressed={sel}
                aria-label={[name, sub, price, u.comp ? t("close.items.comp") : null, spokenLetters(ls), u.frozen ? t("close.items.frozen") : null].filter(Boolean).join(", ")}
                onClick={() => setSelected(sel ? null : u.ref)}
              >
                <span className="n">
                  {name}
                  {u.comp && <span className="cv-tagc">{t("close.items.comp")}</span>}
                  {sub && <small>{sub}</small>}
                </span>
                <span className="cv-who" aria-hidden="true">
                  {u.frozen && <Lock size={12} strokeWidth={1.75} />}
                  {ls.length === 0 ? (
                    <span className="cv-g is-none">–</span>
                  ) : (
                    ls.map((l) => (
                      // The letter is drawn by CSS (data-letter): the button's accessible name already says who pays, in words.
                      <span key={l} className={`cv-g is-${l.toLowerCase()} is-on`} data-letter={l} />
                    ))
                  )}
                </span>
                <span className="p font-mono">{price}</span>
              </button>
              {sel && (
                <div className="cv-letters" role="group" aria-label={t("close.items.whoPays", { item: name })}>
                  {letters.map((l) => {
                    const on = ls.includes(l);
                    return (
                      <button
                        key={l}
                        type="button"
                        className={`cv-g is-${l.toLowerCase()} ${on ? "is-on" : ""}`}
                        aria-pressed={on}
                        aria-label={t("close.share.guest", { label: l })}
                        disabled={closed || u.frozen || paidLetters.has(l)}
                        onClick={() => toggle(u, l)}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {view.unassigned.count > 0 && (
        <p className="cv-unas" data-testid="unassigned">
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("close.items.unassigned", { count: view.unassigned.count, amount: money(view.unassigned.amount) })}
        </p>
      )}
    </div>
  );
}
