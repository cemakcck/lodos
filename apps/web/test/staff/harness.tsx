/* Renders the whole app router at a path, for staff and demo screens. Pair with mockFetch from the guest harness. */
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import "../../src/i18n";
import { routes } from "../../src/router";

export { mockFetch } from "../guest/harness";
export { sockets } from "../guest/fakeSocket";

/** An API error reply, for use inside a route function. */
export const reply = (status: number, code: string) => ({ status, body: { error: { code, message: code } } });
/** A route that always answers with that API error. */
export const err = (status: number, code: string) => () => reply(status, code);

export const staffOf = (role: "waiter" | "kitchen" | "bar" | "manager", name = role === "manager" ? "Selin Kaya" : "Kitchen") => ({
  staff: { id: `id-${role}`, name, role },
});

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, router };
}
