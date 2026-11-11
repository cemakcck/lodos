import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router";
import { useTranslation } from "react-i18next";
import { guestRoutes } from "./guest/routes";
import { GuestFrame, StaffFrame } from "./frames";
import { DemoLanding } from "./demo/DemoLanding";
import { Login } from "./staff/Login";
import { RequireStaff, StaffHome } from "./staff/RequireStaff";
import { Kds } from "./staff/kds/Kds";
import { Floor } from "./staff/floor/Floor";
import { Receipt } from "./staff/Receipt";
import { CloseView } from "./staff/close/CloseView";
import { OrderEntry } from "./staff/order/OrderEntry";
import { MenuEditor } from "./staff/manager/MenuEditor";
import { Tables } from "./staff/manager/Tables";
import { QrSheet } from "./staff/manager/QrSheet";
import { Sales } from "./staff/sales/Sales";
import type { StaffRole } from "./staff/auth";

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
            { path: "/staff/floor", element: <Floor /> },
            { path: "/staff/order/:tableId", element: <OrderEntry /> },
            { path: "/staff/check/:id/print", element: <Receipt /> },
            { path: "/staff/check/:id/receipt", element: <Receipt /> },
            { path: "/staff/check/:id/close", element: <CloseView /> },
          ]),
          guarded(["manager"], [
            { path: "/staff/menu", element: <MenuEditor /> },
            { path: "/staff/tables", element: <Tables /> },
            { path: "/staff/tables/qr", element: <QrSheet /> },
            { path: "/staff/sales", element: <Sales /> },
            { path: "/staff/tonight", element: <Navigate to="/staff/sales" replace /> },
          ]),
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
