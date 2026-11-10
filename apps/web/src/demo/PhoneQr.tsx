import { useTranslation } from "react-i18next";
import { Smartphone, X } from "lucide-react";
import { QrSvg } from "../lib/qr";
import { usePopover } from "../lib/usePopover";

/** Hosts a phone on the same network can't reach. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * "Scan to order from your phone": a popover with a QR code of this sandbox's guest table. `guestUrl` is a
 * relative path, so the code carries the absolute URL. The phone must reach this origin; on localhost it can't.
 */
export function PhoneQr({ guestUrl, surface }: { guestUrl: string; surface: "guest" | "staff" }) {
  const { t } = useTranslation();
  const pop = usePopover();
  const url = `${window.location.origin}${guestUrl}`;
  const local = LOCAL_HOSTS.has(window.location.hostname);
  const titleId = `${pop.panelProps.id}-title`;
  const s = surface === "staff";

  return (
    <div className="relative">
      <button type="button" className={s ? "staff-btn" : "demo-guest-btn"} {...pop.triggerProps}>
        <Smartphone size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("demo.phone.button")}
      </button>
      {pop.open && (
        <div
          {...pop.panelProps}
          role="dialog"
          aria-labelledby={titleId}
          className={`${s ? "staff-popover" : "demo-guest-popover"} absolute right-0 top-[calc(100%+8px)] z-50 w-[292px] max-w-[calc(100vw-24px)] p-4`}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className={s ? "text-[14px] font-semibold" : "font-guest-dish text-[22px] italic leading-tight text-guest-cream"}>
              {t("demo.phone.title")}
            </h2>
            <button type="button" onClick={pop.close} aria-label={t("demo.phone.close")} className={s ? "-mt-2 -mr-2 grid h-[38px] w-[38px] place-items-center rounded-lg text-staff-fg-2 hover:bg-staff-sunk" : "guest-icon-btn -mt-1 -mr-1"}>
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <p className={`mt-1 text-[12.5px] leading-relaxed ${s ? "text-staff-fg-2" : "text-[color:var(--g-muted)]"}`}>{t("demo.phone.body")}</p>
          <div className={`mx-auto mt-3 w-fit rounded-lg p-2 ${s ? "border border-staff-line bg-white" : "bg-guest-cream"}`}>
            <QrSvg value={url} size={184} label={t("demo.phone.qrLabel", { url })} dark={s ? "#18161a" : "#24101e"} light={s ? "#ffffff" : "#f8f4ee"} />
          </div>
          <p className={`mt-3 break-all text-center font-mono text-[11.5px] ${s ? "text-staff-fg-2" : "text-guest-beige"}`}>{url}</p>
          <p className={`mt-2 text-xs leading-relaxed ${s ? "text-staff-fg-3" : "text-[color:var(--g-muted)]"}`}>{t("demo.phone.reach")}</p>
          {local && <p className={`mt-2 ${s ? "staff-notice" : "demo-guest-alert"}`}>{t("demo.phone.localhost")}</p>}
        </div>
      )}
    </div>
  );
}
