import { useTranslation } from "react-i18next";
import { Bell, ConciergeBell, ReceiptText } from "lucide-react";
import { since } from "./lib";
import type { FloorChip } from "./types";

export interface ChipsProps {
  chips: FloorChip[];
  /** Server time. */
  now: Date;
  /** Table ids in my section: their chips are emphasised. */
  mine: ReadonlySet<string>;
  onPick: (tableId: string) => void;
  /** How many chips fit before "+N". */
  max?: number;
}

type Shown = { key: string; kind: FloorChip["kind"]; tableId: string; text: string; aria: string; mine: boolean };

/**
 * The toolbar's attention chips, from the API's order (calling, ready, bill; oldest first). Calls and bills are one
 * chip per table; ready tables fold into "2 ready to run", which opens the oldest. Tapping a chip selects its table.
 */
export function Chips({ chips, now, mine, onPick, max = 4 }: ChipsProps) {
  const { t } = useTranslation();
  const minutes = (iso: string) => {
    const m = Math.floor(since(iso, now) / 60_000);
    return m < 1 ? t("floor.time.now") : t("floor.time.min", { count: m });
  };
  const withMine = (label: string, isMine: boolean) => (isMine ? t("floor.chips.mine", { label }) : label);

  const shown: Shown[] = [];
  const ready = chips.filter((c) => c.kind === "ready");
  for (const c of chips) {
    if (c.kind === "ready") {
      if (c !== ready[0]) continue;
      const anyMine = ready.some((r) => mine.has(r.tableId));
      const text = ready.length > 1 ? t("floor.chips.readyMany", { count: ready.length }) : t("floor.chips.ready", { table: c.tableName });
      const aria =
        ready.length > 1 ? t("floor.chips.readyManyAria", { count: ready.length, tables: ready.map((r) => r.tableName).join(", ") }) : text;
      shown.push({ key: "ready", kind: "ready", tableId: c.tableId, text, aria: withMine(aria, anyMine), mine: anyMine });
      continue;
    }
    const text = c.kind === "calling" ? t("floor.chips.calling", { table: c.tableName, time: minutes(c.since) }) : t("floor.chips.bill", { table: c.tableName });
    const isMine = mine.has(c.tableId);
    shown.push({ key: `${c.kind}-${c.tableId}`, kind: c.kind, tableId: c.tableId, text, aria: withMine(text, isMine), mine: isMine });
  }
  if (shown.length === 0) return null;
  const visible = shown.slice(0, max);
  const hidden = shown.slice(max);

  return (
    <div className="fl-chips" role="group" aria-label={t("floor.chips.label")}>
      {visible.map((c) => {
        const Icon = c.kind === "calling" ? Bell : c.kind === "ready" ? ConciergeBell : ReceiptText;
        return (
          <button
            key={c.key}
            type="button"
            className={`fl-chip is-${c.kind} ${c.mine ? "is-mine" : ""}`}
            aria-label={c.aria}
            onClick={() => onPick(c.tableId)}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            {c.text}
          </button>
        );
      })}
      {hidden.length > 0 && (
        <span className="fl-chip is-more" role="img" aria-label={t("floor.chips.moreAria", { count: hidden.length, tables: hidden.map((h) => h.text).join(", ") })}>
          {t("floor.chips.more", { count: hidden.length })}
        </span>
      )}
    </div>
  );
}
