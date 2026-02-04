import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { DiffEditor } from "@monaco-editor/react";
import { BarChart3, Bot, Check, ChevronDown, ChevronLeft, FileCode, GitCompare, Loader2, Play, Save, Search, Wifi, WifiOff } from "lucide-react";

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
import { useBacktest, useBacktests, useRunBacktest } from "@/hooks/use-backtests";
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
const WORKSPACE_TRADES_COL_WIDTHS_KEY = "workspace:tradesTableColWidths";

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

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toPctMaybe(v: unknown): number | null {
  const n = toFiniteNumber(v);
  if (n == null) return null;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return "-";
  return `${v.toFixed(digits)}%`;
}

function fmtMoney(v: number | null, digits = 2): string {
  if (v == null) return "-";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}${abs.toFixed(digits)}`;
}

function fmtDateTime(v: unknown): string {
  if (typeof v !== "string") return "-";
  if (!v) return "-";
  return v.replace("+00:00", "").replace("T", " ");
}

function dateMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function fmtDurationMinutes(v: number | null): string {
  if (v == null) return "-";
  const total = Math.max(0, Math.floor(v));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
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
  const backtestsQuery = useBacktests();

  const latestBacktestIdForActiveStrategy = useMemo(() => {
    if (!activeFilePath) return null;
    if (!backtestsQuery.data) return undefined;
    const list = Array.isArray(backtestsQuery.data) ? (backtestsQuery.data as any[]) : [];
    const matches = list.filter((b) => String((b as any)?.strategyName || "") === activeFilePath);
    if (!matches.length) return null;
    let best = matches[0];
    for (const b of matches) {
      const aId = toFiniteNumber((best as any)?.id) ?? -1;
      const bId = toFiniteNumber((b as any)?.id) ?? -1;
      if (bId > aId) best = b;
    }
    const id = toFiniteNumber((best as any)?.id);
    return id != null ? Math.floor(id) : null;
  }, [activeFilePath, backtestsQuery.data]);

  useEffect(() => {
    if (!activeFilePath) {
      if (lastBacktestId != null) setLastBacktestId(null);
      return;
    }
    if (latestBacktestIdForActiveStrategy === undefined) {
      return;
    }
    if (latestBacktestIdForActiveStrategy == null) {
      if (lastBacktestId != null) setLastBacktestId(null);
      return;
    }
    if (lastBacktestId === latestBacktestIdForActiveStrategy) return;
    setLastBacktestId(latestBacktestIdForActiveStrategy);
    setResultsAdvancedOpen(false);
  }, [activeFilePath, lastBacktestId, latestBacktestIdForActiveStrategy]);

  const lastBacktestResults = (lastBacktest as any)?.results;

  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [centerMode, setCenterMode] = useState<"code" | "diff" | "results">("code");
  const [resultsShownForBacktestId, setResultsShownForBacktestId] = useState<number | null>(null);
  const [resultsAdvancedOpen, setResultsAdvancedOpen] = useState(false);
  const [tradesFilterPair, setTradesFilterPair] = useState<string>("all");
  const [tradesFilterPnL, setTradesFilterPnL] = useState<"all" | "profit" | "loss">("all");
  const [tradesSearch, setTradesSearch] = useState<string>("");
  const [tradesPage, setTradesPage] = useState(1);
  const tradesPageSize = 50;

  const defaultTradeColWidths = useMemo(
    () => ({
      pair: 140,
      open: 170,
      close: 170,
      duration: 100,
      profitPct: 90,
      profitAbs: 110,
      exit: 140,
    }),
    [],
  );

  const [tradeColWidths, setTradeColWidths] = useState<Record<string, number>>(defaultTradeColWidths);
  const resizingColRef = useRef<null | { key: string; startX: number; startWidth: number }>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_TRADES_COL_WIDTHS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const next: Record<string, number> = { ...defaultTradeColWidths };
      for (const k of Object.keys(defaultTradeColWidths)) {
        const v = (parsed as any)[k];
        const n = toFiniteNumber(v);
        if (n != null && n >= 60 && n <= 800) next[k] = n;
      }
      setTradeColWidths(next);
    } catch {
      // ignore
    }
  }, [defaultTradeColWidths]);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_TRADES_COL_WIDTHS_KEY, JSON.stringify(tradeColWidths));
    } catch {
      // ignore
    }
  }, [tradeColWidths]);

  const endResizeTradeCol = useCallback(() => {
    resizingColRef.current = null;
    window.removeEventListener("mousemove", onResizeMoveTradeCol);
    window.removeEventListener("mouseup", endResizeTradeCol);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onResizeMoveTradeCol = useCallback((e: MouseEvent) => {
    const st = resizingColRef.current;
    if (!st) return;
    const delta = e.clientX - st.startX;
    const nextW = Math.max(60, Math.min(800, st.startWidth + delta));
    setTradeColWidths((prev) => {
      if (prev[st.key] === nextW) return prev;
      return { ...prev, [st.key]: nextW };
    });
  }, []);

  const startResizeTradeCol = useCallback(
    (key: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidth = Number(tradeColWidths[key] ?? defaultTradeColWidths[key as keyof typeof defaultTradeColWidths] ?? 120);
      resizingColRef.current = { key, startX: e.clientX, startWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onResizeMoveTradeCol);
      window.addEventListener("mouseup", endResizeTradeCol);
    },
    [defaultTradeColWidths, endResizeTradeCol, onResizeMoveTradeCol, tradeColWidths],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onResizeMoveTradeCol);
      window.removeEventListener("mouseup", endResizeTradeCol);
    };
  }, [endResizeTradeCol, onResizeMoveTradeCol]);

  const normalizedResults = useMemo(() => {
    const raw = lastBacktestResults as any;
    if (!raw || typeof raw !== "object") return null;
    if (raw?.strategy && typeof raw.strategy === "object") {
      const keys = Object.keys(raw.strategy);
      if (keys.length) return raw.strategy[keys[0]];
    }
    return raw;
  }, [lastBacktestResults]);

  const allTrades = useMemo(() => {
    const r = normalizedResults as any;
    if (!r || typeof r !== "object") return [] as any[];
    return Array.isArray(r.trades) ? r.trades : [];
  }, [normalizedResults]);

  const tradePairs = useMemo(() => {
    const seen = new Set<string>();
    for (const t of allTrades) {
      const p = typeof (t as any)?.pair === "string" ? String((t as any).pair) : "";
      if (p) seen.add(p);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [allTrades]);

  const tradePairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of tradePairs) counts.set(p, 0);

    for (const t of allTrades) {
      const pair = typeof (t as any)?.pair === "string" ? String((t as any).pair) : "";
      if (!pair) continue;

      const profitAbs = toFiniteNumber((t as any)?.profit_abs);
      const profitRatio = toFiniteNumber((t as any)?.profit_ratio);
      const pnl = profitAbs != null ? profitAbs : profitRatio != null ? profitRatio : 0;

      if (tradesFilterPnL === "profit" && pnl <= 0) continue;
      if (tradesFilterPnL === "loss" && pnl >= 0) continue;

      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }

    return counts;
  }, [allTrades, tradePairs, tradesFilterPnL]);

  const filteredTrades = useMemo(() => {
    const q = tradesSearch.trim().toLowerCase();
    return allTrades.filter((t: any) => {
      const pair = typeof (t as any)?.pair === "string" ? String((t as any).pair) : "";
      if (tradesFilterPair !== "all" && pair !== tradesFilterPair) return false;

      const profitAbs = toFiniteNumber((t as any)?.profit_abs);
      const profitRatio = toFiniteNumber((t as any)?.profit_ratio);
      const pnl = profitAbs != null ? profitAbs : profitRatio != null ? profitRatio : 0;

      if (tradesFilterPnL === "profit" && pnl <= 0) return false;
      if (tradesFilterPnL === "loss" && pnl >= 0) return false;

      if (!q) return true;

      const exitReason = typeof (t as any)?.exit_reason === "string" ? String((t as any).exit_reason) : "";
      const openDate = typeof (t as any)?.open_date === "string" ? String((t as any).open_date) : "";
      const closeDate = typeof (t as any)?.close_date === "string" ? String((t as any).close_date) : "";

      return (
        pair.toLowerCase().includes(q) ||
        exitReason.toLowerCase().includes(q) ||
        openDate.toLowerCase().includes(q) ||
        closeDate.toLowerCase().includes(q)
      );
    });
  }, [allTrades, tradesFilterPair, tradesFilterPnL, tradesSearch]);

  const pagedTrades = useMemo(() => {
    const total = filteredTrades.length;
    const maxPage = Math.max(1, Math.ceil(total / tradesPageSize));
    const page = Math.min(Math.max(1, tradesPage), maxPage);
    const start = (page - 1) * tradesPageSize;
    const end = start + tradesPageSize;
    return {
      page,
      maxPage,
      total,
      rows: filteredTrades.slice(start, end),
    };
  }, [filteredTrades, tradesPage, tradesPageSize]);

  const filteredTradesTotals = useMemo(() => {
    let durationMin = 0;
    let durationCount = 0;
    let netProfitAbs = 0;
    let grossProfitAbs = 0;
    let grossLossAbs = 0;
    let wins = 0;
    let losses = 0;
    let profitPctSum = 0;
    let profitPctCount = 0;
    const pairs = new Set<string>();

    for (const t of filteredTrades) {
      const pair = typeof (t as any)?.pair === "string" ? String((t as any).pair) : "";
      if (pair) pairs.add(pair);

      const duration =
        toFiniteNumber((t as any)?.trade_duration) ??
        (() => {
          const o = dateMs((t as any)?.open_date);
          const c = dateMs((t as any)?.close_date);
          if (o == null || c == null) return null;
          const delta = c - o;
          if (!Number.isFinite(delta) || delta < 0) return null;
          return delta / (1000 * 60);
        })();

      if (duration != null) {
        durationMin += duration;
        durationCount += 1;
      }

      const pa = toFiniteNumber((t as any)?.profit_abs);
      if (pa != null) {
        netProfitAbs += pa;
        if (pa > 0) {
          grossProfitAbs += pa;
          wins += 1;
        } else if (pa < 0) {
          grossLossAbs += Math.abs(pa);
          losses += 1;
        }
      }

      const pr = toFiniteNumber((t as any)?.profit_ratio);
      if (pr != null) {
        profitPctSum += pr * 100;
        profitPctCount += 1;
      }
    }

    return {
      pairsCount: pairs.size,
      durationMin,
      durationCount,
      netProfitAbs,
      grossProfitAbs,
      grossLossAbs,
      wins,
      losses,
      profitPctAvg: profitPctCount ? profitPctSum / profitPctCount : null,
    };
  }, [filteredTrades]);

  useEffect(() => {
    setTradesPage(1);
  }, [tradesFilterPair, tradesFilterPnL, tradesSearch, lastBacktestId]);

  const resultsSummary = useMemo(() => {
    const r = normalizedResults as any;
    if (!r || typeof r !== "object") return null;

    const backtestConfig = (lastBacktest as any)?.config;
    const configTimeframe = typeof backtestConfig?.timeframe === "string" ? String(backtestConfig.timeframe) : null;
    const configTimerange = typeof backtestConfig?.timerange === "string" ? String(backtestConfig.timerange) : null;
    const configMaxOpenTrades = toFiniteNumber(backtestConfig?.max_open_trades);

    const startingBalance =
      toFiniteNumber(r.starting_balance) ??
      toFiniteNumber(r.start_balance) ??
      toFiniteNumber(r.dry_run_wallet);
    const finalBalance = toFiniteNumber(r.final_balance) ?? toFiniteNumber(r.end_balance);

    const profitAbs =
      toFiniteNumber(r.profit_total_abs) ??
      toFiniteNumber(r.profit_abs_total) ??
      (startingBalance != null && finalBalance != null ? finalBalance - startingBalance : null);

    const profitTotalRaw = toFiniteNumber(r.profit_total);
    const profitTotalPctFromRaw =
      profitTotalRaw != null
        ? Math.abs(profitTotalRaw) <= 2
          ? profitTotalRaw * 100
          : profitTotalRaw
        : null;

    const profitPct =
      toFiniteNumber(r.profit_total_pct) ??
      profitTotalPctFromRaw ??
      (startingBalance != null && profitAbs != null && startingBalance !== 0 ? (profitAbs / startingBalance) * 100 : null);

    const ddRaw = toFiniteNumber(r.max_drawdown_account) ?? toFiniteNumber(r.max_drawdown);
    const ddPct = ddRaw != null ? (Math.abs(ddRaw) <= 2 ? ddRaw * 100 : ddRaw) : null;

    const totalTrades = toFiniteNumber(r.total_trades);
    const winrateRaw = toFiniteNumber(r.winrate) ?? toFiniteNumber(r.win_rate);
    const winratePct = winrateRaw != null ? (Math.abs(winrateRaw) <= 2 ? winrateRaw * 100 : winrateRaw) : null;

    let sharpe = toFiniteNumber(r.sharpe) ?? toFiniteNumber(r.sharpe_ratio);
    let sortino = toFiniteNumber(r.sortino) ?? toFiniteNumber(r.sortino_ratio);
    const cagrRaw = toFiniteNumber(r.cagr);
    let cagrPct = cagrRaw != null ? (Math.abs(cagrRaw) <= 2 ? cagrRaw * 100 : cagrRaw) : null;

    const profitFactorStored = toFiniteNumber(r.profit_factor);
    let profitFactorDerived: number | null = null;
    if (profitFactorStored == null && Array.isArray(allTrades) && allTrades.length) {
      let grossProfit = 0;
      let grossLoss = 0;
      for (const t of allTrades) {
        const pa = toFiniteNumber((t as any)?.profit_abs);
        if (pa == null) continue;
        if (pa > 0) grossProfit += pa;
        else if (pa < 0) grossLoss += Math.abs(pa);
      }
      if (grossLoss > 0) profitFactorDerived = grossProfit / grossLoss;
    }
    const profitFactor = profitFactorStored ?? profitFactorDerived;

    const stakeCurrency =
      typeof r.stake_currency === "string"
        ? r.stake_currency
        : typeof (configData as any)?.stake_currency === "string"
          ? String((configData as any).stake_currency)
          : "";

    const derivedDates = (() => {
      if (!Array.isArray(allTrades) || allTrades.length === 0) return null;
      let minOpen: number | null = null;
      let maxClose: number | null = null;
      for (const t of allTrades) {
        const o = dateMs((t as any)?.open_date);
        const c = dateMs((t as any)?.close_date);
        if (o != null) minOpen = minOpen == null ? o : Math.min(minOpen, o);
        if (c != null) maxClose = maxClose == null ? c : Math.max(maxClose, c);
      }
      if (minOpen == null || maxClose == null) return null;
      return { minOpen, maxClose };
    })();

    const derivedBacktestDays = (() => {
      const explicit = toFiniteNumber(r.backtest_days);
      if (explicit != null) return explicit;
      if (!derivedDates) return null;
      const spanDays = (derivedDates.maxClose - derivedDates.minOpen) / (1000 * 60 * 60 * 24);
      if (!Number.isFinite(spanDays) || spanDays <= 0) return null;
      return spanDays;
    })();

    const derivedTradesPerDay = (() => {
      const explicit = toFiniteNumber(r.trades_per_day);
      if (explicit != null) return explicit;
      const td = totalTrades != null ? totalTrades : Array.isArray(allTrades) ? allTrades.length : 0;
      if (!derivedBacktestDays || derivedBacktestDays <= 0) return null;
      return td / derivedBacktestDays;
    })();

    const derivedStartEnd = (() => {
      const start = typeof r.backtest_start === "string" ? r.backtest_start : null;
      const end = typeof r.backtest_end === "string" ? r.backtest_end : null;
      if (start && end) return { start, end };
      if (!derivedDates) return { start, end };
      const ds = new Date(derivedDates.minOpen).toISOString().slice(0, 10);
      const de = new Date(derivedDates.maxClose).toISOString().slice(0, 10);
      return { start: start ?? ds, end: end ?? de };
    })();

    if ((sharpe == null || sortino == null || cagrPct == null) && startingBalance != null && startingBalance > 0 && derivedDates) {
      const dayPnl = new Map<string, number>();
      for (const t of allTrades) {
        const close = dateMs((t as any)?.close_date);
        const pa = toFiniteNumber((t as any)?.profit_abs);
        if (close == null || pa == null) continue;
        const day = new Date(close).toISOString().slice(0, 10);
        dayPnl.set(day, (dayPnl.get(day) ?? 0) + pa);
      }
      const days = Array.from(dayPnl.keys()).sort((a, b) => a.localeCompare(b));
      if (days.length >= 2) {
        let equity = startingBalance;
        const rets: number[] = [];
        const negRets: number[] = [];
        for (const d of days) {
          const pnl = dayPnl.get(d) ?? 0;
          if (equity > 0) {
            const r1 = pnl / equity;
            rets.push(r1);
            if (r1 < 0) negRets.push(r1);
          }
          equity += pnl;
        }

        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
        const std = (xs: number[]) => {
          if (xs.length < 2) return 0;
          const m = mean(xs);
          const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
          return Math.sqrt(v);
        };
        const rf = 0;
        const dailyMean = mean(rets);
        const dailyStd = std(rets);
        const dailyNegStd = std(negRets);

        if (sharpe == null && dailyStd > 0) {
          sharpe = ((dailyMean - rf) / dailyStd) * Math.sqrt(365);
        }
        if (sortino == null && dailyNegStd > 0) {
          sortino = ((dailyMean - rf) / dailyNegStd) * Math.sqrt(365);
        }

        if (cagrPct == null) {
          const spanDays = Math.max(1, (derivedDates.maxClose - derivedDates.minOpen) / (1000 * 60 * 60 * 24));
          const endEquity = equity;
          if (endEquity > 0 && spanDays > 0) {
            const cagr = Math.pow(endEquity / startingBalance, 365 / spanDays) - 1;
            if (Number.isFinite(cagr)) cagrPct = cagr * 100;
          }
        }
      }
    }

    return {
      startingBalance,
      finalBalance,
      profitAbs,
      profitPct,
      ddPct,
      totalTrades,
      winratePct,
      sharpe,
      sortino,
      cagrPct,
      profitFactor,
      stakeCurrency,
      timeframe: typeof r.timeframe === "string" ? r.timeframe : configTimeframe,
      timerange: typeof r.timerange === "string" ? r.timerange : configTimerange,
      backtestStart: derivedStartEnd.start,
      backtestEnd: derivedStartEnd.end,
      backtestDays: derivedBacktestDays,
      tradesPerDay: derivedTradesPerDay,
      maxOpenTrades: toFiniteNumber(r.max_open_trades) ?? configMaxOpenTrades,
      bestPair: r.best_pair && typeof r.best_pair === "object" ? r.best_pair : null,
      worstPair: r.worst_pair && typeof r.worst_pair === "object" ? r.worst_pair : null,
      perPair: Array.isArray(r.results_per_pair) ? r.results_per_pair : [],
    };
  }, [allTrades, configData, lastBacktest, normalizedResults]);

  const topPairs = useMemo(() => {
    const perPair = (resultsSummary?.perPair ?? []) as any[];
    const withTrades = perPair.filter((p) => (toFiniteNumber(p?.trades) ?? 0) > 0);
    return withTrades
      .slice()
      .sort((a, b) => (toFiniteNumber(b?.profit_total_abs) ?? 0) - (toFiniteNumber(a?.profit_total_abs) ?? 0))
      .slice(0, 6);
  }, [resultsSummary?.perPair]);

  const worstPairs = useMemo(() => {
    const perPair = (resultsSummary?.perPair ?? []) as any[];
    const withTrades = perPair.filter((p) => (toFiniteNumber(p?.trades) ?? 0) > 0);
    return withTrades
      .slice()
      .sort((a, b) => (toFiniteNumber(a?.profit_total_abs) ?? 0) - (toFiniteNumber(b?.profit_total_abs) ?? 0))
      .slice(0, 6);
  }, [resultsSummary?.perPair]);

  useEffect(() => {
    if (!lastBacktestId) return;
    if (resultsShownForBacktestId === lastBacktestId) return;

    const status = String((lastBacktest as any)?.status || "");
    if (status !== "completed") return;
    if (!lastBacktestResults) return;

    setResultsShownForBacktestId(lastBacktestId);
    setCenterMode((prev) => (prev === "diff" ? prev : "results"));
  }, [lastBacktest, lastBacktestId, lastBacktestResults, resultsShownForBacktestId]);

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

                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-2",
                    centerMode === "results" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                  onClick={() => setCenterMode("results")}
                  disabled={!lastBacktest}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Results
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
              ) : centerMode === "results" ? (
                lastBacktest ? (
                  <div className="h-full rounded-md border border-white/10 bg-black/20 overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-white/10 bg-black/30">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wider text-slate-400">Backtest</div>
                          <div className="text-xs text-slate-200 truncate">#{String((lastBacktest as any)?.id ?? lastBacktestId ?? "-")}</div>
                        </div>
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

                      {resultsSummary ? (
                        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
                          {(() => {
                            const positive = (resultsSummary.profitAbs ?? 0) >= 0;
                            return (
                              <div className={cn(
                                "rounded-xl border bg-gradient-to-br px-3 py-2",
                                positive
                                  ? "border-emerald-500/20 from-emerald-500/15 via-black/30 to-purple-500/10"
                                  : "border-red-500/20 from-red-500/15 via-black/30 to-purple-500/10",
                              )}>
                                <div className="text-[10px] uppercase tracking-wider text-slate-400">Profit</div>
                                <div className={cn("mt-0.5 text-sm font-bold", positive ? "text-emerald-200" : "text-red-200")}>
                                  {fmtPct(resultsSummary.profitPct)}
                                </div>
                                <div className="text-[11px] text-slate-300">
                                  {fmtMoney(resultsSummary.profitAbs)} {resultsSummary.stakeCurrency}
                                </div>
                              </div>
                            );
                          })()}

                          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-red-500/10 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">Balance</div>
                            <div className="mt-0.5 text-sm font-bold text-slate-100">
                              {fmtMoney(resultsSummary.startingBalance)} → {fmtMoney(resultsSummary.finalBalance)} {resultsSummary.stakeCurrency}
                            </div>
                            <div className="text-[11px] text-slate-300">Start → Final</div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">Risk</div>
                            <div className="mt-0.5 text-sm font-bold text-slate-100">DD {fmtPct(resultsSummary.ddPct)}</div>
                            <div className="text-[11px] text-slate-300">Max drawdown</div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">Trades</div>
                            <div className="mt-0.5 text-sm font-bold text-slate-100">
                              {resultsSummary.totalTrades != null ? String(Math.round(resultsSummary.totalTrades)) : "-"}
                            </div>
                            <div className="text-[11px] text-slate-300">
                              {resultsSummary.winratePct != null ? `Win ${fmtPct(resultsSummary.winratePct, 1)}` : "Win -"}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-slate-400">No results yet.</div>
                      )}
                    </div>

                    <div className="flex-1 min-h-0">
                      <ScrollArea className="h-full">
                        <div className="p-3 space-y-3">
                          {resultsSummary ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400">Quality</div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-200">
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Sharpe</div>
                                    <div className="font-semibold">{resultsSummary.sharpe != null ? resultsSummary.sharpe.toFixed(2) : "-"}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Sortino</div>
                                    <div className="font-semibold">{resultsSummary.sortino != null ? resultsSummary.sortino.toFixed(2) : "-"}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">CAGR</div>
                                    <div className="font-semibold">{fmtPct(resultsSummary.cagrPct)}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Profit Factor</div>
                                    <div className="font-semibold">{resultsSummary.profitFactor != null ? resultsSummary.profitFactor.toFixed(2) : "-"}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400">Config</div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-200">
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Timeframe</div>
                                    <div className="font-semibold">{resultsSummary.timeframe ?? "-"}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Timerange</div>
                                    <div className="font-semibold truncate">{resultsSummary.timerange ?? "-"}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Max Open Trades</div>
                                    <div className="font-semibold">{resultsSummary.maxOpenTrades != null ? String(Math.round(resultsSummary.maxOpenTrades)) : "-"}</div>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                                    <div className="text-[10px] text-slate-400">Period</div>
                                    <div className="font-semibold">{resultsSummary.backtestDays != null ? `${Math.round(resultsSummary.backtestDays)}d` : "-"}</div>
                                    <div className="text-[10px] text-slate-400">{resultsSummary.tradesPerDay != null ? `${resultsSummary.tradesPerDay.toFixed(2)} trades/day` : ""}</div>
                                  </div>
                                </div>
                                <div className="mt-2 text-[10px] text-slate-400">
                                  {resultsSummary.backtestStart && resultsSummary.backtestEnd
                                    ? `${resultsSummary.backtestStart} → ${resultsSummary.backtestEnd}`
                                    : null}
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-300">
                                <span>
                                  Duration Σ {fmtDurationMinutes(filteredTradesTotals.durationMin)}
                                </span>
                                <span className="text-slate-500">|</span>
                                <span className={cn("font-semibold", filteredTradesTotals.netProfitAbs >= 0 ? "text-emerald-200" : "text-red-200")}>
                                  Net {fmtMoney(filteredTradesTotals.netProfitAbs)} {resultsSummary?.stakeCurrency ?? ""}
                                </span>
                                <span className="text-slate-500">|</span>
                                <span className="text-emerald-200">
                                  Profit {fmtMoney(filteredTradesTotals.grossProfitAbs)}
                                </span>
                                <span className="text-slate-500">|</span>
                                <span className="text-red-200">
                                  Loss {fmtMoney(filteredTradesTotals.grossLossAbs)}
                                </span>
                                <span className="text-slate-500">|</span>
                                <span>
                                  W/L {filteredTradesTotals.wins}/{filteredTradesTotals.losses}
                                </span>
                                {filteredTradesTotals.profitPctAvg != null ? (
                                  <>
                                    <span className="text-slate-500">|</span>
                                    <span>Avg {fmtPct(filteredTradesTotals.profitPctAvg)}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {resultsSummary?.bestPair || resultsSummary?.worstPair ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              {resultsSummary?.bestPair ? (
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-emerald-200">Best Pair</div>
                                  <div className="mt-1 text-sm font-bold text-slate-100">{String((resultsSummary.bestPair as any)?.key ?? "-")}</div>
                                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-200">
                                    <div>
                                      <div className="text-[10px] text-slate-400">Trades</div>
                                      <div className="font-semibold">{String((resultsSummary.bestPair as any)?.trades ?? "-")}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] text-slate-400">Profit</div>
                                      <div className="font-semibold">{fmtMoney(toFiniteNumber((resultsSummary.bestPair as any)?.profit_total_abs))}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] text-slate-400">Winrate</div>
                                      <div className="font-semibold">{fmtPct(toFiniteNumber((resultsSummary.bestPair as any)?.winrate) != null ? (toFiniteNumber((resultsSummary.bestPair as any)?.winrate) as number) * 100 : null, 1)}</div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              {resultsSummary?.worstPair ? (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                                  <div className="text-[10px] uppercase tracking-wider text-red-200">Worst Pair</div>
                                  <div className="mt-1 text-sm font-bold text-slate-100">{String((resultsSummary.worstPair as any)?.key ?? "-")}</div>
                                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-200">
                                    <div>
                                      <div className="text-[10px] text-slate-400">Trades</div>
                                      <div className="font-semibold">{String((resultsSummary.worstPair as any)?.trades ?? "-")}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] text-slate-400">Profit</div>
                                      <div className="font-semibold">{fmtMoney(toFiniteNumber((resultsSummary.worstPair as any)?.profit_total_abs))}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] text-slate-400">Winrate</div>
                                      <div className="font-semibold">{fmtPct(toFiniteNumber((resultsSummary.worstPair as any)?.winrate) != null ? (toFiniteNumber((resultsSummary.worstPair as any)?.winrate) as number) * 100 : null, 1)}</div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {topPairs.length || worstPairs.length ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                              <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                                <div className="px-3 py-2 border-b border-white/10 bg-black/20">
                                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Top Pairs</div>
                                </div>
                                <div className="p-3">
                                  {topPairs.length ? (
                                    <div className="space-y-2">
                                      {topPairs.map((p) => {
                                        const profitAbs = toFiniteNumber((p as any)?.profit_total_abs);
                                        const profitPct = toFiniteNumber((p as any)?.profit_total_pct);
                                        const positive = (profitAbs ?? 0) >= 0;
                                        return (
                                          <div key={String((p as any)?.key)} className="flex items-center justify-between gap-3 text-xs">
                                            <div className="min-w-0">
                                              <div className="font-semibold text-slate-100 truncate">{String((p as any)?.key ?? "-")}</div>
                                              <div className="text-[10px] text-slate-400">Trades {String((p as any)?.trades ?? "-")}</div>
                                            </div>
                                            <div className={cn("text-right font-semibold", positive ? "text-emerald-200" : "text-red-200")}>
                                              <div>{profitPct != null ? fmtPct(profitPct) : "-"}</div>
                                              <div className="text-[10px]">{fmtMoney(profitAbs)} {resultsSummary?.stakeCurrency ?? ""}</div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-400">No per-pair results.</div>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                                <div className="px-3 py-2 border-b border-white/10 bg-black/20">
                                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Worst Pairs</div>
                                </div>
                                <div className="p-3">
                                  {worstPairs.length ? (
                                    <div className="space-y-2">
                                      {worstPairs.map((p) => {
                                        const profitAbs = toFiniteNumber((p as any)?.profit_total_abs);
                                        const profitPct = toFiniteNumber((p as any)?.profit_total_pct);
                                        const positive = (profitAbs ?? 0) >= 0;
                                        return (
                                          <div key={String((p as any)?.key)} className="flex items-center justify-between gap-3 text-xs">
                                            <div className="min-w-0">
                                              <div className="font-semibold text-slate-100 truncate">{String((p as any)?.key ?? "-")}</div>
                                              <div className="text-[10px] text-slate-400">Trades {String((p as any)?.trades ?? "-")}</div>
                                            </div>
                                            <div className={cn("text-right font-semibold", positive ? "text-emerald-200" : "text-red-200")}>
                                              <div>{profitPct != null ? fmtPct(profitPct) : "-"}</div>
                                              <div className="text-[10px]">{fmtMoney(profitAbs)} {resultsSummary?.stakeCurrency ?? ""}</div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-400">No per-pair results.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                            <div className="px-3 py-2 border-b border-white/10 bg-black/20">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[10px] uppercase tracking-wider text-slate-400">Trades</div>
                                <div className="text-[10px] text-slate-400">
                                  {pagedTrades.total} trades
                                  {allTrades.length !== pagedTrades.total ? ` of ${allTrades.length}` : ""}
                                  {filteredTradesTotals.pairsCount ? ` • ${filteredTradesTotals.pairsCount} pairs` : ""}
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-1 lg:grid-cols-4 gap-2">
                                <Input
                                  value={tradesSearch}
                                  onChange={(e) => setTradesSearch(e.target.value)}
                                  placeholder="Search pair / reason / date"
                                  className="h-8 text-xs"
                                />

                                <select
                                  value={tradesFilterPair}
                                  onChange={(e) => setTradesFilterPair(e.target.value)}
                                  className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                                >
                                  <option value="all">All pairs</option>
                                  {tradePairs.map((p) => (
                                    <option key={p} value={p}>
                                      {p} ({tradePairCounts.get(p) ?? 0})
                                    </option>
                                  ))}
                                </select>

                                <select
                                  value={tradesFilterPnL}
                                  onChange={(e) => setTradesFilterPnL(e.target.value as any)}
                                  className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                                >
                                  <option value="all">All trades</option>
                                  <option value="profit">Profit only</option>
                                  <option value="loss">Loss only</option>
                                </select>

                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => setTradesPage((p) => Math.max(1, p - 1))}
                                    disabled={pagedTrades.page <= 1}
                                  >
                                    Prev
                                  </Button>
                                  <div className="text-xs text-slate-300">
                                    {pagedTrades.page}/{pagedTrades.maxPage}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => setTradesPage((p) => Math.min(pagedTrades.maxPage, p + 1))}
                                    disabled={pagedTrades.page >= pagedTrades.maxPage}
                                  >
                                    Next
                                  </Button>
                                </div>
                              </div>
                            </div>

                            <div className="p-3">
                              {pagedTrades.rows.length ? (
                                <div className="overflow-auto rounded-md border border-white/10">
                                  <table className="w-full text-xs table-fixed">
                                    <colgroup>
                                      <col style={{ width: tradeColWidths.pair }} />
                                      <col style={{ width: tradeColWidths.open }} />
                                      <col style={{ width: tradeColWidths.close }} />
                                      <col style={{ width: tradeColWidths.duration }} />
                                      <col style={{ width: tradeColWidths.profitPct }} />
                                      <col style={{ width: tradeColWidths.profitAbs }} />
                                      <col style={{ width: tradeColWidths.exit }} />
                                    </colgroup>
                                    <thead className="bg-black/30 text-[10px] uppercase tracking-wider text-slate-400">
                                      <tr>
                                        <th className="px-2 py-2 text-left relative">
                                          <div className="pr-2">Pair</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("pair")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-left relative">
                                          <div className="pr-2">Open</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("open")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-left relative">
                                          <div className="pr-2">Close</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("close")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-left relative">
                                          <div className="pr-2">Duration</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("duration")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-right relative">
                                          <div className="pr-2">Profit %</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("profitPct")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-right relative">
                                          <div className="pr-2">Profit</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("profitAbs")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                        <th className="px-2 py-2 text-left relative">
                                          <div className="pr-2">Exit</div>
                                          <div
                                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                                            onMouseDown={startResizeTradeCol("exit")}
                                            title="Drag to resize"
                                          />
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/10">
                                      {pagedTrades.rows.map((t: any, idx: number) => {
                                        const pair = typeof (t as any)?.pair === "string" ? String((t as any).pair) : "-";
                                        const openDate = fmtDateTime((t as any)?.open_date);
                                        const closeDate = fmtDateTime((t as any)?.close_date);
                                        const durationMin =
                                          toFiniteNumber((t as any)?.trade_duration) ??
                                          (() => {
                                            const o = dateMs((t as any)?.open_date);
                                            const c = dateMs((t as any)?.close_date);
                                            if (o == null || c == null) return null;
                                            const delta = c - o;
                                            if (!Number.isFinite(delta) || delta < 0) return null;
                                            return delta / (1000 * 60);
                                          })();
                                        const profitAbs = toFiniteNumber((t as any)?.profit_abs);
                                        const profitPct = toFiniteNumber((t as any)?.profit_ratio) != null ? (toFiniteNumber((t as any)?.profit_ratio) as number) * 100 : null;
                                        const positive = (profitAbs ?? (profitPct ?? 0)) > 0;
                                        const exitReason = typeof (t as any)?.exit_reason === "string" ? String((t as any).exit_reason) : "-";

                                        return (
                                          <tr key={String((t as any)?.open_timestamp ?? idx)} className={cn("hover:bg-white/5", idx % 2 === 0 ? "bg-black/10" : "bg-black/0")}>
                                            <td className="px-2 py-2 font-semibold text-slate-100 whitespace-nowrap">{pair}</td>
                                            <td className="px-2 py-2 text-slate-200 whitespace-nowrap">{openDate}</td>
                                            <td className="px-2 py-2 text-slate-200 whitespace-nowrap">{closeDate}</td>
                                            <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{fmtDurationMinutes(durationMin)}</td>
                                            <td className={cn("px-2 py-2 text-right font-semibold whitespace-nowrap", positive ? "text-emerald-200" : "text-red-200")}>
                                              {profitPct != null ? fmtPct(profitPct) : "-"}
                                            </td>
                                            <td className={cn("px-2 py-2 text-right font-semibold whitespace-nowrap", positive ? "text-emerald-200" : "text-red-200")}>
                                              {fmtMoney(profitAbs)} {resultsSummary?.stakeCurrency ?? ""}
                                            </td>
                                            <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{exitReason}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="text-xs text-slate-400">No trades match your filters.</div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                            <div className="px-3 py-2 border-b border-white/10 bg-black/20 flex items-center justify-between">
                              <div className="text-[10px] uppercase tracking-wider text-slate-400">Advanced</div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[10px]"
                                onClick={() => setResultsAdvancedOpen((v) => !v)}
                              >
                                {resultsAdvancedOpen ? "Hide JSON" : "Show JSON"}
                              </Button>
                            </div>
                            {resultsAdvancedOpen ? (
                              <pre className="p-3 text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
                                {JSON.stringify(lastBacktestResults ?? lastBacktest, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                ) : (
                  <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
                    Run a backtest to view results.
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
                      profit_total: toPctMaybe((lastBacktestResults as any).profit_total) ?? 0,
                      win_rate: toPctMaybe((lastBacktestResults as any).win_rate) ?? 0,
                      max_drawdown: toPctMaybe((lastBacktestResults as any).max_drawdown) ?? 0,
                      total_trades: Number((lastBacktestResults as any).total_trades ?? 0),
                      avg_profit: toPctMaybe((lastBacktestResults as any).avg_profit) ?? undefined,
                      sharpe: typeof (lastBacktestResults as any)?.sharpe === "number" ? (lastBacktestResults as any).sharpe : undefined,
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
