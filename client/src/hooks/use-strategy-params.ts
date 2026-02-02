import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export type StrategyParam = {
  name: string;
  type: string;
  line: number;
  endLine: number;
  args: any[];
  default: any;
  space: any;
  optimize: any;
  before: string;
};

export function useStrategyParams(strategyPath: string | null, enabled?: boolean) {
  return useQuery({
    queryKey: [api.strategies.params.path, strategyPath],
    enabled: Boolean(strategyPath) && (enabled ?? true),
    queryFn: async () => {
      if (!strategyPath) throw new Error("strategyPath is required");
      const res = await fetch(api.strategies.params.path, {
        method: api.strategies.params.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ strategyPath }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to load strategy params");
      }

      return api.strategies.params.responses[200].parse(await res.json());
    },
  });
}

export function useApplyStrategyParams() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: {
      strategyPath: string;
      changes: Array<{ name: string; before: string; after: string }>;
    }) => {
      const res = await fetch(api.strategies.applyParams.path, {
        method: api.strategies.applyParams.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.details || err?.message || "Failed to apply param changes");
      }

      return api.strategies.applyParams.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.files.get.path] });
      queryClient.invalidateQueries({ queryKey: [api.strategies.params.path, variables.strategyPath] });
      toast({ title: "Applied", description: "Parameter defaults updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
