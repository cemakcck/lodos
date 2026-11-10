import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, Check } from "lucide-react";
import { api, ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useGuest } from "./context";

export const CALL_REASONS = ["wine", "problem", "other"] as const;
export type CallReason = (typeof CALL_REASONS)[number];

/** "Call the waiter" with optional quick reasons. A second call within 60 s is answered kindly (429). */
export function CallWaiter() {
  const { t } = useTranslation();
  const { token } = useGuest();
  const [reason, setReason] = useState<CallReason | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "already">("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const send = async () => {
    setState("busy");
    setError(null);
    try {
      await api("/api/guest/calls", { method: "POST", tableToken: token, body: { reason: reason ?? "other" } as unknown as BodyInit });
      setState("done");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "rate_limited") setState("already");
      else {
        setState("idle");
        setError(errorMessage(t, err));
      }
    }
  };

  const sent = state === "done" || state === "already";
  return (
    <section className="guest-card mt-6" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="guest-card-title"><BellRing size={18} aria-hidden="true" /> {t("guest.call.title")}</h2>
      <fieldset className="mt-3">
        <legend className="guest-label text-[#cdb7bf]">{t("guest.call.reason")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CALL_REASONS.map((r) => (
            <label key={r} className={`guest-choice ${reason === r ? "is-on" : ""}`}>
              <input type="radio" name={`${id}-reason`} checked={reason === r} onChange={() => setReason(r)} disabled={sent} />
              {t(`guest.call.reasons.${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {sent ? (
        <p role="status" className="guest-toast mt-4"><Check size={16} aria-hidden="true" /> {state === "done" ? t("guest.call.onTheWay") : t("guest.call.alreadyCalled")}</p>
      ) : (
        <>
          {error && <p role="alert" className="guest-alert mt-3">{error}</p>}
          <button type="button" className="guest-secondary mt-4 w-full" disabled={state === "busy"} onClick={() => void send()}>
            {state === "busy" ? t("guest.call.sending") : t("guest.call.send")}
          </button>
        </>
      )}
    </section>
  );
}
