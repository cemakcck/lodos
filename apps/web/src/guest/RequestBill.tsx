import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Check, CreditCard, ReceiptText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useGuest } from "./context";

type Method = "card" | "cash";

/** "Request the bill": card or cash. 409 means nothing is on the bill yet. */
export function RequestBill() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { token } = useGuest();
  const [method, setMethod] = useState<Method>("card");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const send = async () => {
    setState("busy");
    setError(null);
    try {
      await api("/api/guest/bill", { method: "POST", tableToken: token, body: { method } as unknown as BodyInit });
      setState("done");
      void qc.invalidateQueries({ queryKey: ["guest", "orders"] });
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiClientError && err.status === 409 ? t("guest.bill.nothing") : errorMessage(t, err));
    }
  };

  return (
    <section className="guest-card mt-4" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="guest-card-title"><ReceiptText size={18} aria-hidden="true" /> {t("guest.bill.title")}</h2>
      <fieldset className="mt-3">
        <legend className="guest-label text-[#cdb7bf]">{t("guest.bill.method")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["card", "cash"] as const).map((m) => (
            <label key={m} className={`guest-choice justify-center ${method === m ? "is-on" : ""}`}>
              <input type="radio" name={`${id}-method`} checked={method === m} onChange={() => setMethod(m)} disabled={state === "done"} />
              {m === "card" ? <CreditCard size={15} aria-hidden="true" /> : <Banknote size={15} aria-hidden="true" />}
              {t(`guest.bill.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {state === "done" ? (
        <p role="status" className="guest-toast mt-4"><Check size={16} aria-hidden="true" /> {t("guest.bill.onTheWay")}</p>
      ) : (
        <>
          {error && <p role="alert" className="guest-alert mt-3">{error}</p>}
          <button type="button" className="guest-primary mt-4 w-full" disabled={state === "busy"} onClick={() => void send()}>
            {state === "busy" ? t("guest.bill.sending") : t("guest.bill.send")}
          </button>
        </>
      )}
    </section>
  );
}
