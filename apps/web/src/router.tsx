import { createBrowserRouter, useParams, Outlet, type RouteObject } from "react-router";
import { useTranslation } from "react-i18next";
import { guestRoutes } from "./guest/routes";
import { GuestFrame, StaffFrame } from "./frames";
import { DemoLanding } from "./demo/DemoLanding";
import { Login } from "./staff/Login";
import { RequireStaff, StaffHome } from "./staff/RequireStaff";
import { Shell } from "./staff/Shell";
import { Kds } from "./staff/kds/Kds";
import type { StaffRole } from "./staff/auth";

/** A staff screen still to be built: the real Shell around a quiet note. Later tasks replace these. */
function StaffPlaceholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  const params = useParams();
  return (
    <Shell title={t(titleKey)} stats={null}>
      <div className="p-4">
        <p data-testid="placeholder" className="text-[13px] text-staff-fg-3">
          {t("staff.placeholder")}
          {Object.keys(params).length > 0 && <code className="ml-2 font-mono text-xs">{JSON.stringify(params)}</code>}
        </p>
      </div>
    </Shell>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="theme-staff grid place-items-center p-6">
      <p className="text-[13px] text-staff-fg-2">{t("app.notFound")}</p>
    </main>
  );
}

const guarded = (roles: readonly StaffRole[], children: RouteObject[]): RouteObject => ({
  element: <RequireStaff roles={roles} />,
  children,
});
const ph = (path: string, titleKey: string): RouteObject => ({ path, element: <StaffPlaceholder titleKey={titleKey} /> });

export const routes: RouteObject[] = [
  {
    element: <Outlet />,
    children: [
      { path: "/", element: <DemoLanding /> },
      { element: <GuestFrame />, children: guestRoutes },
      {
        element: <StaffFrame />,
        children: [
          { path: "/staff/login", element: <Login /> },
          { path: "/staff", element: <RequireStaff><StaffHome /></RequireStaff> },
          guarded(["kitchen"], [{ path: "/staff/kitchen", element: <Kds key="kitchen" station="kitchen" /> }]),
          guarded(["bar"], [{ path: "/staff/bar", element: <Kds key="bar" station="bar" /> }]),
          guarded(["waiter"], [
            ph("/staff/floor", "staff.nav.floor"),
            ph("/staff/order/:tableId", "staff.nav.floor"),
            ph("/staff/check/:id/print", "staff.nav.floor"),
          ]),
          guarded(["manager"], [
            ph("/staff/menu", "staff.nav.menu"),
            ph("/staff/tables", "staff.nav.tables"),
            ph("/staff/tables/qr", "staff.nav.tables"),
            ph("/staff/tonight", "staff.nav.tonight"),
          ]),
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
