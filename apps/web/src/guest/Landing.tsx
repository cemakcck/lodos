import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ConciergeBell } from "lucide-react";
import { useGuest } from "./context";
import { LangToggle, LeopardBand, MirrorScene } from "./ui";

/** The hero: brass-edged arched mirror, Bodoni italic wordmark, "T7 · welcome", language toggle, leopard band. */
export function Landing() {
  const { t } = useTranslation();
  const { token, table } = useGuest();
  const name = table.data?.table.name;
  return (
    <header className="relative">
      <MirrorScene height={300}>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
          <Link to={`/t/${token}/table`} className="guest-ghost-pill">
            <ConciergeBell size={14} aria-hidden="true" />
            {t("guest.nav.yourTable")}
          </Link>
          <LangToggle />
        </div>
        <div className="absolute inset-x-0 top-[110px] text-center">
          <p className="guest-label text-guest-brass" style={{ letterSpacing: ".14em", fontSize: 9.5 }}>{t("guest.hero.since")}</p>
          <h1 className="guest-wordmark mt-2 text-[56px]">Lodos</h1>
          <p className="mt-1 text-[12.5px] tracking-[.04em] text-[#e2cdd2]">
            {name ? t("guest.hero.welcome", { table: name }) : t("guest.hero.welcomeGeneric")}
          </p>
        </div>
      </MirrorScene>
      <LeopardBand height={10} />
    </header>
  );
}
