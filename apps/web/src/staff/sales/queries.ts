import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { salesKey, type Range, type SalesView } from "./types";

/** The dashboard for a range; refreshed every minute so "Today" keeps up with the service. */
export const useSales = (range: Range) =>
  useQuery({
    queryKey: salesKey(range),
    queryFn: () => api<SalesView>(`/api/sales?range=${range}`),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
