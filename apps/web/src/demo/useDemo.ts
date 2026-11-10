import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, ApiClientError } from "../lib/api";
import { reconnectStaffSocket } from "../lib/socket";
import { restartGuestPages } from "../guest/session";
import { fetchMe, meKey } from "../staff/auth";

export const DEMO_ROLES = ["guest", "waiter", "kitchen", "bar", "manager"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export interface DemoInfo {
  guestUrl: string;
  simulatorOn: boolean;
}

/** `live`: demo mode is off. `demo` with `info: null`: demo mode, but this browser has no sandbox yet. */
export type DemoState = { mode: "live" } | { mode: "demo"; info: DemoInfo | null };

export const demoKey = ["demo", "info"] as const;

/** Demo detection: /api/demo/info 404 → live; 401 (no sandbox yet) or 200 → demo. */
export async function fetchDemo(): Promise<DemoState> {
  try {
    return { mode: "demo", info: await api<DemoInfo>("/api/demo/info") };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) return { mode: "live" };
    if (e instanceof ApiClientError && e.status === 401) return { mode: "demo", info: null };
    throw e;
  }
}

/**
 * Cached demo state. `isDemo` is `undefined` until known (and stays so if the API is unreachable),
 * so callers can render nothing demo-specific rather than guess.
 */
export function useDemo() {
  const q = useQuery({ queryKey: demoKey, queryFn: fetchDemo, staleTime: 5 * 60_000 });
  const isDemo = q.data ? q.data.mode === "demo" : undefined;
  const info = q.data?.mode === "demo" ? q.data.info : null;
  return { ...q, isDemo, info };
}

/**
 * POST /api/demo/session: creates or reuses this browser's sandbox and signs in as `role`.
 * Refreshes who is signed in before resolving, so the next page's role check sees the new role.
 */
export function useDemoSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (role: DemoRole) => {
      const { redirect } = await api<{ redirect: string }>("/api/demo/session", { method: "POST", body: JSON.stringify({ role }) });
      if (role === "guest") {
        qc.setQueryData(meKey, null);
        restartGuestPages(); // a guest page that showed "visit ended" starts over and adopts the table's visit
      }
      else {
        try {
          await qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 0 });
        } catch {
          void qc.invalidateQueries({ queryKey: meKey }); // the session exists; RequireStaff refetches
        }
      }
      reconnectStaffSocket();
      // The sandbox may be new (the old one expired): everything else is refetched as it is used.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      return redirect;
    },
  });
}

/** `useDemoSession` plus navigation to the redirect it returns. */
export function useStartDemo() {
  const session = useDemoSession();
  const navigate = useNavigate();
  const start = (role: DemoRole) =>
    session.mutate(role, {
      onSuccess: (redirect) => {
        void navigate(redirect);
      },
    });
  return { ...session, start };
}
