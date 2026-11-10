/* Shared test harness for the guest screens: fake socket, routed fetch mock, fixtures and a renderer. */
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import "../../src/i18n";
import { guestRoutes } from "../../src/guest/routes";
import type { MenuItem, MenuResponse, OrdersResponse, TableResponse } from "../../src/guest/types";

export { sockets } from "./fakeSocket";

type Reply = { status: number; body?: unknown };
type Route = unknown | ((body: unknown) => Reply);
export type Call = { method: string; path: string; body: unknown; headers: Headers };

/** Routes are keyed "METHOD /path". A plain value replies 200 with it; a function returns { status, body }. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: new Headers(init.headers) });
    const r = routes[`${method} ${path}`];
    const res: Reply =
      r === undefined
        ? { status: 404, body: { error: { code: "not_found", message: "nope" } } }
        : typeof r === "function"
          ? (r as (b: unknown) => Reply)(body)
          : { status: 200, body: r };
    return new Response(res.body === undefined ? "" : JSON.stringify(res.body), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, routes };
}

export function renderGuest(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(guestRoutes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, router };
}

const n = (en: string, tr: string) => ({ en, tr });

export const ribeye: MenuItem = {
  id: "ribeye",
  categoryId: "fire",
  name: n("Dry-aged ribeye, 300 g", "Dinlendirilmiş antrikot, 300 g"),
  description: n("Thirty-five-day dry-aged ribeye from the charcoal.", "Kömürde pişen dinlendirilmiş antrikot."),
  story: n("Aged on the bone by the entrance.", "Girişte kemik üstünde dinlendirilir."),
  price: 245000,
  station: "kitchen",
  dietary: ["gluten-free"],
  allergens: ["celery", "milk"],
  photo: "/photos/dry-aged-ribeye.jpg",
  optionGroups: [
    {
      id: "doneness",
      name: n("Doneness", "Pişirme"),
      type: "single",
      required: true,
      options: [
        { id: "rare", name: n("Rare", "Az pişmiş"), priceDelta: 0 },
        { id: "medium-rare", name: n("Medium rare", "Orta az pişmiş"), priceDelta: 0 },
      ],
    },
    {
      id: "extras",
      name: n("Extras", "Ekstralar"),
      type: "multi",
      required: false,
      options: [
        { id: "burrata", name: n("Add burrata", "Burrata ekle"), priceDelta: 18000 },
        { id: "marrow", name: n("Add bone marrow", "İlik ekle"), priceDelta: 25000 },
      ],
    },
  ],
  availability: { soldOut: false, remaining: null },
};

export const burrata: MenuItem = {
  id: "burrata",
  categoryId: "share",
  name: n("Burrata, heirloom tomato", "Burrata, yerli domates"),
  description: n("Creamy burrata, ripe tomatoes.", "Kremsi burrata, olgun domates."),
  story: n("", ""),
  price: 54000,
  station: "kitchen",
  dietary: ["vegetarian"],
  allergens: ["milk", "gluten"],
  photo: "/photos/burrata.jpg",
  optionGroups: [],
  availability: { soldOut: false, remaining: null },
};

export const negroni: MenuItem = {
  id: "negroni",
  categoryId: "cocktails",
  name: n("Lodos Negroni", "Lodos Negroni"),
  description: n("Gin, bitter red aperitivo and sweet vermouth.", "Cin, acı kırmızı aperitif ve tatlı vermut."),
  story: n("Barrel rested for three weeks.", "Üç hafta fıçıda dinlenir."),
  price: 68000,
  station: "bar",
  dietary: ["vegan"],
  allergens: [],
  photo: "/photos/lodos-negroni.jpg",
  optionGroups: [],
  availability: { soldOut: false, remaining: null },
};

export const menu: MenuResponse = {
  categories: [
    { id: "share", name: n("To share", "Paylaşmalık") },
    { id: "fire", name: n("From the fire", "Ateşten") },
    { id: "cocktails", name: n("Cocktails", "Kokteyller") },
  ],
  items: [burrata, ribeye, negroni],
};

export const tableWith = (checkId: string | null): TableResponse => ({
  table: { id: "t7", name: "T7" },
  visit: checkId ? { checkId, openedAt: "2026-11-10T19:00:00.000Z" } : null,
});

export const orders: OrdersResponse = {
  visit: { checkId: "c1", openedAt: "2026-11-10T19:00:00.000Z" },
  food: [
    { orderId: "o1", qty: 1, name: burrata.name, options: [], note: null, status: "preparing", lineTotal: 54000 },
  ],
  drinks: [
    { orderId: "o1", qty: 2, name: negroni.name, options: [n("Mastic gin", "Sakızlı cin")], note: "no ice", status: "ready", lineTotal: 148000 },
  ],
  totals: { food: 54000, drinks: 148000, total: 202000 },
};

export function baseRoutes(checkId: string | null = "c1"): Record<string, Route> {
  return {
    "GET /api/guest/table": tableWith(checkId),
    "GET /api/guest/menu": menu,
    "GET /api/guest/orders": checkId ? orders : { visit: null },
  };
}
