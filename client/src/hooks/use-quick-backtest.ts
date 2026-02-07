import { useCallback, useEffect, useState } from "react";
import { useGetConfig } from "./use-config";
import { useDownloadData } from "./use-download-data";
import { useRunBacktest } from "./use-backtests";
import { Timeframes, type Timeframe } from "@shared/schema";
import { reportErrorOnce } from "@/lib/reportError";
import {
  WORKSPACE_QUICK_BACKTEST_KEY,
  timerangeLastDaysUtc,
  timerangeYtdUtc,
} from "@/lib/workspaceUtils";

export function useQuickBacktest() {
  const { data: configData } = useGetConfig();
  const [quickConfigTouched, setQuickConfigTouched] = useState(false);
  const [quickConfigLoaded, setQuickConfigLoaded] = useState(false);
  const [quickTimeframe, setQuickTimeframe] = useState<Timeframe>("5m");
  const [quickTimerangePreset, setQuickTimerangePreset] = useState<string>("30d");
  const [quickTimerange, setQuickTimerange] = useState<string>(() => timerangeLastDaysUtc(30));
  const [quickSelectedPairs, setQuickSelectedPairs] = useState<string[]>([]);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [pairsQuery, setPairsQuery] = useState("");
  const [quickStake, setQuickStake] = useState<number>(0);
  const [quickMaxOpenTrades, setQuickMaxOpenTrades] = useState<number>(1);
  const [maxTradesMode, setMaxTradesMode] = useState<"preset" | "custom">("preset");
  const [maxTradesUserSet, setMaxTradesUserSet] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<{ status: 'idle' | 'downloading' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const [downloadLog, setDownloadLog] = useState<string[]>([]);

  const downloadData = useDownloadData();
  const runBacktest = useRunBacktest();

  // Load from localStorage
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
      reportErrorOnce("workspace:quickBacktest:load", "Failed to load workspace quick backtest settings", new Error("localStorage read/parse failed"), { showToast: true });
    } finally {
      setQuickConfigLoaded(true);
    }
  }, []);

  // Initialize from config
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

  // Save to localStorage
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
      reportErrorOnce("workspace:quickBacktest:save", "Failed to save workspace quick backtest settings", new Error("localStorage write failed"), { showToast: true });
    }
  }, [maxTradesMode, maxTradesUserSet, quickConfigLoaded, quickMaxOpenTrades, quickSelectedPairs, quickStake, quickTimeframe, quickTimerange, quickTimerangePreset]);

  // Auto-update max trades based on selected pairs
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

  const toggleQuickPair = (pair: string) => {
    setQuickSelectedPairs((prev) => {
      const curr = Array.isArray(prev) ? [...prev] : [];
      const idx = curr.indexOf(pair);
      if (idx >= 0) curr.splice(idx, 1);
      else curr.push(pair);
      return curr;
    });
  };

  const selectAllQuickPairs = (availablePairs: string[]) => setQuickSelectedPairs([...availablePairs]);
  const clearQuickPairs = () => setQuickSelectedPairs([]);

  const handleTimerangePresetChange = (preset: string) => {
    setQuickConfigTouched(true);
    setQuickTimerangePreset(preset);
    if (preset === "30d") setQuickTimerange(timerangeLastDaysUtc(30));
    else if (preset === "60d") setQuickTimerange(timerangeLastDaysUtc(60));
    else if (preset === "90d") setQuickTimerange(timerangeLastDaysUtc(90));
    else if (preset === "180d") setQuickTimerange(timerangeLastDaysUtc(180));
    else if (preset === "365d") setQuickTimerange(timerangeLastDaysUtc(365));
    else if (preset === "ytd") setQuickTimerange(timerangeYtdUtc());
  };

  const appendDownloadLog = useCallback((line: string) => {
    const msg = String(line || "").trim();
    if (!msg) return;
    setDownloadLog((prev) => {
      const next = Array.isArray(prev) ? [...prev, msg] : [msg];
      return next.slice(-200);
    });
  }, []);

  const todayYyyymmddUtc = useCallback(() => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }, []);

  const syncTimerangeToTodayIfPreset = useCallback(() => {
    if (quickTimerangePreset === "custom") return;

    if (quickTimerangePreset === "30d") setQuickTimerange(timerangeLastDaysUtc(30));
    else if (quickTimerangePreset === "60d") setQuickTimerange(timerangeLastDaysUtc(60));
    else if (quickTimerangePreset === "90d") setQuickTimerange(timerangeLastDaysUtc(90));
    else if (quickTimerangePreset === "180d") setQuickTimerange(timerangeLastDaysUtc(180));
    else if (quickTimerangePreset === "365d") setQuickTimerange(timerangeLastDaysUtc(365));
    else if (quickTimerangePreset === "ytd") setQuickTimerange(timerangeYtdUtc());
    else {
      // If preset is unknown, at least keep the end date aligned with today for valid timeranges.
      const m = quickTimerange.match(/^(\d{8})-(\d{8})$/);
      if (!m) return;
      const start = m[1];
      const end = todayYyyymmddUtc();
      if (m[2] === end) return;
      setQuickTimerange(`${start}-${end}`);
    }
  }, [quickTimerange, quickTimerangePreset, todayYyyymmddUtc]);

  // Keep preset-based ranges aligned to today's date (UTC). Runs on mount/preset change and then again at next UTC midnight.
  useEffect(() => {
    syncTimerangeToTodayIfPreset();
    if (quickTimerangePreset === "custom") return;

    const now = new Date();
    const msUntilNextUtcMidnight =
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0) - now.getTime();
    if (!Number.isFinite(msUntilNextUtcMidnight) || msUntilNextUtcMidnight <= 0) return;

    const t = window.setTimeout(() => {
      syncTimerangeToTodayIfPreset();
    }, msUntilNextUtcMidnight + 250);
    return () => window.clearTimeout(t);
  }, [quickTimerangePreset, syncTimerangeToTodayIfPreset]);

  const handleDownloadData = useCallback(async () => {
    if (!quickSelectedPairs.length) {
      reportErrorOnce("download-data", "No pairs selected", null, { showToast: true });
      return;
    }
    if (!quickTimeframe) {
      reportErrorOnce("download-data", "No timeframe selected", null, { showToast: true });
      return;
    }

    const timerangeMatch = quickTimerange.match(/^(\d{8})-(\d{8})$/);
    const dateFrom = timerangeMatch
      ? `${timerangeMatch[1].slice(0, 4)}-${timerangeMatch[1].slice(4, 6)}-${timerangeMatch[1].slice(6, 8)}`
      : undefined;
    const dateTo = timerangeMatch
      ? `${timerangeMatch[2].slice(0, 4)}-${timerangeMatch[2].slice(4, 6)}-${timerangeMatch[2].slice(6, 8)}`
      : undefined;

    try {
      setDownloadStatus({ status: 'downloading', message: `Downloading ${quickSelectedPairs.length} pairs...` });
      appendDownloadLog(`Starting download: ${quickSelectedPairs.length} pairs, tf=${quickTimeframe}, range=${quickTimerange || "(none)"}`);
      
      const result = await downloadData.mutateAsync({
        pairs: quickSelectedPairs,
        timeframes: [quickTimeframe],
        date_from: dateFrom,
        date_to: dateTo,
      });

      if (result.success) {
        const missingCount = result.missing?.length ?? 0;
        if (missingCount > 0) {
          setDownloadStatus({ status: 'success', message: `Downloaded with ${missingCount} pairs missing` });
          const missingList = (result.missing ?? [])
            .map((x: any) => {
              if (typeof x === "string") return x;
              if (x && typeof x === "object") {
                const pair = typeof x.pair === "string" ? x.pair : typeof x.symbol === "string" ? x.symbol : "";
                const tf = typeof x.timeframe === "string" ? x.timeframe : "";
                if (pair && tf) return `${pair} (${tf})`;
                if (pair) return pair;
                try {
                  return JSON.stringify(x);
                } catch {
                  return String(x);
                }
              }
              return String(x);
            })
            .filter((s: string) => String(s || "").trim().length > 0);
          appendDownloadLog(`Download complete (missing ${missingCount}): ${missingList.join(", ")}`);
        } else {
          setDownloadStatus({ status: 'success', message: 'Download complete' });
          appendDownloadLog("Download complete");
        }
        setTimeout(() => setDownloadStatus({ status: 'idle' }), 5000);
      } else {
        setDownloadStatus({ status: 'error', message: 'Download failed' });
        appendDownloadLog("Download failed");
      }
    } catch (err) {
      setDownloadStatus({ status: 'error', message: String(err) });
      appendDownloadLog(`Download error: ${String(err)}`);
    }
  }, [appendDownloadLog, downloadData, quickSelectedPairs, quickTimeframe, quickTimerange]);

  const handleRunQuickBacktest = async (activeFilePath: string, isStrategyFile: boolean) => {
    try {
      if (!isStrategyFile || !activeFilePath) {
        throw new Error("Open a strategy file first.");
      }

      const pairs = Array.isArray(quickSelectedPairs) ? quickSelectedPairs.map((p) => String(p)).filter(Boolean) : [];
      if (!pairs.length) {
        throw new Error("No pairs selected. Add exchange.pair_whitelist (or pairlists[0].pair_whitelist) in config and select pairs.");
      }

      const stake = Number(quickStake);
      if (!Number.isFinite(stake) || stake <= 0) {
        throw new Error("Stake amount must be a positive number.");
      }

      const config: any = {
        timeframe: quickTimeframe,
        stake_amount: stake,
        max_open_trades: Number(quickMaxOpenTrades),
        pairs: pairs.length ? pairs : undefined,
      };

      if (quickTimerange.trim()) {
        config.timerange = quickTimerange.trim();
      }

      appendDownloadLog(
        `Starting backtest: tf=${quickTimeframe}, pairs=${pairs.length}, stake=${stake}, max_open_trades=${Number(quickMaxOpenTrades)}, timerange=${config.timerange ?? "(none)"}`,
      );

      const data = await runBacktest.mutateAsync({
        strategyName: activeFilePath,
        config,
      } as any);

      const id = Number((data as any)?.id);
      const nextId = Number.isFinite(id) ? id : null;
      appendDownloadLog(`Backtest started${nextId != null ? ` (#${nextId})` : ""}`);
      return nextId;
    } catch (err) {
      appendDownloadLog(`Backtest error: ${String(err)}`);
      throw err;
    }
  };

  const clearDownloadLog = useCallback(() => {
    setDownloadLog([]);
  }, []);

  return {
    configData,
    quickTimeframe,
    setQuickTimeframe,
    quickTimerangePreset,
    setQuickTimerangePreset,
    quickTimerange,
    setQuickTimerange,
    quickSelectedPairs,
    setQuickSelectedPairs,
    pairsOpen,
    setPairsOpen,
    pairsQuery,
    setPairsQuery,
    quickStake,
    setQuickStake,
    quickMaxOpenTrades,
    setQuickMaxOpenTrades,
    maxTradesMode,
    setMaxTradesMode,
    maxTradesUserSet,
    setMaxTradesUserSet,
    downloadStatus,
    downloadLog,
    clearDownloadLog,
    quickConfigLoaded,
    setQuickConfigTouched,
    toggleQuickPair,
    selectAllQuickPairs,
    clearQuickPairs,
    handleTimerangePresetChange,
    handleDownloadData,
    handleRunQuickBacktest,
    isDownloading: downloadData.isPending,
    isRunningBacktest: runBacktest.isPending,
    downloadData,
    runBacktest,
  };
}
