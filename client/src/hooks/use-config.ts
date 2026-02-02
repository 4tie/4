import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ConfigUpdatePayload {
  strategy?: string;
  timeframe?: string;
  stake_amount?: number;
  max_open_trades?: number;
  tradable_balance_ratio?: number;
  trailing_stop?: boolean;
  trailing_stop_positive?: number;
  trailing_stop_positive_offset?: number;
  trailing_only_offset_is_reached?: boolean;
  minimal_roi?: Record<string, number>;
  stoploss?: number;
  backtest_date_from?: string;
  backtest_date_to?: string;
  pairs?: string[];
}

interface DownloadDataPayload {
  pairs: string[];
  timeframes: string[];
  date_from?: string;
  date_to?: string;
}

export function useGetConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const response = await fetch("/api/config/get", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch config");
      }

      return response.json();
    },
    staleTime: 60_000,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ConfigUpdatePayload) => {
      const response = await fetch("/api/config/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update config");
      }

      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["config"] }).catch(() => {});
    },
  });
}

export function useDownloadData() {
  return useMutation({
    mutationFn: async (payload: DownloadDataPayload) => {
      const response = await fetch("/api/data/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error((error as any).message || "Failed to download data");
      }

      return response.json();
    },
  });
}
