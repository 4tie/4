import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
