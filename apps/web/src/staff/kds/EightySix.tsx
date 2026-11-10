import { useTranslation } from "react-i18next";
import { useFormat } from "../../lib/format";
import { loc } from "./lib";
import type { KdsSnapshot } from "./types";

/** "86'd tonight": this station's sold-out dishes, and dishes with only a few left. */
export function EightySix({ rows }: { rows: KdsSnapshot["eightySix"] }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const sorted = [...rows].sort((a, b) => Number(b.soldOut) - Number(a.soldOut));
  return (
    <section className="kds-86" aria-labelledby="kds-86">
      <h2 id="kds-86">{t("kds.eightySix.title")}</h2>
      {sorted.length === 0 ? (
        <p>{t("kds.eightySix.empty")}</p>
      ) : (
        <ul>
          {sorted.map((r) => {
            const name = loc(r.name, lang);
            return (
              <li key={r.itemId} className={r.soldOut || r.remaining === 0 ? "is-out" : undefined}>
                {r.soldOut || r.remaining == null || r.remaining === 0
                  ? t("kds.eightySix.out", { name })
                  : t("kds.eightySix.left", { name, count: r.remaining })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
