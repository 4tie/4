import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBacktest, useBacktests } from "./use-backtests";
import { useGetConfig } from "./use-config";
import { api } from "@shared/routes";
import { useQueryClient } from "@tanstack/react-query";
import {
  WORKSPACE_TRADES_COL_WIDTHS_KEY,
  toFiniteNumber,
  toPctMaybe,
  dateMs,
} from "@/lib/workspaceUtils";
import { reportErrorOnce } from "@/lib/reportError";
import type { DiffState } from "@/lib/workspaceUtils";

export type TradesPageSize = 10 | 20 | 50 | 100 | "all";
export type TradesViewTab = "trades" | "per-pair";
export type PerPairSortKey = "pair" | "trades" | "winRate" | "profitPct" | "profit" | "avgProfit";

export function useTradeResults(activeFilePath: string, activeFileId: number | null, isDirty: boolean, activeFile: unknown) {
  const queryClient = useQueryClient();
  const { data: configData } = useGetConfig();
  
  const [lastBacktestId, setLastBacktestId] = useState<number | null>(null);
  const { data: lastBacktest, isLoading: isBacktestLoading } = useBacktest(lastBacktestId);
  const backtestsQuery = useBacktests();

  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [centerMode, setCenterMode] = useState<"code" | "diff" | "results" | "diagnostics">("code");
  const [resultsShownForBacktestId, setResultsShownForBacktestId] = useState<number | null>(null);
  const [resultsAdvancedOpen, setResultsAdvancedOpen] = useState(false);
  const [tradesFilterPair, setTradesFilterPair] = useState<string>("all");
  const [tradesFilterPnL, setTradesFilterPnL] = useState<"all" | "profit" | "loss">("all");
  const [tradesSearch, setTradesSearch] = useState<string>("");
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesPageSize, setTradesPageSize] = useState<TradesPageSize>(50);
  const [tradesViewTab, setTradesViewTab] = useState<TradesViewTab>("trades");
  const [perPairSort, setPerPairSort] = useState<{ key: PerPairSortKey; dir: "asc" | "desc" }>({ key: "profit", dir: "desc" });

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

  // Load column widths
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_TRADES_COL_WIDTHS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const next: Record<string, number> = { ...defaultTradeColWidths };
      for (const [k, v] of Object.entries(parsed as any)) {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        if (n != null && n >= 60 && n <= 800) next[k] = n;
      }
      setTradeColWidths(next);
    } catch (e) {
      reportErrorOnce("workspace:tradesColWidths:load", "Failed to load trades table column widths", e, { showToast: true });
    }
  }, [defaultTradeColWidths]);

  // Save column widths
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_TRADES_COL_WIDTHS_KEY, JSON.stringify(tradeColWidths));
    } catch (e) {
      reportErrorOnce("workspace:tradesColWidths:save", "Failed to save trades table column widths", e, { showToast: true });
    }
  }, [tradeColWidths]);

  useEffect(() => {
    setTradesPage((p) => (p === 1 ? p : 1));
  }, [tradesPageSize]);

  useEffect(() => {
    setTradesPage(1);
  }, [tradesFilterPair, tradesFilterPnL, tradesSearch, lastBacktestId]);

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

  // Latest backtest for active strategy
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
    if (latestBacktestIdForActiveStrategy === undefined) return;
    if (latestBacktestIdForActiveStrategy == null) {
      if (lastBacktestId != null) setLastBacktestId(null);
      return;
    }
    if (lastBacktestId === latestBacktestIdForActiveStrategy) return;
    setLastBacktestId(latestBacktestIdForActiveStrategy);
    setResultsAdvancedOpen(false);
  }, [activeFilePath, lastBacktestId, latestBacktestIdForActiveStrategy]);

  const lastBacktestResults = (lastBacktest as any)?.results;

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
    if (tradesPageSize === "all") {
      return { page: 1, maxPage: 1, total, rows: filteredTrades };
    }

    const pageSize = tradesPageSize;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, tradesPage), maxPage);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return { page, maxPage, total, rows: filteredTrades.slice(start, end) };
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

  // Results summary calculation
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

  // Auto-switch to results when backtest completes
  useEffect(() => {
    if (!lastBacktestId) return;
    if (resultsShownForBacktestId === lastBacktestId) return;

    const status = String((lastBacktest as any)?.status || "");
    const hasResults = Boolean(lastBacktestResults);
    
    // Switch on completed with results, or on running (to show progress)
    if (status === "completed" && hasResults) {
      setResultsShownForBacktestId(lastBacktestId);
      setCenterMode((prev) => (prev === "diff" ? prev : "results"));
    }
  }, [lastBacktest, lastBacktestId, lastBacktestResults, resultsShownForBacktestId]);

  // Reset resultsShownForBacktestId when lastBacktestId changes to a new value
  useEffect(() => {
    if (lastBacktestId && lastBacktestId !== resultsShownForBacktestId) {
      // Allow auto-switch for this new backtest
      setResultsShownForBacktestId(null);
    }
  }, [lastBacktestId]);

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

      return data;
    },
    [activeFile, activeFileId, activeFilePath, isDirty, queryClient],
  );

  return {
    lastBacktest,
    lastBacktestId,
    setLastBacktestId,
    diffState,
    setDiffState,
    centerMode,
    setCenterMode,
    resultsAdvancedOpen,
    setResultsAdvancedOpen,
    tradesFilterPair,
    setTradesFilterPair,
    tradesFilterPnL,
    setTradesFilterPnL,
    tradesSearch,
    setTradesSearch,
    tradesPage,
    setTradesPage,
    tradesPageSize,
    setTradesPageSize,
    tradesViewTab,
    setTradesViewTab,
    perPairSort,
    setPerPairSort,
    tradeColWidths,
    startResizeTradeCol,
    allTrades,
    tradePairs,
    tradePairCounts,
    filteredTrades,
    pagedTrades,
    filteredTradesTotals,
    resultsSummary,
    topPairs,
    worstPairs,
    onPreviewValidatedEdit,
    normalizedResults,
    isBacktestLoading,
  };
}
