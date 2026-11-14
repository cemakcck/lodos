import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Star } from "lucide-react";
import { useFormat } from "../../lib/format";
import { loc } from "../kds/lib";
import { Shell } from "../Shell";
import { pct } from "./sections/Change";
import { useOverview, type Attendance, type OverviewView, type WorkingRow } from "./overviewQueries";

const GROUPS = ["floor", "kitchen", "bar"] as const;
const PILL: Record<Attendance, string> = { on_shift: "ok", late: "late", missing: "late", forgot_out: "late", later: "off", finished: "off", unscheduled: "off" };

function Tile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="sa-tile bz-tile">
      <h2 id={id} className="staff-label">{label}</h2>
      <p className="v font-mono">{value}</p>
      <div className="d">{children}</div>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`sa-card ${className}`} aria-labelledby={id}>
      <div className="sa-card-h"><h2 id={id}>{title}</h2></div>
      {children}
    </section>
  );
}

/** "↑ 9% vs same time last week": words and an arrow, never colour alone. */
function useDelta() {
  const { t, i18n } = useTranslation();
  return (cur: number, prev: number, unit: "pct" | "abs" = "pct") => {
    const change = unit === "pct" ? pct(cur, prev) : Math.round((cur - prev) * 10) / 10;
    if (change === null) return null;
    const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(Math.abs(change));
    const kind = change > 0 ? "up" : change < 0 ? "down" : "flat";
    return t(`overview.delta.${unit}.${kind}`, { n });
  };
}

function Working({ rows }: { rows: WorkingRow[] }) {
  const { t } = useTranslation();
  const { clock } = useFormat();
  return (
    <Card title={t("overview.working.title")}>
      {rows.length === 0 ? (
        <p className="mg-hint">{t("overview.working.empty")}</p>
      ) : (
        <table className="ex-table bz-table" aria-label={t("overview.working.title")}>
          <thead>
            <tr>
              <th scope="col">{t("overview.working.person")}</th>
              <th scope="col">{t("overview.working.time")}</th>
              <th scope="col">{t("overview.working.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.staffId}>
                <th scope="row">{w.name} · {t(`staff.roles.${w.role}`)}</th>
                <td className="font-mono">
                  {w.in ? t("overview.working.in", { time: clock(new Date(w.in)) }) : w.shift ? t(w.status === "later" ? "overview.working.from" : "overview.working.due", { time: clock(new Date(w.shift.start)) }) : "—"}
                </td>
                <td>
                  <span className={`ov-pill is-${PILL[w.status]}`}>
                    {w.status === "late" ? t("overview.status.late", { n: w.lateMin ?? 0 }) : t(`overview.status.${w.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="font-mono">
      <Star size={12} aria-hidden="true" className="ov-star" /> {value.toFixed(1)}
    </span>
  );
}

function TopStaff({ view }: { view: OverviewView }) {
  const { t, i18n } = useTranslation();
  const score = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const groups = GROUPS.filter((g) => view.topStaff[g].length > 0);
  return (
    <Card title={t("overview.top.title")}>
      {groups.length === 0 ? (
        <p className="mg-hint">{t("performance.notEnough")}</p>
      ) : (
        groups.map((g) => (
          <table key={g} className="ex-table bz-table" aria-label={t("performance.rankingOf", { group: t(`performance.group.${g}`) })}>
            <caption className="bz-cap">{t(`performance.group.${g}`)}</caption>
            <tbody>
              {view.topStaff[g].map((r, i) => (
                <tr key={r.staffId}>
                  <th scope="row">{i + 1}. <Link to={`/staff/performance/${r.staffId}`}>{r.name}</Link></th>
                  <td>{r.ratingAvg === null ? "—" : <Stars value={r.ratingAvg} />}</td>
                  <td className="r font-mono">{t("overview.top.pts", { n: score.format(r.score ?? 0) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))
      )}
    </Card>
  );
}

function Expenses({ view }: { view: OverviewView }) {
  const { t, i18n } = useTranslation();
  const { money, lang } = useFormat();
  const { total, budget, latest } = view.expenses;
  const share = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
  const date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <Card title={t("overview.expenses.title")}>
      <p className="v font-mono ov-exp">{budget > 0 ? t("overview.expenses.of", { spent: money(total), budget: money(budget) }) : money(total)}</p>
      {budget > 0 && <div className="ov-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></div>}
      {latest.length === 0 ? (
        <p className="mg-hint">{t("overview.expenses.none")}</p>
      ) : (
        <ul className="ov-latest" aria-label={t("overview.expenses.latest")}>
          {latest.map((e) => (
            <li key={e.id}>
              <span>{e.payee ?? loc(e.category, lang)} <span className="mg-hint">· {date.format(new Date(`${e.date}T00:00:00Z`))}</span></span>
              <span className="font-mono">{money(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/staff/expenses" className="ov-more">{t("overview.expenses.open")}</Link>
    </Card>
  );
}

function Dishes({ view }: { view: OverviewView }) {
  const { t } = useTranslation();
  const { lang } = useFormat();
  const { best, needsWork } = view.dishes;
  return (
    <Card title={t("overview.dishes.title")}>
      {best.length === 0 && needsWork.length === 0 ? (
        <p className="mg-hint">{t("overview.dishes.none")}</p>
      ) : (
        <table className="ex-table bz-table" aria-label={t("overview.dishes.title")}>
          <tbody>
            {best.map((d) => (
              <tr key={`b-${d.itemId ?? d.name.en}`}>
                <th scope="row">{loc(d.name, lang)}</th>
                <td className="r"><Stars value={d.avg} /></td>
              </tr>
            ))}
            {needsWork.map((d) => (
              <tr key={`n-${d.itemId ?? d.name.en}`}>
                <th scope="row">{t("overview.dishes.needsWork", { name: loc(d.name, lang) })}</th>
                <td className="r"><Stars value={d.avg} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** `/staff/overview` (manager): the "Today first" landing screen. Live through the Shell's staff socket. */
export function Overview() {
  const { t } = useTranslation();
  const { money, lang } = useFormat();
  const delta = useDelta();
  const q = useOverview();
  const view = q.data;
  const num = (n: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);

  return (
    <Shell title={t("overview.title")} clock={false}>
      {!view ? (
        <div className="mg-blocking" role={q.isError ? "alert" : "status"}>
          {q.isError ? (
            <>
              <p>{t("overview.loadError")}</p>
              <button type="button" className="staff-btn" onClick={() => void q.refetch()}>{t("business.retry")}</button>
            </>
          ) : (
            <p>{t("app.loading")}</p>
          )}
        </div>
      ) : (
        <div className="mg-page sa-page" role="region" aria-label={t("overview.title")} tabIndex={0}>
          <div className="bz-tiles">
            <Tile label={t("overview.tiles.sales")} value={money(view.today.sales)}>
              {delta(view.today.sales, view.today.salesPrev)}
            </Tile>
            <Tile label={t("overview.tiles.covers")} value={num(view.today.covers)}>
              {delta(view.today.covers, view.today.coversPrev)}
            </Tile>
            <Tile label={t("overview.tiles.rating")} value={view.rating7d.restaurant === null ? "—" : <><Star size={18} aria-hidden="true" className="ov-star" /> {view.rating7d.restaurant.toFixed(1)}</>}>
              {view.rating7d.restaurant !== null && view.rating7d.prev !== null ? delta(view.rating7d.restaurant, view.rating7d.prev, "abs") : null}
            </Tile>
            <Tile label={t("overview.tiles.profit")} value={money(view.month.profit)}>
              {view.month.margin !== null && t("business.margin", { n: num(view.month.margin * 100) })}
            </Tile>
          </div>

          <div className="bz-two">
            <Working rows={view.working} />
            <TopStaff view={view} />
          </div>
          <div className="bz-two">
            <Expenses view={view} />
            <Dishes view={view} />
          </div>

          <Link to="/staff/business" className="sa-card ov-month">
            <h2>{t("overview.month.title")}</h2>
            <dl>
              <div><dt>{t("business.pnl.sales")}</dt><dd className="font-mono">{money(view.month.sales)}</dd></div>
              <div><dt>{t("business.pnl.foodDrink")}</dt><dd className="font-mono">{money(view.month.foodDrink)}</dd></div>
              <div><dt>{t("business.pnl.labour")}</dt><dd className="font-mono">{money(view.month.labour)}</dd></div>
              <div><dt>{t("business.pnl.other")}</dt><dd className="font-mono">{money(view.month.other)}</dd></div>
              <div><dt>{t("business.pnl.profit")}</dt><dd className="font-mono">{money(view.month.profit)}</dd></div>
            </dl>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}
    </Shell>
  );
}
