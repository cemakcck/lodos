import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { managerStaffKey } from "../manager/types";
import { peopleKey, type StaffList } from "./types";

export const useStaffPeople = () => useQuery({ queryKey: peopleKey, queryFn: () => api<StaffList>("/api/staff") });

/** After any staff write: the list, the sections on the floor and the sign-in picker all change. */
export function refreshStaff(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: peopleKey });
  void qc.invalidateQueries({ queryKey: managerStaffKey });
  void qc.invalidateQueries({ queryKey: ["floor"] });
  void qc.invalidateQueries({ queryKey: ["auth", "staff"] });
}
