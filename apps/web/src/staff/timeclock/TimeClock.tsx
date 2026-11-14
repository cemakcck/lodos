import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useDemo } from "../../demo/useDemo";
import { api, ApiClientError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useFormat } from "../../lib/format";
import { initials } from "../auth";
import { PinPad } from "../PinPad";
import { durationText } from "./lib";
import { clockPeopleKey, useClockPeople, type ClockPerson, type PunchResult } from "./queries";

const RESULT_MS = 5000;

/**
 * `/staff/clock`: the wall-screen time clock. No session: pick your name, enter your PIN on the sign-in keypad, and
 * the punch toggles. The result shows for 5 s, then the screen is back on the name picker for the next person.
 */
export function TimeClock() {
  const { t } = useTranslation();
  const people = useClockPeople();
  const [picked, setPicked] = useState<ClockPerson | null>(null);
  const [result, setResult] = useState<{ person: ClockPerson; punch: PunchResult } | null>(null);

  // Back to the picker after the result has been read.
  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => {
      setResult(null);
      setPicked(null);
    }, RESULT_MS);
    return () => clearTimeout(id);
  }, [result]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-staff-line bg-staff-panel px-4">
        <span className="staff-logo !m-0 !h-8 !w-8 !rounded-lg !text-[19px] bg-staff-rail" style={{ background: "var(--color-staff-rail)" }} aria-hidden="true">
          L
        </span>
        <span className="text-[14px] font-semibold">Lodos</span>
        <span className="text-[13px] text-staff-fg-3">· {t("timeclock.title")}</span>
        <div className="staff-grow" />
        <Link to="/staff/login" className="staff-btn">{t("timeclock.toSignIn")}</Link>
      </header>
      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-[440px]">
          <section className="rounded-xl border border-staff-line bg-staff-panel p-6 shadow-[0_1px_2px_rgba(24,22,26,0.04)]">
            {result ? (
              <Result person={result.person} punch={result.punch} />
            ) : picked ? (
              <PunchStep member={picked} onBack={() => setPicked(null)} onDone={(punch) => setResult({ person: picked, punch })} />
            ) : (
              <Picker people={people} onPick={setPicked} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Picker({ people, onPick }: { people: ReturnType<typeof useClockPeople>; onPick: (p: ClockPerson) => void }) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const noSandbox = people.error instanceof ApiClientError && people.error.status === 401;
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold tracking-[-0.01em] outline-none">{t("timeclock.pickName")}</h1>
      <p className="mt-1 text-[13px] text-staff-fg-3">{noSandbox ? t("staff.login.demoStart") : t("timeclock.pickHint")}</p>
      {people.isPending ? (
        <div className="mt-5 grid grid-cols-2 gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-[10px] bg-staff-sunk" />
          ))}
        </div>
      ) : people.isError ? (
        !noSandbox && (
          <div className="mt-5 flex items-center justify-between gap-3" role="alert">
            <span className="text-[13px] text-staff-fg-2">{t("timeclock.loadError")} {errorMessage(t, people.error)}</span>
            <button type="button" className="staff-btn" onClick={() => void people.refetch()}>{t("staff.retry")}</button>
          </div>
        )
      ) : people.data.length === 0 ? (
        <p className="mt-5 text-[13px] text-staff-fg-2">{t("timeclock.noPeople")}</p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {people.data.map((p) => (
            <li key={p.id}>
              <button type="button" className="staff-tile w-full" onClick={() => onPick(p)}>
                <span className="staff-avatar" aria-hidden="true">{initials(p.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                  <span className="block text-xs text-staff-fg-3">{t(p.clockedIn ? "timeclock.clockedIn" : "timeclock.clockedOut")}</span>
                </span>
                <ChevronRight size={16} strokeWidth={1.75} className="text-staff-fg-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PunchStep({ member, onBack, onDone }: { member: ClockPerson; onBack: () => void; onDone: (r: PunchResult) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const demo = useDemo();
  const punch = useMutation({
    mutationFn: (pin: string) => api<PunchResult>("/api/clock/punch", { method: "POST", body: JSON.stringify({ staffId: member.id, pin }) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: clockPeopleKey });
      onDone(r);
    },
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const describe = (err: unknown) => {
    const status = err instanceof ApiClientError ? err.status : 0;
    const forgot = err instanceof ApiClientError && err.code === "forgot_clock_out";
    return {
      locked: status === 429,
      text: forgot ? t("timeclock.forgotOut") : status === 429 ? t("staff.login.locked") : status === 401 ? t("staff.login.wrongPin") : errorMessage(t, err),
    };
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="-ml-2 inline-flex h-[38px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-staff-fg-2 hover:bg-staff-sunk">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("staff.login.notYou")}
      </button>
      <div className="mt-3 flex items-center gap-3">
        <span className="staff-avatar !h-10 !w-10 !text-[13px]" aria-hidden="true">{initials(member.name)}</span>
        <p className="text-[14px] font-semibold">{member.name}</p>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-[18px] font-semibold tracking-[-0.01em] outline-none">{t("staff.login.enterPin")}</h1>
      <p className="mt-1 text-[13px] text-staff-fg-3">{t("staff.login.pinHint")}</p>
      {demo.isDemo && <p className="mt-1 text-[13px] text-staff-fg-3">{t("timeclock.demoHint")}</p>}
      <PinPad
        onSubmit={async (pin) => void (await punch.mutateAsync(pin))}
        describe={describe}
        submitLabel={t("timeclock.punch")}
        pendingLabel={t("timeclock.punching")}
      />
    </div>
  );
}

function Result({ person, punch }: { person: ClockPerson; punch: PunchResult }) {
  const { t } = useTranslation();
  const { clock } = useFormat();
  const text =
    punch.action === "in"
      ? t("timeclock.resultIn", { time: clock(new Date(punch.at)) })
      : t("timeclock.resultOut", { duration: durationText(t, punch.minutesToday) });
  return (
    <div role="status" className="py-4 text-center">
      <span className="staff-avatar mx-auto !h-12 !w-12 !text-[15px]" aria-hidden="true">{initials(person.name)}</span>
      <p className="mt-3 text-[14px] font-semibold">{person.name}</p>
      <p className="mt-1 text-[18px] font-semibold tracking-[-0.01em]">{text}</p>
      <p className="mt-2 text-[13px] text-staff-fg-3">{t("timeclock.backSoon")}</p>
    </div>
  );
}
