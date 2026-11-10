import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import tr from "./tr.json";

export const LANG_KEY = "lodos.lang";
export type Lang = "en" | "tr";

function readStored(): string | null {
  try { return localStorage.getItem(LANG_KEY); } catch { return null; }
}

export function detectLanguage(nav: string = typeof navigator === "undefined" ? "en" : navigator.language): Lang {
  const stored = readStored();
  if (stored === "en" || stored === "tr") return stored;
  return nav.toLowerCase().startsWith("tr") ? "tr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  initAsync: false,
});

const syncHtml = (lng: string) => {
  document.documentElement.lang = lng.startsWith("tr") ? "tr" : "en";
};
i18n.on("languageChanged", syncHtml);
syncHtml(i18n.language);

export async function setLanguage(lng: Lang): Promise<void> {
  try { localStorage.setItem(LANG_KEY, lng); } catch { /* storage unavailable */ }
  await i18n.changeLanguage(lng);
}

export default i18n;
