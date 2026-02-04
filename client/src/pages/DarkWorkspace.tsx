import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { DiffEditor } from "@monaco-editor/react";
import { Bot, Check, ChevronDown, ChevronLeft, FileCode, GitCompare, Loader2, Play, Save, Search, Wifi, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

import { CodeEditor, type CodeEditorHandle, type EditorState } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";

import { useFiles, useFile, useUpdateFile } from "@/hooks/use-files";
import { useAIModels } from "@/hooks/use-ai";
import { useBacktest, useRunBacktest } from "@/hooks/use-backtests";
import { useGetConfig } from "@/hooks/use-config";
import { useTheme } from "@/components/ThemeProvider";

import { api } from "@shared/routes";
import { Timeframes, type Timeframe } from "@shared/schema";
import { cn } from "@/lib/utils";

type ConnectionStatus = "connected" | "disconnected" | "checking";

type DiffState = {
  before: string;
  after: string;
  diff: string;
  updatedAt: number;
};

const WORKSPACE_QUICK_BACKTEST_KEY = "workspace:quickBacktest";

const AVAILABLE_PAIRS = [
  "BTC/USDT",
  "ETH/USDT",
  "BNB/USDT",
  "SOL/USDT",
  "ADA/USDT",
  "XRP/USDT",
  "DOT/USDT",
  "DOGE/USDT",
  "AVAX/USDT",
  "LINK/USDT",
  "MATIC/USDT",
  "LTC/USDT",
  "TRX/USDT",
  "UNI/USDT",
  "ATOM/USDT",
  "XLM/USDT",
  "ETC/USDT",
  "BCH/USDT",
  "NEAR/USDT",
  "FIL/USDT",
  "APT/USDT",
  "ARB/USDT",
  "OP/USDT",
  "ICP/USDT",
  "ALGO/USDT",
  "AAVE/USDT",
  "SAND/USDT",
  "MANA/USDT",
  "FTM/USDT",
  "EGLD/USDT",
  "RUNE/USDT",
  "INJ/USDT",
  "GALA/USDT",
  "HBAR/USDT",
  "VET/USDT",
];

function fmtTimerangePartUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function timerangeLastDaysUtc(days: number): string {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - Math.max(0, Math.floor(days)));
  return `${fmtTimerangePartUtc(from)}-${fmtTimerangePartUtc(now)}`;
}

function timerangeYtdUtc(): string {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return `${fmtTimerangePartUtc(from)}-${fmtTimerangePartUtc(now)}`;
}

export default function DarkWorkspace() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const prevThemeRef = useRef(theme);
  const [chatOpen, setChatOpen] = useState(true);

  useEffect(() => {
    setTheme("dark");
    const root = window.document.documentElement;
    root.classList.add("neo-world");

    const applySafeBottom = () => {
      const viewportH = window.visualViewport?.height ?? window.innerHeight;
      const screenH = window.screen?.height ?? viewportH;
      const nearFullscreen = Math.abs(viewportH - screenH) <= 4;
      const isFullscreen = Boolean(document.fullscreenElement);
      const safeBottomPx = (nearFullscreen || isFullscreen) ? 92 : 0;
      root.style.setProperty("--workspace-safe-bottom", `${safeBottomPx}px`);
    };

    applySafeBottom();
    window.addEventListener("resize", applySafeBottom);
    window.addEventListener("fullscreenchange", applySafeBottom);

    return () => {
      window.removeEventListener("resize", applySafeBottom);
      window.removeEventListener("fullscreenchange", applySafeBottom);
      root.style.removeProperty("--workspace-safe-bottom");
      root.classList.remove("neo-world");
      setTheme(prevThemeRef.current);
    };
  }, [setTheme]);

  useEffect(() => {
    if (theme !== "dark") setTheme("dark");
  }, [theme, setTheme]);

  const { data: files, isLoading: filesLoading } = useFiles();

  const [search, setSearch] = useState("");
  const strategies = useMemo(() => {
    const arr = Array.isArray(files) ? files : [];
    const filtered = arr.filter((f) => typeof f?.path === "string" && f.path.startsWith("user_data/strategies/") && f.path.endsWith(".py"));
    const q = search.trim().toLowerCase();
    const out = q
      ? filtered.filter((f) => String(f.path).toLowerCase().includes(q) || String(f.path).split("/").pop()?.toLowerCase().includes(q))
      : filtered;
    return out.sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));
  }, [files, search]);

  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const { data: activeFile } = useFile(activeFileId);
  const updateFile = useUpdateFile();

  const activeFilePath = typeof (activeFile as any)?.path === "string" ? String((activeFile as any).path) : "";
  const isStrategyFile = Boolean(activeFilePath && activeFilePath.startsWith("user_data/strategies/") && activeFilePath.endsWith(".py"));

  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const [editorState, setEditorState] = useState<EditorState>({ selectedCode: "", lineNumber: 1, columnNumber: 1 });

  useEffect(() => {
    if (!activeFile) return;
    setEditorContent((activeFile as any).content ?? "");
    setIsDirty(false);
  }, [activeFile]);

  useEffect(() => {
    setDiffState(null);
    setCenterMode("code");
  }, [activeFileId]);

  const handleSelectFile = (id: number) => {
    if (isDirty) {
      const ok = confirm("You have unsaved changes. Discard them?");
      if (!ok) return;
    }
    setActiveFileId(id);
  };

  const handleSave = useCallback(
    async (value?: string) => {
      if (!activeFileId) return;
      const content = typeof value === "string" ? value : editorRef.current?.getValue?.() ?? editorContent;
      await updateFile.mutateAsync({ id: activeFileId, content });
      setEditorContent(content);
      setIsDirty(false);
    },
    [activeFileId, editorContent, updateFile],
  );

  const [aiStatus, setAiStatus] = useState<ConnectionStatus>("checking");
  const [cliStatus, setCliStatus] = useState<ConnectionStatus>("checking");
  const aiModels = useAIModels();

  useEffect(() => {
    if (aiModels.isLoading) setAiStatus("checking");
    else if (aiModels.isError) setAiStatus("disconnected");
    else if (aiModels.data) setAiStatus("connected");
  }, [aiModels.data, aiModels.isError, aiModels.isLoading]);

  useEffect(() => {
    const checkCli = async () => {
      try {
        const res = await fetch("/api/cmd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "freqtrade --version" }),
        });
        setCliStatus(res.ok ? "connected" : "disconnected");
      } catch {
        setCliStatus("disconnected");
      }
    };

    checkCli();
    const interval = window.setInterval(checkCli, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const { data: configData } = useGetConfig();
  const [quickConfigTouched, setQuickConfigTouched] = useState(false);
  const [quickConfigLoaded, setQuickConfigLoaded] = useState(false);
  const [quickTimeframe, setQuickTimeframe] = useState<Timeframe>("5m");
  const [quickTimerangePreset, setQuickTimerangePreset] = useState<string>("30d");
  const [quickTimerange, setQuickTimerange] = useState<string>(() => timerangeLastDaysUtc(30));
  const [quickSelectedPairs, setQuickSelectedPairs] = useState<string[]>(["BTC/USDT", "ETH/USDT"]);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [pairsQuery, setPairsQuery] = useState("");
  const [quickStake, setQuickStake] = useState<number>(1000);
  const [quickMaxOpenTrades, setQuickMaxOpenTrades] = useState<number>(1);
  const [maxTradesMode, setMaxTradesMode] = useState<"preset" | "custom">("preset");
  const [maxTradesUserSet, setMaxTradesUserSet] = useState(false);

  const availablePairs = useMemo(() => {
    const exchangePairs = (configData as any)?.exchange?.pair_whitelist;
    const pairlistPairs = (configData as any)?.pairlists?.[0]?.pair_whitelist;

    const fromConfig = [exchangePairs, pairlistPairs]
      .flatMap((p: any) => (Array.isArray(p) ? p : []))
      .map((p: any) => String(p))
      .filter((p: string) => p.trim().length > 0);

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of [...AVAILABLE_PAIRS, ...fromConfig]) {
      if (seen.has(p)) continue;
      seen.add(p);
      merged.push(p);
    }

    return merged;
  }, [configData]);

  const filteredPairs = useMemo(() => {
    const q = pairsQuery.trim().toLowerCase();
    if (!q) return availablePairs;
    return availablePairs.filter((p) => p.toLowerCase().includes(q));
  }, [availablePairs, pairsQuery]);

  const toggleQuickPair = (pair: string) => {
    setQuickSelectedPairs((prev) => {
      const curr = Array.isArray(prev) ? [...prev] : [];
      const idx = curr.indexOf(pair);
      if (idx >= 0) curr.splice(idx, 1);
      else curr.push(pair);
      return curr;
    });
  };

  const selectAllQuickPairs = () => setQuickSelectedPairs([...availablePairs]);
  const clearQuickPairs = () => setQuickSelectedPairs([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_QUICK_BACKTEST_KEY);
      if (!raw) {
        setQuickConfigLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setQuickConfigLoaded(true);
        return;
      }

      if (typeof parsed.timeframe === "string" && (Timeframes as readonly string[]).includes(parsed.timeframe)) {
        setQuickTimeframe(parsed.timeframe as Timeframe);
      }
      if (typeof parsed.timerangePreset === "string") setQuickTimerangePreset(parsed.timerangePreset);
      if (typeof parsed.timerange === "string") setQuickTimerange(parsed.timerange);
      if (Array.isArray(parsed.pairs)) {
        const pairs = parsed.pairs.map((p: any) => String(p)).filter(Boolean);
        if (pairs.length) setQuickSelectedPairs(pairs);
      }
      if (Number.isFinite(Number(parsed.stake))) setQuickStake(Number(parsed.stake));
      if (Number.isFinite(Number(parsed.maxOpenTrades))) setQuickMaxOpenTrades(Number(parsed.maxOpenTrades));
      if (parsed.maxTradesMode === "custom") setMaxTradesMode("custom");
      if (typeof parsed.maxTradesUserSet === "boolean") setMaxTradesUserSet(parsed.maxTradesUserSet);

      setQuickConfigTouched(true);
    } catch {
      // ignore
    } finally {
      setQuickConfigLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (quickConfigTouched) return;
    if (!configData || typeof configData !== "object") return;

    const tf = (configData as any)?.timeframe;
    if (typeof tf === "string" && (Timeframes as readonly string[]).includes(tf)) {
      setQuickTimeframe(tf as Timeframe);
    }

    const stakeRaw = (configData as any)?.stake_amount;
    const stake = typeof stakeRaw === "number" ? stakeRaw : typeof stakeRaw === "string" ? Number(stakeRaw) : NaN;
    if (Number.isFinite(stake)) setQuickStake(stake);

    const mot = Number((configData as any)?.max_open_trades);
    if (Number.isFinite(mot)) setQuickMaxOpenTrades(mot);

    const configuredPairs =
      (configData as any)?.exchange?.pair_whitelist ?? (configData as any)?.pairlists?.[0]?.pair_whitelist;
    if (Array.isArray(configuredPairs) && configuredPairs.length) {
      setQuickSelectedPairs(configuredPairs.map((p: any) => String(p)).filter(Boolean).slice(0, 20));
    }
  }, [configData, quickConfigTouched]);

  useEffect(() => {
    if (!quickConfigLoaded) return;
    try {
      localStorage.setItem(
        WORKSPACE_QUICK_BACKTEST_KEY,
        JSON.stringify({
          timeframe: quickTimeframe,
          timerangePreset: quickTimerangePreset,
          timerange: quickTimerange,
          pairs: quickSelectedPairs,
          stake: quickStake,
          maxOpenTrades: quickMaxOpenTrades,
          maxTradesMode,
          maxTradesUserSet,
        }),
      );
    } catch {
      // ignore
    }
  }, [maxTradesMode, maxTradesUserSet, quickConfigLoaded, quickMaxOpenTrades, quickSelectedPairs, quickStake, quickTimeframe, quickTimerange, quickTimerangePreset]);

  useEffect(() => {
    if (!quickConfigLoaded) return;
    if (maxTradesUserSet) return;

    const threads = Array.isArray(quickSelectedPairs) ? quickSelectedPairs.length : 0;
    const desired = Math.max(1, threads);

    setQuickMaxOpenTrades((prev) => {
      if (Number(prev) === desired) return prev;
      return desired;
    });

    const presetOptions = new Set([1, 2, 3, 5, 10, 15, 20, 30]);
    setMaxTradesMode(presetOptions.has(desired) ? "preset" : "custom");
  }, [maxTradesUserSet, quickConfigLoaded, quickSelectedPairs]);

  const runBacktest = useRunBacktest();
  const [lastBacktestId, setLastBacktestId] = useState<number | null>(null);
  const { data: lastBacktest } = useBacktest(lastBacktestId);

  const lastBacktestResults = (lastBacktest as any)?.results;

  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [centerMode, setCenterMode] = useState<"code" | "diff">("code");

  const onPreviewValidatedEdit = useCallback(
    async ({ strategyPath, edits, dryRun }: { strategyPath: string; edits: any[]; dryRun?: boolean }) => {
      const path = String(strategyPath || "").trim();
      if (!path.startsWith("user_data/strategies/") || !path.endsWith(".py")) {
        throw new Error("strategyPath must be a .py file under user_data/strategies/");
      }
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error("No edits provided");
      }

      if (isDirty && activeFilePath && activeFilePath === path) {
        throw new Error("Save the file before requesting a validated edit preview.");
      }

      const res = await fetch(api.strategies.edit.path, {
        method: api.strategies.edit.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ strategyPath: path, edits, dryRun: Boolean(dryRun) }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && typeof (data as any).message === "string"
            ? String((data as any).message)
            : "Rejected change(s)";
        const details =
          data && typeof data === "object" && typeof (data as any).details === "string" ? String((data as any).details) : "";
        throw new Error(details ? `${msg}: ${details}` : msg);
      }

      const nextContent = typeof (data as any)?.content === "string" ? String((data as any).content) : null;
      const nextDiff = typeof (data as any)?.diff === "string" ? String((data as any).diff) : "";

      if (dryRun) {
        const before = (activeFile as any)?.content ?? "";
        if (nextContent != null) {
          setDiffState({ before, after: nextContent, diff: nextDiff, updatedAt: Date.now() });
          setCenterMode("diff");
        }
        return data;
      }

      queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.files.getByPath.path, path] });
      if (activeFileId) {
        queryClient.invalidateQueries({ queryKey: [api.files.get.path, activeFileId] });
      }

      if (activeFilePath && activeFilePath === path && nextContent != null) {
        setEditorContent(nextContent);
        setIsDirty(false);
      }

      return data;
    },
    [activeFile, activeFileId, activeFilePath, isDirty, queryClient],
  );

  const handleRunQuickBacktest = async () => {
    if (!isStrategyFile || !activeFilePath) {
      throw new Error("Open a strategy file first.");
    }

    const pairs = Array.isArray(quickSelectedPairs) ? quickSelectedPairs.map((p) => String(p)).filter(Boolean) : [];

    const config: any = {
      timeframe: quickTimeframe,
      stake_amount: Number(quickStake),
      max_open_trades: Number(quickMaxOpenTrades),
      pairs: pairs.length ? pairs : undefined,
    };

    if (quickTimerange.trim()) {
      config.timerange = quickTimerange.trim();
    }

    const data = await runBacktest.mutateAsync({
      strategyName: activeFilePath,
      config,
    } as any);

    const id = Number((data as any)?.id);
    if (Number.isFinite(id)) {
      setLastBacktestId(id);
    }
  };

  const statusPill = (label: string, status: ConnectionStatus) => {
    const ok = status === "connected";
    const checking = status === "checking";
    return (
      <div className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        checking
          ? "border-purple-500/30 bg-purple-500/10 text-purple-200"
          : ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : "border-red-500/30 bg-red-500/10 text-red-200",
      )}>
        {ok ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div
      className="h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-[#05040a] via-[#0b0714] to-[#12061e] text-slate-100"
      style={{ paddingBottom: "var(--workspace-safe-bottom, 0px)" }}
    >
      <div className="h-12 border-b border-white/10 bg-black/30 backdrop-blur flex items-center justify-between px-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs gap-2 text-slate-200 hover:text-white hover:bg-white/5"
            onClick={() => {
              if (isDirty) {
                const ok = confirm("You have unsaved changes. Leave anyway?");
                if (!ok) return;
              }
              navigate("/");
            }}
          >
            <ChevronLeft className="w-4 h-4" />
            IDE
          </Button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-purple-600/70 to-red-600/70 ring-1 ring-white/10 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-[0.18em] uppercase text-purple-200">Workspace</div>
              <div className="text-[10px] text-slate-400 truncate">
                {activeFilePath ? activeFilePath.split("/").pop() : "No strategy selected"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {statusPill("AI", aiStatus)}
          {statusPill("CLI", cliStatus)}

          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-2 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white"
            onClick={() => handleSave().catch(() => {})}
            disabled={!activeFileId || !isDirty || updateFile.isPending}
          >
            {updateFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>

          <Button
            size="sm"
            className="h-8 px-3 text-xs gap-2 bg-gradient-to-r from-purple-600 to-red-600 hover:from-purple-500 hover:to-red-500"
            onClick={() => {
              setQuickConfigTouched(true);
              handleRunQuickBacktest().catch(() => {});
            }}
            disabled={!isStrategyFile || runBacktest.isPending}
          >
            {runBacktest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </Button>
        </div>
      </div>

      <ResizablePanelGroup
        direction="horizontal"
        className=""
        style={{ height: "calc(100dvh - 3rem - var(--workspace-safe-bottom, 0px))" }}
      >
        <ResizablePanel defaultSize={22} minSize={16} className="bg-black/25">
          <div className="h-full flex flex-col">
            <div className="p-3 border-b border-white/10">
              <div className="text-[10px] font-bold uppercase tracking-widest text-purple-200">Strategies</div>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="h-8 pl-8 text-xs bg-black/30 border-white/10 text-slate-200 placeholder:text-slate-500"
                  />
                </div>
                <Badge
                  variant="outline"
                  className="h-8 px-2 text-[10px] border-white/10 bg-black/30 text-slate-300"
                >
                  {strategies.length}
                </Badge>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {filesLoading ? (
                  <div className="p-3 text-xs text-slate-400">Loading...</div>
                ) : strategies.length === 0 ? (
                  <div className="p-3 text-xs text-slate-400">No strategies found.</div>
                ) : (
                  strategies.map((f: any) => {
                    const isActive = activeFileId != null && Number(f.id) === activeFileId;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handleSelectFile(Number(f.id))}
                        className={cn(
                          "w-full text-left px-2 py-2 rounded-md border transition-colors",
                          isActive
                            ? "border-purple-500/40 bg-purple-500/10"
                            : "border-white/5 hover:border-white/10 hover:bg-white/5",
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileCode className={cn("w-4 h-4 shrink-0", isActive ? "text-purple-200" : "text-slate-400")} />
                          <div className="min-w-0 flex-1">
                            <div className={cn("text-xs font-medium truncate", isActive ? "text-white" : "text-slate-200")}>
                              {String(f.path).split("/").pop()}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">{String(f.path)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            <div className="p-3 border-t border-white/10 bg-black/20">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-widest text-red-200">Quick Backtest</div>
                {lastBacktestId != null ? (
                  <Badge variant="outline" className="text-[10px] border-white/10 bg-black/30 text-slate-300">
                    #{lastBacktestId}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-slate-400 mb-1">Timeframe</div>
                  <select
                    value={quickTimeframe}
                    onChange={(e) => {
                      setQuickConfigTouched(true);
                      setQuickTimeframe(e.target.value as Timeframe);
                    }}
                    className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                  >
                    {Timeframes.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-[10px] text-slate-400 mb-1">Stake</div>
                  <Input
                    value={String(quickStake)}
                    onChange={(e) => {
                      setQuickConfigTouched(true);
                      setQuickStake(Number(e.target.value));
                    }}
                    className="h-8 text-xs bg-black/30 border-white/10 text-slate-200"
                    inputMode="decimal"
                  />
                </div>

                <div className="col-span-2">
                  <div className="text-[10px] text-slate-400 mb-1">Pairs</div>
                  <Popover open={pairsOpen} onOpenChange={setPairsOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-8 justify-between bg-black/30 border-white/10 text-slate-200 hover:bg-white/5"
                        onClick={() => {
                          setQuickConfigTouched(true);
                        }}
                      >
                        <span className="text-xs truncate">
                          {quickSelectedPairs.length > 0
                            ? `${quickSelectedPairs.length} selected`
                            : "Select pairs"}
                        </span>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[340px] p-2">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <Input
                          value={pairsQuery}
                          onChange={(e) => setPairsQuery(e.target.value)}
                          placeholder="Search pairs..."
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => {
                            setQuickConfigTouched(true);
                            selectAllQuickPairs();
                          }}
                        >
                          Select All
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => {
                            setQuickConfigTouched(true);
                            clearQuickPairs();
                          }}
                        >
                          Deselect All
                        </Button>
                      </div>

                      <div className="mt-2 max-h-[240px] overflow-auto rounded-md border border-border/50">
                        {filteredPairs.map((pair) => {
                          const checked = quickSelectedPairs.includes(pair);
                          return (
                            <div
                              key={pair}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-2 text-left text-xs hover:bg-accent",
                                checked && "bg-accent/40",
                              )}
                              onClick={() => {
                                setQuickConfigTouched(true);
                                toggleQuickPair(pair);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setQuickConfigTouched(true);
                                  toggleQuickPair(pair);
                                }
                              }}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => {}}
                              />
                              <span className="flex-1 truncate">{pair}</span>
                              {checked ? <Check className="w-3.5 h-3.5 text-primary" /> : null}
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <div className="text-[10px] text-slate-400 mb-1">Range</div>
                  <select
                    value={quickTimerangePreset}
                    onChange={(e) => {
                      const v = e.target.value;
                      setQuickConfigTouched(true);
                      setQuickTimerangePreset(v);
                      if (v === "30d") setQuickTimerange(timerangeLastDaysUtc(30));
                      else if (v === "60d") setQuickTimerange(timerangeLastDaysUtc(60));
                      else if (v === "90d") setQuickTimerange(timerangeLastDaysUtc(90));
                      else if (v === "180d") setQuickTimerange(timerangeLastDaysUtc(180));
                      else if (v === "365d") setQuickTimerange(timerangeLastDaysUtc(365));
                      else if (v === "ytd") setQuickTimerange(timerangeYtdUtc());
                    }}
                    className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                  >
                    <option value="30d">30d</option>
                    <option value="60d">60d</option>
                    <option value="90d">90d</option>
                    <option value="180d">180d</option>
                    <option value="365d">1y</option>
                    <option value="ytd">YTD</option>
                    <option value="custom">Custom</option>
                  </select>

                  <Input
                    value={quickTimerange}
                    onChange={(e) => {
                      setQuickConfigTouched(true);
                      setQuickTimerangePreset("custom");
                      setQuickTimerange(e.target.value);
                    }}
                    placeholder="YYYYMMDD-YYYYMMDD"
                    className="mt-2 h-8 text-xs bg-black/30 border-white/10 text-slate-200 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <div className="text-[10px] text-slate-400 mb-1">Max Open Trades</div>
                  <select
                    value={maxTradesMode === "custom" ? "custom" : String(quickMaxOpenTrades)}
                    onChange={(e) => {
                      setQuickConfigTouched(true);
                      setMaxTradesUserSet(true);
                      const v = e.target.value;
                      if (v === "custom") {
                        setMaxTradesMode("custom");
                        return;
                      }
                      const n = Number(v);
                      if (Number.isFinite(n)) {
                        setMaxTradesMode("preset");
                        setQuickMaxOpenTrades(n);
                      }
                    }}
                    className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                  >
                    {[1, 2, 3, 5, 10, 15, 20, 30].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>

                  {maxTradesMode === "custom" && (
                    <Input
                      value={String(quickMaxOpenTrades)}
                      onChange={(e) => {
                        setQuickConfigTouched(true);
                        setMaxTradesUserSet(true);
                        setQuickMaxOpenTrades(Number(e.target.value));
                      }}
                      className="mt-2 h-8 text-xs bg-black/30 border-white/10 text-slate-200"
                      inputMode="numeric"
                    />
                  )}
                </div>
              </div>

              {lastBacktest ? (
                <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Status</div>
                    <div className={cn(
                      "text-[10px] font-bold uppercase",
                      String((lastBacktest as any)?.status) === "completed"
                        ? "text-emerald-200"
                        : String((lastBacktest as any)?.status) === "failed"
                          ? "text-red-200"
                          : "text-purple-200",
                    )}>
                      {String((lastBacktest as any)?.status || "-")}
                    </div>
                  </div>
                  {lastBacktestResults ? (
                    <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-slate-300">
                      <div>Profit: {typeof lastBacktestResults?.profit_total === "number" ? `${(lastBacktestResults.profit_total * 100).toFixed(2)}%` : "-"}</div>
                      <div>Win: {typeof lastBacktestResults?.win_rate === "number" ? `${(lastBacktestResults.win_rate * 100).toFixed(1)}%` : "-"}</div>
                      <div>DD: {typeof lastBacktestResults?.max_drawdown === "number" ? `${(lastBacktestResults.max_drawdown * 100).toFixed(2)}%` : "-"}</div>
                      <div>Trades: {lastBacktestResults?.total_trades ?? "-"}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={53} minSize={30} className="bg-black/10">
          <div className="h-full flex flex-col">
            <div className="h-10 border-b border-white/10 bg-black/20 flex items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-2",
                    centerMode === "code" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                  onClick={() => setCenterMode("code")}
                  disabled={!activeFileId}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  Code
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-2",
                    centerMode === "diff" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                  onClick={() => setCenterMode("diff")}
                  disabled={!diffState}
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  Diff
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {isDirty ? (
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-200 text-[10px]">
                    Unsaved
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-white/10 bg-black/20 text-slate-300 text-[10px]">
                    Clean
                  </Badge>
                )}
                {diffState ? (
                  <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-200 text-[10px]">
                    Validated
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex-1 min-h-0 p-3">
              {centerMode === "diff" ? (
                diffState ? (
                  <div className="h-full rounded-md border border-white/10 overflow-hidden">
                    <DiffEditor
                      height="100%"
                      language="python"
                      theme="vs-dark"
                      original={diffState.before}
                      modified={diffState.after}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fontSize: 13,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                  </div>
                ) : (
                  <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
                    No validated diff yet.
                  </div>
                )
              ) : activeFileId ? (
                <CodeEditor
                  ref={editorRef}
                  language="python"
                  value={editorContent}
                  onChange={(v) => {
                    if (v === undefined) return;
                    setEditorContent(v);
                    setIsDirty(true);
                  }}
                  onSave={handleSave}
                  onEditorStateChange={(s) => setEditorState(s)}
                />
              ) : (
                <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
                  Select a strategy.
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={25} minSize={20} className="bg-black/25">
          <div className="h-full relative">
            <ChatPanel
              isOpen={chatOpen}
              onToggle={() => setChatOpen((v) => !v)}
              context={{
                fileName: isStrategyFile ? activeFilePath : undefined,
                fileContent: isStrategyFile ? editorContent : undefined,
                selectedCode: editorState.selectedCode,
                lineNumber: editorState.lineNumber,
                columnNumber: editorState.columnNumber,
                lastBacktest: lastBacktestId != null ? { id: lastBacktestId, strategyName: activeFilePath, config: (lastBacktest as any)?.config } : undefined,
                backtestResults: lastBacktestResults
                  ? {
                      profit_total: Number(lastBacktestResults.profit_total ?? 0),
                      win_rate: Number(lastBacktestResults.win_rate ?? 0),
                      max_drawdown: Number(lastBacktestResults.max_drawdown ?? 0),
                      total_trades: Number(lastBacktestResults.total_trades ?? 0),
                      avg_profit: typeof lastBacktestResults?.avg_profit === "number" ? lastBacktestResults.avg_profit : undefined,
                      sharpe: typeof lastBacktestResults?.sharpe === "number" ? lastBacktestResults.sharpe : undefined,
                    }
                  : undefined,
              }}
              onApplyCode={(code) => {
                editorRef.current?.applyCode(code);
                setEditorContent(editorRef.current?.getValue?.() ?? editorContent);
                setIsDirty(true);
              }}
              onApplyAndSaveCode={(code) => {
                editorRef.current?.applyCode(code);
                const next = editorRef.current?.getValue?.() ?? editorContent;
                setEditorContent(next);
                setIsDirty(true);
                handleSave(next).catch(() => {});
              }}
              onPreviewValidatedEdit={onPreviewValidatedEdit}
            />

            {!chatOpen && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <Button
                  type="button"
                  variant="outline"
                  className="bg-white/5 border-white/10 hover:bg-white/10"
                  onClick={() => setChatOpen(true)}
                >
                  Open Chat
                </Button>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
