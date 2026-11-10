import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { loc } from "./lib";
import type { KdsSnapshot } from "./types";

/** "All day": how many of each dish are still to fire across the active tickets, most first. */
export function AllDay({ rows }: { rows: KdsSnapshot["allDay"] }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const top = rows[0]?.qty ?? 0;
  return (
    <section className="kds-allday" aria-labelledby="kds-allday">
      <h2 className="kds-side-h" id="kds-allday">
        <span>{t("kds.allDay.title")}</span>
        <span className="hint">{t("kds.allDay.hint")}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="kds-side-empty">{t("kds.allDay.empty")}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={`${r.itemName.en}|${r.itemName.tr}`} className={`kds-ad${top > 1 && r.qty === top ? " is-hot" : ""}`}>
              <span>{loc(r.itemName, lang)}</span>
              <b>{r.qty}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
