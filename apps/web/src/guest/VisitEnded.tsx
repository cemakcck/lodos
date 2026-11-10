import { useTranslation } from "react-i18next";
import { GuestFooter } from "./PhotoCredits";
import { LangToggle, LeopardBand, MirrorScene, Ornament } from "./ui";

/** Shown when the waiter closed the check (or the order was refused with check_closed). No ordering from here. */
export function VisitEnded() {
  const { t } = useTranslation();
  return (
    <Farewell title={t("guest.ended.title")} body={t("guest.ended.body")} kicker={t("guest.ended.farewell")} />
  );
}

/** Unknown or inactive QR token. */
export function InvalidTable() {
  const { t } = useTranslation();
  return <Farewell title={t("guest.invalid.title")} body={t("guest.invalid.body")} />;
}

function Farewell({ title, body, kicker }: { title: string; body: string; kicker?: string }) {
  return (
    <>
      <header>
        <MirrorScene height={300}>
          <div className="absolute top-[max(14px,env(safe-area-inset-top))] right-4">
            <LangToggle />
          </div>
          <div className="absolute inset-x-0 top-[128px] text-center">
            <p className="guest-wordmark text-[56px]" aria-hidden="true">Lodos</p>
          </div>
        </MirrorScene>
        <LeopardBand height={10} />
      </header>
      <main className="px-7 pt-10 pb-4 text-center">
        {kicker && <p className="guest-label text-guest-brass">{kicker}</p>}
        <h1 className="mt-3 font-guest-dish text-[32px] leading-[1.12] font-medium text-guest-cream italic">{title}</h1>
        <Ornament className="mx-auto mt-5 block text-guest-brass" />
        <p className="mt-5 text-[14px] leading-relaxed text-guest-beige">{body}</p>
      </main>
      <GuestFooter />
    </>
  );
}
