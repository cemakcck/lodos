import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { DEMO_ROLES, useStartDemo, type DemoRole } from "./useDemo";
import { demoErrorMessage } from "./errors";

/**
 * The five one-click demo roles ("Guest at T7", Waiter, Kitchen, Bar, Manager). Each signs this browser's
 * sandbox in as that role, with no PIN, and navigates to its screen.
 */
export function DemoRoleButtons({
  surface, current, labelledBy, label, wrap = false, seg = false,
}: {
  surface: "guest" | "staff";
  /** Staff only: render as a compact segmented control (the banner) instead of separate buttons. */
  seg?: boolean;
  /** The role in use now, marked as pressed. */
  current?: DemoRole;
  labelledBy?: string;
  label?: string;
  wrap?: boolean;
}) {
  const { t } = useTranslation();
  const demo = useStartDemo();
  const busy = demo.isPending ? demo.variables : null;
  const btn = surface === "guest" ? "demo-guest-role" : seg ? "" : "staff-btn";

  return (
    <div>
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        className={seg && surface === "staff" ? "staff-seg" : `flex gap-1.5 ${wrap ? "flex-wrap" : ""}`}
      >
        {DEMO_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={btn}
            aria-pressed={current ? current === role : undefined}
            disabled={demo.isPending}
            onClick={() => demo.start(role)}
          >
            {busy === role && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
            {t(`demo.roles.${role}`)}
          </button>
        ))}
      </div>
      {demo.isError && (
        <p role="alert" className={surface === "staff" ? "staff-notice mt-2" : "demo-guest-alert mt-2"}>
          {demoErrorMessage(t, demo.error)}
        </p>
      )}
    </div>
  );
}
