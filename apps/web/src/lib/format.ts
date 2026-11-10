import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatTRY, formatElapsed, istanbulClock } from "@lodos/shared";

export type Lang = "en" | "tr";

const secFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function useFormat() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === "tr" ? "tr" : "en";
  return useMemo(
    () => ({
      lang,
      money: (kurus: number) => formatTRY(kurus, lang),
      /** "HH:MM" Istanbul wall clock */
      clock: (d: Date) => istanbulClock(d),
      /** "HH:MM:SS" Istanbul wall clock */
      clockSeconds: (d: Date) => secFmt.format(d),
      elapsed: (ms: number) => formatElapsed(ms),
    }),
    [lang],
  );
}
