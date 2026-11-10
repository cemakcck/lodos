import { createBrowserRouter, useParams, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { guestRoutes } from "./guest/routes";

function Placeholder({ name, surface }: { name: string; surface: "guest" | "staff" }) {
  const { t } = useTranslation();
  const params = useParams();
  return (
    <main className={surface === "guest" ? "theme-guest p-6" : "theme-staff p-6"}>
      <h1 className="text-lg">{t("app.name")}</h1>
      <p data-testid="placeholder">{name} · {t("app.comingSoon")}</p>
      {Object.keys(params).length > 0 && <code>{JSON.stringify(params)}</code>}
    </main>
  );
}

const ph = (name: string, surface: "guest" | "staff" = "staff") => <Placeholder name={name} surface={surface} />;

export const routes = [
  {
    element: <Outlet />,
    children: [
      { path: "/", element: ph("landing", "guest") },
      ...guestRoutes,
      { path: "/staff/login", element: ph("login") },
      { path: "/staff/kitchen", element: ph("kitchen") },
      { path: "/staff/bar", element: ph("bar") },
      { path: "/staff/floor", element: ph("floor") },
      { path: "/staff/order/:tableId", element: ph("order entry") },
      { path: "/staff/check/:id/print", element: ph("check print") },
      { path: "/staff/menu", element: ph("menu editor") },
      { path: "/staff/tables", element: ph("tables") },
      { path: "/staff/tables/qr", element: ph("table QR codes") },
      { path: "/staff/tonight", element: ph("tonight") },
      { path: "*", element: ph("not found") },
    ],
  },
];

export const router = createBrowserRouter(routes);
