import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { api, ApiClientError } from "../lib/api";

export type StaffRole = "waiter" | "kitchen" | "bar" | "manager";
export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
}

export const meKey = ["auth", "me"] as const;

/** `/api/auth/me`, with 401 mapped to `null` (signed out) instead of an error. */
export async function fetchMe(): Promise<StaffMember | null> {
  try {
    return (await api<{ staff: StaffMember }>("/api/auth/me")).staff;
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 401) return null;
    throw e;
  }
}

/** The signed-in staff member: `data` is the member, `null` when signed out, `undefined` while loading. */
export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 60_000 });
}

/** Forget the session locally; RequireStaff then redirects to the login. */
export function markSignedOut(qc: QueryClient): void {
  qc.setQueryData(meKey, null);
}

/** Where each role starts. Matches the demo redirects. */
export const ROLE_HOME: Record<StaffRole, string> = {
  waiter: "/staff/floor",
  kitchen: "/staff/kitchen",
  bar: "/staff/bar",
  manager: "/staff/menu",
};

/** The manager passes every role check. */
export function canAccess(role: StaffRole, allowed: readonly StaffRole[]): boolean {
  return role === "manager" || allowed.includes(role);
}

/** Initials for the avatar: first letters of the first two words ("Selin Kaya" → "SK", "Kitchen" → "K"). */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr"))
    .join("");
}

/** Query keys that are not staff data: a 401 there means something else (no sandbox, bad table token). */
const NOT_STAFF = new Set(["guest", "demo", "auth"]);
const isStaffKey = (k: QueryKey) => !NOT_STAFF.has(String(k[0]));
const is401 = (e: unknown) => e instanceof ApiClientError && e.status === 401;

/** Any staff query or mutation answering 401 means the session is gone: sign out locally. */
export function useSignOutOn401(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const unQ = qc.getQueryCache().subscribe((ev) => {
      if (ev.type === "updated" && ev.action.type === "error" && is401(ev.action.error) && isStaffKey(ev.query.queryKey)) {
        markSignedOut(qc);
      }
    });
    const unM = qc.getMutationCache().subscribe((ev) => {
      if (ev.type === "updated" && ev.action.type === "error" && is401(ev.action.error)) markSignedOut(qc);
    });
    return () => {
      unQ();
      unM();
    };
  }, [qc]);
}
