import type { RouteObject } from "react-router";
import { DemoAwareGuestApp } from "../demo/KitchenCallout";
import { Menu } from "./Menu";
import { TableStatus } from "./TableStatus";

/** `/t/:token` (menu with the landing hero) and `/t/:token/table` ("Your table"). In demo mode GuestApp gets the kitchen callout. */
export const guestRoutes: RouteObject[] = [
  {
    path: "/t/:token",
    element: <DemoAwareGuestApp />,
    children: [
      { index: true, element: <Menu /> },
      { path: "table", element: <TableStatus /> },
    ],
  },
];
