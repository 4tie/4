import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { RunBacktestRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useBacktests() {
  return useQuery({
    queryKey: [api.backtests.list.path],
    queryFn: async () => {
      const res = await fetch(api.backtests.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch backtests");
      return api.backtests.list.responses[200].parse(await res.json());
    },
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return Array.isArray(data) && data.some((b) => b?.status === "running") ? 2000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useRunBacktestBatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: {
      strategyName: string;
      baseConfig: any;
      ranges?: Array<{ from: string; to: string }>;
      rolling?: { windowDays: number; stepDays?: number; count?: number; end?: string };
      batchId?: string;
    }) => {
      const res = await fetch(api.backtests.batchRun.path, {
        method: api.backtests.batchRun.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error((error as any).message || "Failed to run batch backtest");
      }
      return api.backtests.batchRun.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] });
      toast({
        title: "Batch started",
        description: `Started batch ${data.batchId} (${data.backtests.length} runs)`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useBacktest(id: number | null) {
  return useQuery({
    queryKey: [api.backtests.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.backtests.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch backtest details");
      return api.backtests.get.responses[200].parse(await res.json());
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll if running, or if completed but results have not been attached yet.
      // This avoids a race where status flips to 'completed' before results are persisted.
      const hasResults = Boolean((data as any)?.results);
      return data?.status === "running" || (data?.status === "completed" && !hasResults) ? 1000 : false;
    },
  });
}

export function useRunBacktest() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: RunBacktestRequest) => {
      const res = await fetch(api.backtests.run.path, {
        method: api.backtests.run.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to run backtest");
      }
      return api.backtests.run.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] });
      toast({ title: "Backtest started", description: `Started backtest for ${data.strategyName}` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
