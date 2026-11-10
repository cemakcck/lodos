import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, X } from "lucide-react";
import { GuestApp } from "../guest/GuestApp";
import { useDemo, useDemoSession } from "./useDemo";
import { demoErrorMessage } from "./errors";

const KITCHEN = "/staff/kitchen";

/**
 * "Now open the kitchen screen →", shown on the guest page after the first order in demo mode. The window is
 * opened inside the click (so popup blockers allow it) and pointed at the kitchen once a kitchen session
 * exists. The guest page keeps working: it uses the table token, not the staff session.
 */
export function KitchenCallout({ dismiss }: { dismiss: () => void }) {
  const { t } = useTranslation();
  const session = useDemoSession();
  const [blocked, setBlocked] = useState(false);

  const open = () => {
    setBlocked(false);
    const win = window.open("", "_blank");
    session.mutate("kitchen", {
      onSuccess: () => {
        if (win && !win.closed) win.location.href = KITCHEN;
        else setBlocked(true);
      },
      onError: () => win?.close(),
    });
  };

  return (
    <aside className="demo-callout" aria-labelledby="kitchen-callout-label">
      <div className="flex items-start justify-between gap-2">
        <p id="kitchen-callout-label" className="guest-label pt-1 text-guest-brass">{t("demo.callout.label")}</p>
        <button type="button" className="guest-icon-btn -mt-1 -mr-1" aria-label={t("demo.callout.dismiss")} onClick={dismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="demo-callout-cta" onClick={open} disabled={session.isPending}>
        {t("demo.callout.cta")}
      </button>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--g-muted)]">{t("demo.callout.body")}</p>
      {blocked && (
        <p role="alert" className="demo-guest-alert mt-2">
          {t("demo.callout.blocked")}{" "}
          <a href={KITCHEN} target="_blank" rel="noopener" className="guest-link inline-flex items-center gap-1">
            {t("demo.callout.openLink")}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </p>
      )}
      {session.isError && (
        <p role="alert" className="demo-guest-alert mt-2">
          {demoErrorMessage(t, session.error)}
        </p>
      )}
    </aside>
  );
}

/** `GuestApp` with the kitchen callout plugged into its `afterFirstOrder` slot, in demo mode only. */
export function DemoAwareGuestApp() {
  const demo = useDemo();
  return <GuestApp afterFirstOrder={demo.isDemo ? ({ dismiss }) => <KitchenCallout dismiss={dismiss} /> : undefined} />;
}
