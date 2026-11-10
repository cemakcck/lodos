import { Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronRight, Flame, LayoutGrid, LoaderCircle, QrCode, Wine, type LucideIcon } from "lucide-react";
import { LangToggle, LeopardBand, MirrorScene, Ornament, SalonDefs } from "../guest/ui";
import { DEMO_ROLES, useDemo, useStartDemo, type DemoRole } from "./useDemo";
import { demoErrorMessage } from "./errors";

const ICON: Record<DemoRole, LucideIcon> = {
  guest: QrCode,
  waiter: LayoutGrid,
  kitchen: Flame,
  bar: Wine,
  manager: BookOpen,
};

/** `/`: the demo's front door in Plum Salon. In live mode it sends staff to the login. */
export function DemoLanding() {
  const { t } = useTranslation();
  const demo = useDemo();
  const start = useStartDemo();

  if (demo.isDemo === false) return <Navigate to="/staff/login" replace />;
  // Don't flash the demo pitch at a live restaurant while the mode is being checked.
  if (demo.isPending) return <div className="theme-guest guest-page min-h-dvh" aria-busy="true" />;

  const busy = start.isPending ? start.variables : null;

  return (
    <div className="theme-guest guest-page">
      <SalonDefs />
      <div className="guest-column demo-landing">
        <header className="relative">
          <MirrorScene height={320}>
            <div className="absolute inset-x-0 top-0 flex items-center justify-end px-4 pt-[max(14px,env(safe-area-inset-top))]">
              <LangToggle />
            </div>
            <div className="absolute inset-x-0 top-[118px] text-center" aria-hidden="true">
              <p className="guest-label text-guest-brass" style={{ letterSpacing: ".14em", fontSize: 9.5 }}>
                {t("demo.landing.eyebrow")}
              </p>
              <p className="guest-wordmark mt-2 text-[60px]">{t("demo.landing.title")}</p>
            </div>
          </MirrorScene>
          <LeopardBand height={10} />
        </header>

        <main className="px-5 pt-7 pb-10">
          <h1 className="text-center font-guest-dish text-[30px] leading-tight italic text-guest-cream">
            <span className="sr-only">{t("demo.landing.title")},</span> {t("demo.landing.subtitle")}
          </h1>
          <Ornament className="mx-auto mt-3 text-guest-brass" />
          <p className="mx-auto mt-5 max-w-[42ch] text-[14px] leading-[1.7] text-[color:var(--g-muted)]">{t("demo.landing.body")}</p>

          <h2 className="guest-group-title mt-9">{t("demo.landing.choose")}</h2>

          <ul className="mt-4 space-y-2.5">
            {DEMO_ROLES.map((role) => {
              const Icon = ICON[role];
              return (
                <li key={role}>
                  <button
                    type="button"
                    data-role={role}
                    className={`demo-role-card ${role === "guest" ? "is-first" : ""}`}
                    disabled={start.isPending}
                    onClick={() => start.start(role)}
                  >
                    <span className="demo-role-icon" aria-hidden="true">
                      <Icon size={18} strokeWidth={1.6} />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2">
                        <span className="demo-role-title">{t(`demo.roles.${role}`)}</span>
                        {role === "guest" && <span className="demo-start-tag">{t("demo.landing.startHere")}</span>}
                      </span>
                      <span data-hint="" className="demo-role-hint">{t(`demo.landing.hints.${role}`)}</span>
                    </span>
                    {busy === role ? (
                      <LoaderCircle size={18} className="animate-spin text-guest-brass" aria-label={t("demo.landing.opening")} />
                    ) : (
                      <ChevronRight size={18} className="text-guest-brass" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {start.isError && (
            <p role="alert" className="demo-guest-alert mt-4">
              {demoErrorMessage(t, start.error)}
            </p>
          )}
          {demo.isError && (
            <p role="alert" className="demo-guest-alert mt-4">
              {t("demo.landing.loadError")}
            </p>
          )}

          <p className="mt-6 border-l-2 border-guest-brass/60 pl-3 text-[13px] leading-relaxed text-guest-beige">{t("demo.landing.tip")}</p>
          <p className="mt-4 text-[12px] text-[color:var(--g-muted)]">{t("demo.landing.fine")}</p>
        </main>

        <footer>
          <LeopardBand height={8} />
          <p className="py-5 text-center guest-label text-[color:var(--g-muted)]">{t("demo.landing.footer")}</p>
        </footer>
      </div>
    </div>
  );
}
