import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import { api } from "../lib/api";
import { fetchMe, meKey } from "../staff/auth";
import { DemoRoleButtons } from "./DemoRoleButtons";
import { PhoneQr } from "./PhoneQr";
import { DEMO_ROLES, demoKey, useDemo, type DemoRole, type DemoState } from "./useDemo";

/**
 * The slim "Demo restaurant, not real" bar shown on every guest and staff page in demo mode: role buttons,
 * the order simulator switch and the phone QR. Renders nothing in live mode. Below 1024px the controls fold
 * behind a "Demo controls" button.
 */
export function DemoBanner({ surface }: { surface: "guest" | "staff" }) {
  const { t } = useTranslation();
  const demo = useDemo();
  const me = useQuery({ queryKey: meKey, queryFn: fetchMe, enabled: surface === "staff" && demo.isDemo === true, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  if (!demo.isDemo) return null;

  const info = demo.info;
  const current: DemoRole | undefined = surface === "guest" ? "guest" : (DEMO_ROLES.find((r) => r === me.data?.role));
  const s = surface === "staff";

  return (
    <section aria-label={t("demo.banner")} className={s ? "demo-staff" : "demo-guest"}>
      <div className="demo-row">
        <p className="demo-text">
          <Info size={14} strokeWidth={2} aria-hidden="true" className="flex-none" />
          <span>{t("demo.banner")}</span>
        </p>
        <button type="button" className="demo-more" aria-expanded={open} aria-controls="demo-controls" onClick={() => setOpen((o) => !o)}>
          {t("demo.controls")}
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className={open ? "rotate-180" : ""} />
        </button>
        <div id="demo-controls" className={`demo-controls ${open ? "is-open" : ""}`}>
          <DemoRoleButtons surface={surface} current={current} label={t("demo.tryAs")} seg wrap />
          {info && <SimulatorSwitch on={info.simulatorOn} surface={surface} />}
          {info && <PhoneQr guestUrl={info.guestUrl} surface={surface} />}
        </div>
      </div>
    </section>
  );
}

function SimulatorSwitch({ on, surface }: { on: boolean; surface: "guest" | "staff" }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (next: boolean) => api<{ simulatorOn: boolean }>("/api/demo/simulator", { method: "POST", body: JSON.stringify({ on: next }) }),
    onMutate: (next) => {
      const prev = qc.getQueryData<DemoState>(demoKey);
      if (prev?.mode === "demo" && prev.info) {
        const updated: DemoState = { mode: "demo", info: { ...prev.info, simulatorOn: next } };
        qc.setQueryData<DemoState>(demoKey, updated);
      }
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(demoKey, ctx.prev);
    },
  });

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={surface === "staff" ? "demo-switch staff-btn" : "demo-switch demo-guest-btn"}
        onClick={() => set.mutate(!on)}
      >
        <span className="demo-switch-track" aria-hidden="true">
          <span className="demo-switch-thumb" />
        </span>
        <span>
          {t("demo.simulator")}: <b>{on ? t("demo.on") : t("demo.off")}</b>
        </span>
      </button>
      {set.isError && (
        <span role="alert" className="text-xs">
          {t("demo.errors.simulator")}
        </span>
      )}
    </div>
  );
}
