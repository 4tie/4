import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect, useMemo } from "react";

interface AIState {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      selectedModel: "google/gemma-2-9b-it:free",
      setSelectedModel: (selectedModel) => set({ selectedModel }),
    }),
    {
      name: "ai-storage",
    }
  )
);

export function useAIModels() {
  return useQuery({
    queryKey: [api.ai.models.path],
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      // In a real app this might fetch from backend proxy
      // For now we can return a static list or fetch if backend implements it
      const res = await fetch(api.ai.models.path, { credentials: "include" });
      if (res.ok) {
        return api.ai.models.responses[200].parse(await res.json());
      }

      return [];
    },
  });
}

/**
 * Returns the model that should be used for all AI calls.
 * If the persisted selection is missing/invalid, auto-falls back to the first available model and persists it.
 */
export function useResolvedAIModel() {
  const { selectedModel, setSelectedModel } = useAIStore();
  const { data: models } = useAIModels();

  const fallback = useMemo(() => {
    const first = models?.[0]?.id;
    return typeof first === "string" && first.trim() ? first : "google/gemma-2-9b-it:free";
  }, [models]);

  const resolved = useMemo(() => {
    const s = typeof selectedModel === "string" ? selectedModel.trim() : "";
    if (!s) return fallback;
    if (Array.isArray(models) && models.length > 0) {
      const ok = models.some((m) => m.id === s);
      return ok ? s : fallback;
    }
    return s;
  }, [selectedModel, models, fallback]);

  useEffect(() => {
    if (resolved && resolved !== selectedModel) {
      setSelectedModel(resolved);
    }
  }, [resolved, selectedModel, setSelectedModel]);

  return resolved;
}

export function useTestAIModel() {
  return useMutation({
    mutationFn: async (model: string) => {
      const res = await fetch(api.ai.test.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ model }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error((error as any)?.message || "Failed to test model");
      }

      return api.ai.test.responses[200].parse(await res.json());
    },
  });
}
