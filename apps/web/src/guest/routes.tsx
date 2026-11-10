import type { RouteObject } from "react-router";
import { GuestApp } from "./GuestApp";
import { Menu } from "./Menu";
import { TableStatus } from "./TableStatus";

/** `/t/:token` (menu with the landing hero) and `/t/:token/table` ("Your table"). */
export const guestRoutes: RouteObject[] = [
  {
    path: "/t/:token",
    element: <GuestApp />,
    children: [
      { index: true, element: <Menu /> },
      { path: "table", element: <TableStatus /> },
    ],
  },
];
