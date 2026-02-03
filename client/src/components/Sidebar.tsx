import { useMemo, useState } from "react";
import { FolderTree, MessageSquare, History, Settings, Plus, FileCode, Trash2, Sun, Moon, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useFiles, useCreateFile, useDeleteFile } from "@/hooks/use-files";
import { useBacktests } from "@/hooks/use-backtests";
import { useAIStore, useAIModels, useTestAIModel } from "@/hooks/use-ai";
import { useTheme } from "@/components/ThemeProvider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertFileSchema } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type SidebarTab = "explorer" | "backtests";

interface SidebarProps {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  onFileSelect: (fileId: number) => void;
  onBacktestSelect: () => void; // Switch main view to backtest list
  selectedStrategyName?: string | null;
  onViewBacktest?: (backtestId: number) => void;
  showDiagnosticsIcon?: boolean;
  diagnosticsActive?: boolean;
  onDiagnosticsSelect?: () => void;
}

export function Sidebar({
  activeTab,
  setActiveTab,
  onFileSelect,
  onBacktestSelect,
  selectedStrategyName,
  onViewBacktest,
  showDiagnosticsIcon,
  diagnosticsActive,
  onDiagnosticsSelect,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="h-full flex flex-col bg-secondary/30 border-r border-border">
      {/* Sidebar Tabs (Icons) */}
      <div className="flex flex-row items-center p-2 border-b border-border space-x-1">
        <SidebarIcon 
          icon={<FolderTree className="w-5 h-5" />} 
          isActive={activeTab === "explorer"} 
          onClick={() => setActiveTab("explorer")}
          tooltip="Explorer"
        />
        <SidebarIcon 
          icon={<History className="w-5 h-5" />} 
          isActive={activeTab === "backtests"} 
          onClick={() => {
            setActiveTab("backtests");
            onBacktestSelect();
          }}
          tooltip="Backtests"
        />
        {showDiagnosticsIcon && (
          <SidebarIcon
            icon={<Activity className="w-5 h-5" />}
            isActive={Boolean(diagnosticsActive)}
            onClick={() => onDiagnosticsSelect?.()}
            tooltip="Diagnostics"
          />
        )}
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "explorer" && <ExplorerView onFileSelect={onFileSelect} />}
        {activeTab === "backtests" && (
          <BacktestsPanel
            onSelect={onBacktestSelect}
            onFileSelect={onFileSelect}
            selectedStrategyName={selectedStrategyName}
            onViewBacktest={onViewBacktest}
          />
        )}
      </div>
      
      {/* Bottom Actions */}
      <div className="p-2 border-t border-border flex items-center gap-1">
        <Button 
          variant="ghost" 
          size="icon" 
          className="w-10 h-10 hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="w-10 h-10 hover:bg-secondary/50 text-muted-foreground hover:text-foreground">
              <Settings className="w-5 h-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <SettingsView />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function SettingsView() {
  const { selectedModel, setSelectedModel } = useAIStore();
  const { data: models } = useAIModels();
  const testModel = useTestAIModel();
  const { theme, setTheme } = useTheme();
  const [testStatus, setTestStatus] = useState<string>("");
  const [modelsOpen, setModelsOpen] = useState(false);

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label htmlFor="model">Default AI Model</Label>
        <div className="text-[10px] text-muted-foreground break-all">
          Selected: {selectedModel}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-8 px-3 text-xs gap-2"
            onClick={() => setModelsOpen((v) => !v)}
          >
            Models ({models?.length ?? 0})
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testModel.isPending || !selectedModel}
            onClick={() => {
              setTestStatus("");
              testModel.mutate(selectedModel, {
                onSuccess: (result) => {
                  const msg = result?.response ? `✓ ${result.response}` : "✓ OK";
                  setTestStatus(msg);
                },
                onError: (error: any) => {
                  setTestStatus(`✗ ${error?.message || "Failed"}`);
                },
              });
            }}
            className="min-h-8 px-3 text-xs"
          >
            {testModel.isPending ? "Testing..." : "Test"}
          </Button>
          {testStatus ? (
            <div className="text-[10px] text-muted-foreground truncate">{testStatus}</div>
          ) : null}
        </div>

        {modelsOpen ? (
          <div className="pt-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">
              Free OpenRouter Models
            </div>
            <ScrollArea className="h-[60vh] pr-4 rounded-md border border-border/50">
              <div className="space-y-1 p-1">
                {models?.map((model) => (
                  <Button
                    key={model.id}
                    type="button"
                    variant={model.id === selectedModel ? "secondary" : "ghost"}
                    className="w-full justify-start h-auto py-2"
                    onClick={() => {
                      setSelectedModel(model.id);
                      setModelsOpen(false);
                    }}
                  >
                    <div className="flex flex-col items-start gap-0.5 text-left">
                      <div className="text-sm font-medium">{model.name}</div>
                      <div className="text-[10px] text-muted-foreground">{model.id}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </div>

      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Theme</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="min-h-8 px-3 text-xs"
          >
            Toggle Theme
          </Button>
        </div>
      </div>
    </div>
  );
}

function SidebarIcon({ icon, isActive, onClick, tooltip }: { icon: React.ReactNode, isActive: boolean, onClick: () => void, tooltip: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "w-10 h-10 rounded-md transition-all duration-200",
        isActive 
          ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" 
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      )}
      onClick={onClick}
      title={tooltip}
    >
      {icon}
    </Button>
  );
}

function ExplorerView({ onFileSelect }: { onFileSelect: (id: number) => void }) {
  const { data: files, isLoading } = useFiles();
  const deleteFile = useDeleteFile();
  const [createOpen, setCreateOpen] = useState(false);

  // Form for creating files
  const form = useForm<z.infer<typeof insertFileSchema>>({
    resolver: zodResolver(insertFileSchema),
    defaultValues: {
      path: "",
      type: "python",
      content: "# New file content",
    },
  });

  const createFile = useCreateFile();

  const onSubmit = (data: z.infer<typeof insertFileSchema>) => {
    createFile.mutate(data, {
      onSuccess: () => {
        setCreateOpen(false);
        form.reset();
      },
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 flex items-center justify-between border-b border-border/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-primary/20 hover:text-primary">
              <Plus className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New File</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="path"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Filename</FormLabel>
                      <FormControl>
                        <Input placeholder="strategies/MyStrategy.py" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <select 
                          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                          {...field}
                        >
                          <option value="python">Python Strategy</option>
                          <option value="json">JSON Config</option>
                          <option value="text">Text File</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={createFile.isPending}>
                    {createFile.isPending ? "Creating..." : "Create File"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading files...</div>
        ) : (
          <div className="py-2">
            {files?.map((file) => (
              <div 
                key={file.id}
                className="group flex items-center justify-between px-3 py-1.5 hover:bg-secondary/60 cursor-pointer text-sm transition-colors"
                onClick={() => onFileSelect(file.id)}
              >
                <div className="flex items-center gap-2 truncate">
                  <FileCode className={cn(
                    "w-4 h-4", 
                    file.type === 'python' ? 'text-blue-400' : 
                    file.type === 'json' ? 'text-yellow-400' : 'text-gray-400'
                  )} />
                  <span className="truncate text-secondary-foreground/90 group-hover:text-primary transition-colors">
                    {file.path.split('/').pop()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if(confirm("Delete this file?")) deleteFile.mutate(file.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
            {files?.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No files yet. Create one to get started.
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function BacktestsPanel({
  onSelect,
  onFileSelect,
  selectedStrategyName,
  onViewBacktest,
}: {
  onSelect: () => void;
  onFileSelect: (fileId: number) => void;
  selectedStrategyName?: string | null;
  onViewBacktest?: (backtestId: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: backtests } = useBacktests();
  const { data: files } = useFiles();

  const filtered = useMemo(() => {
    const s = typeof selectedStrategyName === "string" ? selectedStrategyName : "";
    if (!s.trim()) return [];
    const arr = Array.isArray(backtests) ? backtests : [];
    return arr.filter((b: any) => b?.strategyName === s).slice(0, 8);
  }, [backtests, selectedStrategyName]);

  const rollbackMutation = useMutation({
    mutationFn: async (backtestId: number) => {
      const res = await fetch(`/api/backtests/${backtestId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.message || "Rollback failed");
      }
      return res.json() as Promise<{ success: boolean; strategyPath: string }>;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/files"] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ["config"] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ["/api/backtests"] }).catch(() => {});

      const strategyPath = typeof (data as any)?.strategyPath === "string" ? (data as any).strategyPath : "";
      const id = Array.isArray(files) ? files.find((f: any) => f?.path === strategyPath)?.id : undefined;
      if (typeof id === "number") {
        onFileSelect(id);
      }

      toast({
        title: "Rollback complete",
        description: "Strategy and config were restored from the selected run.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Rollback failed",
        description: error?.message || "Failed",
        variant: "destructive",
      });
    },
  });

  const s = typeof selectedStrategyName === "string" ? selectedStrategyName : "";

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border/50 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Backtests</span>
        <Button variant="outline" size="sm" onClick={onSelect}>
          Open Dashboard
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {!s.trim() ? (
            <div className="text-sm text-muted-foreground">
              Select a strategy file to see recent runs.
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                Strategy: <span className="font-mono">{s.split("/").pop()}</span>
              </div>

              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground">No recent runs for this strategy.</div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((b: any) => (
                    <div key={b.id} className="p-2 rounded-md border border-border/50 bg-background/40">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">Run #{b.id}</div>
                        <div className={cn(
                          "text-[10px] font-bold uppercase",
                          b.status === "completed" ? "text-green-500" : b.status === "failed" ? "text-destructive" : "text-muted-foreground"
                        )}>
                          {String(b.status || "-")}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {b.createdAt ? new Date(b.createdAt).toLocaleString() : ""}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onViewBacktest?.(b.id)}
                          disabled={!onViewBacktest}
                        >
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => rollbackMutation.mutate(b.id)}
                          disabled={rollbackMutation.isPending}
                        >
                          {rollbackMutation.isPending ? "Rolling back..." : "Rollback"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
