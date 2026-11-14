import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useFormat } from "../lib/format";
import { useGuest } from "./context";
import { loc } from "./types";

type RatingState = {
  state: "open" | "done" | "closed";
  waiter: { name: string } | null;
  dishes: { itemId: string; name: { en: string; tr: string } }[];
};

const COMMENT_MAX = 500;

/** Five stars as a radio group; arrow keys move and select, Home/End jump. Tabbing lands on the selected star. */
function StarInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const n = Math.min(5, Math.max(1, to));
    onChange(n);
    refs.current[n - 1]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    // Move from the focused star (star 1 while none is chosen), so ArrowRight from it picks 2.
    const cur = refs.current.indexOf(e.target as HTMLButtonElement) + 1 || value || 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") move(cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(cur - 1);
    else if (e.key === "Home") move(1);
    else if (e.key === "End") move(5);
    else return;
    e.preventDefault();
  };
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <span id={id} className="text-[14px] text-guest-cream">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-1" onKeyDown={onKey}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => { refs.current[n - 1] = el; }}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t("guest.rate.star", { count: n })}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            className="flex h-11 w-9 items-center justify-center rounded-lg text-guest-brass"
            onClick={() => onChange(n)}
          >
            <Star size={24} aria-hidden="true" fill={n <= value ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The rating card shown after a paid visit: waiter, each dish, food / cleanliness / atmosphere and a comment. */
export function RateVisit({ checkId }: { checkId: string }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const { token } = useGuest();
  const [waiter, setWaiter] = useState(0);
  const [dishes, setDishes] = useState<Record<string, number>>({});
  const [cats, setCats] = useState({ food: 0, cleanliness: 0, atmosphere: 0 });
  const [comment, setComment] = useState("");
  const [thanked, setThanked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headId = useId();
  const commentId = useId();

  const q = useQuery({
    queryKey: ["guest", "rating", token, checkId],
    queryFn: () => api<RatingState>(`/api/guest/rating?checkId=${encodeURIComponent(checkId)}`, { tableToken: token }),
    retry: false,
    staleTime: Infinity,
  });
  if (!q.data || q.data.state === "closed") return null;
  if (q.data.state === "done" || thanked) {
    return (
      <section className="guest-card mx-7 mt-2 mb-6" aria-labelledby={headId}>
        <h2 id={headId} className="sr-only">{t("guest.rate.title")}</h2>
        <p role="status" className="guest-toast"><Check size={16} aria-hidden="true" /> {t("guest.rate.thanks")}</p>
      </section>
    );
  }

  const { waiter: w, dishes: list } = q.data;
  const picked = list.filter((d) => dishes[d.itemId]);
  const any = waiter > 0 || picked.length > 0 || cats.food > 0 || cats.cleanliness > 0 || cats.atmosphere > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    const body = {
      checkId,
      ...(waiter ? { waiter } : {}),
      ...(picked.length ? { dishes: picked.map((d) => ({ itemId: d.itemId, stars: dishes[d.itemId]! })) } : {}),
      ...(cats.food ? { food: cats.food } : {}),
      ...(cats.cleanliness ? { cleanliness: cats.cleanliness } : {}),
      ...(cats.atmosphere ? { atmosphere: cats.atmosphere } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    try {
      await api("/api/guest/ratings", { method: "POST", tableToken: token, body: body as unknown as BodyInit });
      setThanked(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "already_rated") setThanked(true);
      else if (err instanceof ApiClientError && err.code === "rating_closed") void q.refetch();
      else setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="guest-card mx-7 mt-2 mb-6 text-left" aria-labelledby={headId}>
      <h2 id={headId} className="guest-card-title"><Star size={18} aria-hidden="true" /> {t("guest.rate.title")}</h2>
      {w && <StarInput label={t("guest.rate.waiterNamed", { name: w.name })} value={waiter} onChange={setWaiter} />}
      {list.length > 0 && (
        <>
          <p className="guest-label mt-5 text-guest-brass">{t("guest.rate.dishes")}</p>
          {list.map((d) => (
            <StarInput key={d.itemId} label={loc(d.name, lang)} value={dishes[d.itemId] ?? 0} onChange={(n) => setDishes((s) => ({ ...s, [d.itemId]: n }))} />
          ))}
        </>
      )}
      <div className="mt-5 border-t border-[color:var(--g-line)] pt-1">
        {(["food", "cleanliness", "atmosphere"] as const).map((k) => (
          <StarInput key={k} label={t(`guest.rate.${k}`)} value={cats[k]} onChange={(n) => setCats((s) => ({ ...s, [k]: n }))} />
        ))}
      </div>
      <label htmlFor={commentId} className="mt-5 block text-[14px] text-guest-cream">{t("guest.rate.comment")}</label>
      <textarea
        id={commentId}
        className="guest-input mt-2"
        rows={3}
        maxLength={COMMENT_MAX}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <p className="mt-1 text-right text-[12px] text-guest-beige">{t("guest.rate.counter", { count: comment.length })}</p>
      {error && <p role="alert" className="guest-alert mt-3">{error}</p>}
      <button type="button" className="guest-primary mt-4 w-full" disabled={!any || busy} onClick={() => void send()}>
        {busy ? t("guest.rate.sending") : t("guest.rate.send")}
      </button>
    </section>
  );
}
