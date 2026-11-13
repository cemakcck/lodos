import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronRight, Clock } from "lucide-react";
import { api, ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { reconnectStaffSocket } from "../lib/socket";
import { setLanguage } from "../i18n";
import { useDemo } from "../demo/useDemo";
import { DemoRoleButtons } from "../demo/DemoRoleButtons";
import { PinPad } from "./PinPad";
import { ROLE_HOME, initials, meKey, useMe, type StaffMember } from "./auth";

/** `/staff/login`: name tiles, then a 4–6 digit PIN pad (physical keyboard too). Demo mode adds instant role buttons. */
export function Login() {
  const { t } = useTranslation();
  const demo = useDemo();
  const me = useMe();
  const staff = useQuery({
    queryKey: ["auth", "staff"],
    queryFn: () => api<StaffMember[]>("/api/auth/staff"),
    staleTime: 60_000,
    retry: false,
  });
  const [picked, setPicked] = useState<StaffMember | null>(null);
  const qc = useQueryClient();
  const ended = useSearchParams()[0].get("ended") === "1";
  // Signed out (by a manager or by a 401): nothing of the last session's staff data stays in memory.
  const signedOut = me.data === null;
  useEffect(() => {
    if (signedOut) qc.removeQueries({ predicate: (q) => !["auth", "demo", "guest"].includes(String(q.queryKey[0])) });
  }, [signedOut, qc]);
  const noSandbox = staff.error instanceof ApiClientError && staff.error.status === 401;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-staff-line bg-staff-panel px-4">
        <span className="staff-logo !m-0 !h-8 !w-8 !rounded-lg !text-[19px] bg-staff-rail" style={{ background: "var(--color-staff-rail)" }} aria-hidden="true">
          L
        </span>
        <span className="text-[14px] font-semibold">Lodos</span>
        <span className="text-[13px] text-staff-fg-3">· {t("staff.login.title")}</span>
        <div className="staff-grow" />
        <LangSeg />
      </header>

      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-[440px]">
          {me.data && !picked && (
            <Link to={ROLE_HOME[me.data.role]} className="staff-btn mb-4 w-full !justify-between">
              <span className="flex items-center gap-2">
                <span className="staff-avatar !h-6 !w-6 !text-[10px]" aria-hidden="true">{initials(me.data.name)}</span>
                {t("staff.login.continueAs", { name: me.data.name })}
              </span>
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          )}

          {ended && !picked && (
            <p role="status" className="mb-4 rounded-lg border border-staff-line bg-staff-sunk px-3 py-2.5 text-[13px] text-staff-fg-2">{t("staff.login.ended")}</p>
          )}

          <section className="rounded-xl border border-staff-line bg-staff-panel p-6 shadow-[0_1px_2px_rgba(24,22,26,0.04)]">
            {picked ? (
              <PinStep member={picked} onBack={() => setPicked(null)} />
            ) : (
              <>
                <h1 className="text-[18px] font-semibold tracking-[-0.01em]">{t("staff.login.pickName")}</h1>
                <p className="mt-1 text-[13px] text-staff-fg-3">{noSandbox ? t("staff.login.demoStart") : t("staff.login.pickHint")}</p>
                {staff.isPending ? (
                  <div className="mt-5 grid grid-cols-2 gap-2" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-[10px] bg-staff-sunk" />
                    ))}
                  </div>
                ) : staff.isError ? (
                  !noSandbox && (
                    <div className="mt-5 flex items-center justify-between gap-3" role="alert">
                      <span className="text-[13px] text-staff-fg-2">{t("staff.login.loadError")} {errorMessage(t, staff.error)}</span>
                      <button type="button" className="staff-btn" onClick={() => void staff.refetch()}>
                        {t("staff.retry")}
                      </button>
                    </div>
                  )
                ) : staff.data.length === 0 ? (
                  <p className="mt-5 text-[13px] text-staff-fg-2">{t("staff.login.noStaff")}</p>
                ) : (
                  <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {staff.data.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="staff-tile w-full" onClick={() => setPicked(s)}>
                          <span className="staff-avatar" aria-hidden="true">{initials(s.name)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                            <span className="block text-xs text-staff-fg-3">{t(`staff.roles.${s.role}`)}</span>
                          </span>
                          <ChevronRight size={16} strokeWidth={1.75} className="text-staff-fg-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {!picked && (
            <Link to="/staff/clock" className="staff-btn mt-4 w-full">
              <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
              {t("staff.login.clock")}
            </Link>
          )}

          {demo.isDemo && (
            <section className="mt-6" aria-labelledby="login-demo-title">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2 id="login-demo-title" className="staff-label">{t("staff.login.demoTitle")}</h2>
                <span className="text-xs text-staff-fg-3">{t("staff.login.demoHint")}</span>
              </div>
              <DemoRoleButtons surface="staff" labelledBy="login-demo-title" wrap />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function LangSeg() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "tr" ? "tr" : "en";
  return (
    <div className="staff-seg" role="group" aria-label={t("lang.label")}>
      {(["en", "tr"] as const).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => void setLanguage(l)}>
          {l.toUpperCase()}
          <span className="sr-only">, {t(`lang.${l}`)}</span>
        </button>
      ))}
    </div>
  );
}

function PinStep({ member, onBack }: { member: StaffMember; onBack: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const login = useMutation({
    mutationFn: (p: string) => api<{ staff: StaffMember }>("/api/auth/pin", { method: "POST", body: JSON.stringify({ staffId: member.id, pin: p }) }),
    onSuccess: ({ staff }) => {
      qc.setQueryData(meKey, staff);
      reconnectStaffSocket();
      const from = (location.state as { from?: string } | null)?.from;
      void navigate(from && from.startsWith("/staff/") && from !== "/staff/login" ? from : ROLE_HOME[staff.role], { replace: true });
    },
  });

  // Focus the heading so screen readers announce the step and the keyboard is "on the pad".
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const describe = (err: unknown) => {
    const locked = err instanceof ApiClientError && err.status === 429;
    const wrong = err instanceof ApiClientError && err.status === 401;
    return { locked, text: locked ? t("staff.login.locked") : wrong ? t("staff.login.wrongPin") : errorMessage(t, err) };
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="-ml-2 inline-flex h-[38px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-staff-fg-2 hover:bg-staff-sunk">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("staff.login.notYou")}
      </button>
      <div className="mt-3 flex items-center gap-3">
        <span className="staff-avatar !h-10 !w-10 !text-[13px]" aria-hidden="true">{initials(member.name)}</span>
        <div>
          <p className="text-[14px] font-semibold">{member.name}</p>
          <p className="text-xs text-staff-fg-3">{t(`staff.roles.${member.role}`)}</p>
        </div>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-[18px] font-semibold tracking-[-0.01em] outline-none">
        {t("staff.login.enterPin")}
      </h1>
      <p className="mt-1 text-[13px] text-staff-fg-3">{t("staff.login.pinHint")}</p>
      <PinPad
        onSubmit={async (p) => void (await login.mutateAsync(p))}
        describe={describe}
        submitLabel={t("staff.login.signIn")}
        pendingLabel={t("staff.login.signingIn")}
      />
    </div>
  );
}
