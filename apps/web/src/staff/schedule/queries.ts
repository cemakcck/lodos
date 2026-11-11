import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { myShiftsKey, shiftsKey, templatesKey, weekKey, type MyShiftsView, type ShiftTemplate, type WeekView } from "./types";

export const useWeek = (week: string | null) =>
  useQuery({
    queryKey: weekKey(week),
    queryFn: () => api<WeekView>(week ? `/api/shifts?week=${week}` : "/api/shifts"),
    placeholderData: (prev) => prev,
  });

export const useTemplates = () =>
  useQuery({ queryKey: templatesKey, queryFn: async () => (await api<{ templates: ShiftTemplate[] }>("/api/shift-templates")).templates });

export const useMyShifts = () => useQuery({ queryKey: myShiftsKey, queryFn: () => api<MyShiftsView>("/api/me/shifts") });

/** After any shift write: every week view and My shifts. */
export const refreshShifts = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: shiftsKey });
