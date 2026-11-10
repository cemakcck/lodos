import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChartLine, Flame, LayoutGrid, LogOut, QrCode, Wine, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useFormat } from "../lib/format";
import { useLive } from "../lib/useLive";
import { usePopover } from "../lib/usePopover";
import { setLanguage } from "../i18n";
import { ConnectionBanner } from "./ConnectionBanner";
import { canAccess, initials, markSignedOut, useMe, type StaffMember, type StaffRole } from "./auth";

export type RailKey = "kitchen" | "bar" | "floor" | "menu" | "tables" | "tonight";

interface RailItem {
  key: RailKey;
  to: string;
  icon: LucideIcon;
  /** Roles that see the item; the manager sees everything. */
  roles: readonly StaffRole[];
  /** Path prefixes that light the item up. */
  match: readonly string[];
}

export const RAIL: readonly RailItem[] = [
  { key: "kitchen", to: "/staff/kitchen", icon: Flame, roles: ["kitchen"], match: ["/staff/kitchen"] },
  { key: "bar", to: "/staff/bar", icon: Wine, roles: ["bar"], match: ["/staff/bar"] },
  { key: "floor", to: "/staff/floor", icon: LayoutGrid, roles: ["waiter"], match: ["/staff/floor", "/staff/order", "/staff/check"] },
  { key: "menu", to: "/staff/menu", icon: BookOpen, roles: [], match: ["/staff/menu"] },
  { key: "tables", to: "/staff/tables", icon: QrCode, roles: [], match: ["/staff/tables"] },
  { key: "tonight", to: "/staff/tonight", icon: ChartLine, roles: [], match: ["/staff/tonight"] },
];

export const railFor = (role: StaffRole | undefined) => (role ? RAIL.filter((i) => canAccess(role, i.roles)) : []);

export interface ShellProps {
  /** Toolbar title, e.g. "Kitchen". Rendered as the page's h1. */
  title: ReactNode;
  /** Muted text after the title, e.g. "Hot line". */
  subtitle?: ReactNode;
  /** Toolbar content right after the title: segmented filters and the like. */
  toolbar?: ReactNode;
  /** Toolbar content on the right, before the clock: search, buttons. */
  actions?: ReactNode;
  /**
   * The 40px stats strip. The Shell adds the "Live" dot first and the connection status last; pass the
   * figures in between (`<span><b>9</b>open tickets</span>`). Omit to hide the strip.
   */
  stats?: ReactNode;
  /** Figures at the right end of the stats strip, before the connection status (e.g. "My section"). */
  statsEnd?: ReactNode;
  /** Show the HH:MM:SS clock at the right of the toolbar. Default true. */
  clock?: boolean;
  /** Red dots on rail items, e.g. `{ floor: true }` while a table is calling. */
  railBadges?: Partial<Record<RailKey, boolean>>;
  children?: ReactNode;
}

/**
 * The staff layout: 56px plum rail (Bodoni "L", role-filtered Lucide items, avatar menu), 52px toolbar,
 * optional 40px stats strip, and the scrolling body. It owns the staff live socket for the connection
 * status, and signs out locally when the socket reports the session is gone.
 */
export function Shell({ title, subtitle, toolbar, actions, stats, statsEnd, clock = true, railBadges, children }: ShellProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe().data ?? undefined;
  const { pathname } = useLocation();
  const live = useLive({ audience: "staff" });

  useEffect(() => {
    if (live.authFailed) markSignedOut(qc);
  }, [live.authFailed, qc]);

  const status = (
    <span className="staff-live">
      <span className={`staff-pulse ${live.connected ? "" : "is-off"}`} aria-hidden="true" />
      {live.connected ? t("staff.live.on") : t("staff.live.off")}
    </span>
  );

  return (
    <div className="staff-app">
      <nav className="staff-rail" aria-label={t("staff.nav.label")}>
        <div className="staff-logo" aria-hidden="true">L</div>
        {railFor(me?.role).map(({ key, to, icon: Icon, match }) => {
          const label = t(`staff.nav.${key}`);
          const active = match.some((p) => pathname === p || pathname.startsWith(`${p}/`));
          return (
            <Link key={key} to={to} className="staff-rail-link" aria-label={label} aria-current={active ? "page" : undefined}>
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {railBadges?.[key] && <span className="dot" aria-hidden="true" />}
              <span className="staff-tip" aria-hidden="true">{label}</span>
            </Link>
          );
        })}
        <div className="staff-rail-sp" />
        {me && <AccountMenu me={me} />}
      </nav>

      <div className="staff-main">
        <header className="staff-bar">
          <h1 className="staff-title">
            {title}
            {subtitle && <span className="sub">· {subtitle}</span>}
          </h1>
          {toolbar}
          <div className="staff-grow" />
          {actions}
          {stats === undefined && (
            <div className="flex items-center gap-3 text-xs">
              {status}
              <ConnectionBanner connected={live.connected} lastSyncAt={live.lastSyncAt} />
            </div>
          )}
          {clock && <Clock />}
        </header>
        {stats !== undefined && (
          <div className="staff-stats">
            {status}
            {stats}
            <div className="staff-grow" />
            {statsEnd}
            <div className="text-staff-fg-3">
              <ConnectionBanner connected={live.connected} lastSyncAt={live.lastSyncAt} />
            </div>
          </div>
        )}
        <main className="staff-body">{children}</main>
      </div>
    </div>
  );
}

function Clock() {
  const { clockSeconds } = useFormat();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="staff-clock" dateTime={now.toISOString()}>
      {clockSeconds(now)}
    </time>
  );
}

/** Avatar with initials; its popover holds the language switch and Sign out. */
function AccountMenu({ me }: { me: StaffMember }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pop = usePopover();
  const lang = i18n.language === "tr" ? "tr" : "en";

  const signOut = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      markSignedOut(qc);
      qc.removeQueries({ predicate: (q) => !["auth", "demo", "guest"].includes(String(q.queryKey[0])) });
      void navigate("/staff/login", { replace: true });
    },
  });

  return (
    <div className="relative">
      <button type="button" className="staff-avatar-btn" aria-label={t("staff.account.open", { name: me.name })} {...pop.triggerProps}>
        <span className="staff-avatar" aria-hidden="true">{initials(me.name)}</span>
      </button>
      {pop.open && (
        <div
          {...pop.panelProps}
          role="dialog"
          aria-label={t("staff.account.open", { name: me.name })}
          className="staff-popover absolute bottom-0 left-[calc(100%+10px)] w-[232px] p-1.5"
        >
          <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
            <span className="staff-avatar" aria-hidden="true">{initials(me.name)}</span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{me.name}</p>
              <p className="text-xs text-staff-fg-3">{t(`staff.roles.${me.role}`)}</p>
            </div>
          </div>
          <div className="border-t border-staff-line px-2.5 pt-2.5 pb-2">
            <p className="staff-label mb-1.5" id={`${pop.panelProps.id}-lang`}>{t("staff.account.language")}</p>
            <div className="staff-seg w-full" role="group" aria-labelledby={`${pop.panelProps.id}-lang`}>
              {(["en", "tr"] as const).map((l) => (
                <button key={l} type="button" lang={l} className="flex-1 justify-center" aria-pressed={lang === l} onClick={() => void setLanguage(l)}>
                  {t(`lang.${l}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-staff-line pt-1">
            <button type="button" className="staff-menu-item" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" className="text-staff-fg-2" />
              {signOut.isPending ? t("staff.account.signingOut") : t("staff.account.signOut")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
