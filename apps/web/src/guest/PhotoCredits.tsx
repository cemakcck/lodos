import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { LeopardBand, Sheet } from "./ui";

export const CREDITS_URL = "/photos/CREDITS.md";

export type Credit = { file: string; author: string; source: string; licence: string };

/** Parses the markdown table in public/photos/CREDITS.md: | File | Author | Source | Licence |. */
export function parseCredits(md: string): Credit[] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length === 4 && cells[0] !== "File")
    .map(([file, author, source, licence]) => ({
      file: file!,
      author: author!,
      source: source!.replace(/^<|>$/g, ""),
      licence: licence!,
    }));
}

/** Guest footer: wordmark, place, and the photo-credits link that the CC BY / BY-SA licences require. */
export function GuestFooter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <footer className="mt-12 text-center">
      <LeopardBand height={6} />
      <div className="px-6 pt-7 pb-4">
        <p className="guest-wordmark text-[28px]">Lodos</p>
        <p className="guest-label mt-2 text-[#cdb7bf]">{t("guest.footer.address")}</p>
        <button type="button" className="guest-link mt-4 text-[12px]" onClick={() => setOpen(true)}>
          {t("guest.footer.credits")}
        </button>
      </div>
      {open && <CreditsSheet onClose={() => setOpen(false)} />}
    </footer>
  );
}

function CreditsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["photo-credits"],
    queryFn: async () => {
      const res = await fetch(CREDITS_URL);
      if (!res.ok) throw new Error(String(res.status));
      return parseCredits(await res.text());
    },
    staleTime: Infinity,
  });
  return (
    <Sheet title={t("guest.footer.creditsTitle")} onClose={onClose}>
      <p className="text-[13px] leading-snug text-guest-beige">{t("guest.footer.creditsIntro")}</p>
      {q.data && (
        <ul className="mt-4 divide-y divide-[#3a1630] text-left">
          {q.data.map((c) => (
            <li key={c.file} className="py-2.5 text-[12.5px] leading-snug">
              <span className="block text-guest-cream">{c.file.replace(/\.jpg$/, "").replace(/-/g, " ")}</span>
              <span className="block text-[#cdb7bf]">
                {t("guest.footer.by", { author: c.author })} · {c.licence} ·{" "}
                <a className="guest-link" href={c.source} target="_blank" rel="noreferrer noopener">{t("guest.footer.source")}</a>
              </span>
            </li>
          ))}
        </ul>
      )}
      <a className="guest-link mt-4 inline-block text-[12.5px]" href={CREDITS_URL} target="_blank" rel="noreferrer">
        {t("guest.footer.creditsFile")}
      </a>
    </Sheet>
  );
}
