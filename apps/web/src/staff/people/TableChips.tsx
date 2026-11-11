import { useTranslation } from "react-i18next";
import { initials } from "../auth";
import { byName, roomName } from "../floor/lib";
import type { ManagerTable } from "../manager/types";

export interface ChipRoom {
  id: string;
  name: string;
}

interface Props {
  tables: ManagerTable[];
  rooms: ChipRoom[];
  /** Table id → who covers it today (before this edit). */
  owners: ReadonlyMap<string, { id: string; name: string }>;
  /** The waiter being edited (null while adding). */
  editedId: string | null;
  editedName: string;
  selected: ReadonlySet<string>;
  onToggle: (tableId: string) => void;
}

/**
 * Tables grouped by room. Filled = this waiter's; dashed with initials = another waiter's (tapping moves it here);
 * outline = nobody's. Each chip is a toggle button, so keyboard and screen readers get the same thing as touch.
 */
export function TableChips({ tables, rooms, owners, editedId, editedName, selected, onToggle }: Props) {
  const { t } = useTranslation();
  return (
    <div className="pp-rooms">
      {rooms.map((room) => {
        const own = tables.filter((x) => x.roomId === room.id && x.active).sort(byName);
        if (own.length === 0) return null;
        const rn = roomName(room.name, t);
        return (
          <div key={room.id} role="group" aria-label={rn} className="pp-room">
            <p className="staff-label" aria-hidden="true">{rn}</p>
            <div className="pp-chips">
              {own.map((x) => {
                const owner = owners.get(x.id);
                const mine = selected.has(x.id);
                const other = !mine && owner && owner.id !== editedId ? owner : null;
                const label = mine
                  ? t("people.chip.mine", { table: x.name, name: editedName || t("people.chip.thisPerson") })
                  : other
                    ? t("people.chip.other", { table: x.name, owner: other.name })
                    : t("people.chip.free", { table: x.name });
                return (
                  <button
                    key={x.id}
                    type="button"
                    className={`pp-chip ${mine ? "is-mine" : other ? "is-other" : ""}`}
                    aria-pressed={mine}
                    aria-label={label}
                    onClick={() => onToggle(x.id)}
                  >
                    {x.name}
                    {other && <span className="pp-chip-who" aria-hidden="true">{initials(other.name)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
