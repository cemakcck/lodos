import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ROLE_HOME, canAccess, useMe, useSignOutOn401, type StaffRole } from "./auth";
import { errorMessage } from "../lib/errors";

/**
 * Guards staff routes. No session → `/staff/login` (remembering where you were). A role without access →
 * that role's own screen. The manager passes everything. Renders `children`, or the child routes.
 * Any staff query answering 401 signs out locally, which lands here and redirects.
 */
export function RequireStaff({ roles, children }: { roles?: readonly StaffRole[]; children?: ReactNode }) {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();
  useSignOutOn401();

  if (me.data === null) return <Navigate to="/staff/login" replace state={{ from: location.pathname }} />;
  if (me.data === undefined) {
    if (me.isError) {
      return (
        <div role="alert" className="grid h-full place-items-center p-6 text-[13px] text-staff-fg-2">
          <div className="flex flex-col items-center gap-3">
            <p>{errorMessage(t, me.error)}</p>
            <button type="button" className="staff-btn" onClick={() => void me.refetch()}>
              {t("staff.retry")}
            </button>
          </div>
        </div>
      );
    }
    return <div className="h-full" aria-busy="true" />;
  }
  if (roles && !canAccess(me.data.role, roles)) return <Navigate to={ROLE_HOME[me.data.role]} replace />;
  return children ?? <Outlet />;
}

/** `/staff`: send a signed-in member to their own screen. */
export function StaffHome() {
  const me = useMe();
  if (!me.data) return null;
  return <Navigate to={ROLE_HOME[me.data.role]} replace />;
}
