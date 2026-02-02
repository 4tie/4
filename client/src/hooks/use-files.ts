import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { CreateFileRequest, UpdateFileRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useFiles() {
  return useQuery({
    queryKey: [api.files.list.path],
    queryFn: async () => {
      const res = await fetch(api.files.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch files");
      return api.files.list.responses[200].parse(await res.json());
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

export function useFile(id: number | null) {
  return useQuery({
    queryKey: [api.files.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const url = buildUrl(api.files.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch file");
      return api.files.get.responses[200].parse(await res.json());
    },
  });
}

export function useCreateFile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (data: CreateFileRequest) => {
      const res = await fetch(api.files.create.path, {
        method: api.files.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create file");
      }
      return api.files.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
      toast({ title: "File created", description: "Successfully created new file." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateFile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, content }: { id: number } & UpdateFileRequest) => {
      const url = buildUrl(api.files.update.path, { id });
      const res = await fetch(url, {
        method: api.files.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update file");
      return api.files.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.files.get.path, data.id] });
      toast({ title: "File saved", description: "Your changes have been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.files.delete.path, { id });
      const res = await fetch(url, {
        method: api.files.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete file");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
      toast({ title: "File deleted", description: "The file has been permanently removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
