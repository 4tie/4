import { useState, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useBacktest, useBacktests, useRunBacktest, useRunBacktestBatch } from "@/hooks/use-backtests";
import { useFiles } from "@/hooks/use-files";
import { useGetConfig, useDownloadData } from "@/hooks/use-config";
import { Timeframes, type WidgetConfig, type WidgetId } from "@shared/schema";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, ComposedChart } from 'recharts';
import { Download, Loader2, TrendingUp, TrendingDown, Percent, DollarSign, Activity, Check, ChevronsUpDown, Eye, EyeOff, GripVertical, Settings2, BarChart3, LineChart as LineChartIcon, Calendar, X, Save as SaveIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { usePreferences } from "@/hooks/use-preferences";
import { useKeyboardShortcuts, getShortcutLabel, type Shortcut } from "@/hooks/use-keyboard-shortcuts";

interface BacktestDashboardProps {
  onLog: (message: string) => void;
  onBacktestCompleted?: (backtestId: number) => void;
  onStrategySelected?: (strategyName: string) => void;
  selectedStrategyName?: string | null;
}

const AVAILABLE_PAIRS = [
  "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "ADA/USDT",
  "XRP/USDT", "DOT/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT",
  "MATIC/USDT", "LTC/USDT", "TRX/USDT", "UNI/USDT", "ATOM/USDT",
  "XLM/USDT", "ETC/USDT", "BCH/USDT", "NEAR/USDT", "FIL/USDT",
  "APT/USDT", "ARB/USDT", "OP/USDT", "ICP/USDT", "ALGO/USDT",
  "AAVE/USDT", "SAND/USDT", "MANA/USDT", "FTM/USDT", "EGLD/USDT",
  "RUNE/USDT", "INJ/USDT", "GALA/USDT", "HBAR/USDT", "VET/USDT"
];

export function BacktestDashboard({ onLog, onBacktestCompleted, onStrategySelected, selectedStrategyName }: BacktestDashboardProps) {
  const { data: backtests } = useBacktests();
  const { data: files } = useFiles();
  const runBacktest = useRunBacktest();
  const runBacktestBatch = useRunBacktestBatch();
  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(null);
  const [streamBacktestId, setStreamBacktestId] = useState<number | null>(null);
  const lastStreamedLogIndexRef = useRef(0);
  const completionNotifiedRef = useRef<number | null>(null);
  const lastNotifiedStrategyRef = useRef<string | null>(null);
  const suppressStrategyNotifyRef = useRef(false);
  const maxOpenTradesManualRef = useRef(false);
  const maxOpenTradesAutoRef = useRef<number | null>(null);

  const { data: streamBacktest } = useBacktest(streamBacktestId);

  // Filter strategy files from all files
  const strategyFiles = files?.filter(file => 
    file.path.startsWith('user_data/strategies/') && file.path.endsWith('.py')
  ) || [];

  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const getDateDaysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  };

  const [savedFormData] = useState<any | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem("backtestFormData");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  const { data: configData, isLoading: configLoading } = useGetConfig();
  const downloadData = useDownloadData();

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

  const [widgetPrefs, setWidgetPrefs] = usePreferences<WidgetConfig[]>("results_widgets", [
    { id: "profit", visible: true, order: 0 },
    { id: "winrate", visible: true, order: 1 },
    { id: "drawdown", visible: true, order: 2 },
    { id: "sharpe", visible: true, order: 3 },
    { id: "chart", visible: true, order: 4 },
  ]);

  const toggleWidget = (id: WidgetId) => {
    setWidgetPrefs(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const toggleWidgetById = (index: number) => {
    const widget = sortedWidgets[index];
    if (widget) toggleWidget(widget.id);
  };

  const moveWidget = (id: WidgetId, direction: 'up' | 'down') => {
    const index = widgetPrefs.findIndex(w => w.id === id);
    if (direction === 'up' && index > 0) {
      const newPrefs = [...widgetPrefs];
      [newPrefs[index - 1], newPrefs[index]] = [newPrefs[index], newPrefs[index - 1]];
      setWidgetPrefs(newPrefs.map((w, i) => ({ ...w, order: i })));
    } else if (direction === 'down' && index < widgetPrefs.length - 1) {
      const newPrefs = [...widgetPrefs];
      [newPrefs[index + 1], newPrefs[index]] = [newPrefs[index], newPrefs[index + 1]];
      setWidgetPrefs(newPrefs.map((w, i) => ({ ...w, order: i })));
    }
  };

  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('area');
  const [showSMA, setShowSMA] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Form ref for programmatic submission
  const formRef = useRef<HTMLFormElement>(null);

  const sortedWidgets = useMemo(() => [...widgetPrefs].sort((a, b) => a.order - b.order), [widgetPrefs]);

  const defaultValues = useMemo(() => {
    if (savedFormData) {
      const rawCfg = (savedFormData as any)?.config;
      const cfg = rawCfg && typeof rawCfg === "object" ? rawCfg : {};
      const includeStoploss =
        typeof (cfg as any).include_stoploss === "boolean"
          ? Boolean((cfg as any).include_stoploss)
          : (typeof (cfg as any).stoploss === "number" && Number.isFinite((cfg as any).stoploss));
      return {
        ...savedFormData,
        config: {
          ...cfg,
          include_stoploss: includeStoploss,
          stoploss: includeStoploss ? (cfg as any).stoploss : undefined,
        },
      };
    }
    if (!configData) {
      return {
        strategyName: "",
        config: {
          timeframe: "5m",
          backtest_date_from: getDateDaysAgo(30),
          backtest_date_to: getTodayDate(),
          stake_amount: 1000,
          max_open_trades: 1,
          tradable_balance_ratio: 1,
          include_stoploss: false,
          stoploss: undefined,
          trailing_stop: false,
          trailing_stop_positive: 0.01,
          trailing_stop_positive_offset: 0.02,
          trailing_only_offset_is_reached: false,
          minimal_roi: {},
          pairs: ["BTC/USDT", "ETH/USDT"]
        }
      };
    }

    const configuredPairs =
      (configData as any)?.exchange?.pair_whitelist ??
      (configData as any)?.pairlists?.[0]?.pair_whitelist;

    return {
      strategyName: (configData as any)?.strategy ? `user_data/strategies/${(configData as any).strategy}.py` : "",
      config: {
        timeframe: (configData as any)?.timeframe || "5m",
        backtest_date_from: (configData as any)?.backtest_date_from || getDateDaysAgo(30),
        backtest_date_to: (configData as any)?.backtest_date_to || getTodayDate(),
        stake_amount:
          (configData as any)?.stake_amount === "unlimited"
            ? (typeof (configData as any)?.dry_run_wallet === "number" ? (configData as any).dry_run_wallet : 1000)
            : parseFloat(String((configData as any)?.stake_amount ?? "")) || 1000,
        max_open_trades: Number((configData as any)?.max_open_trades ?? 1),
        tradable_balance_ratio: Number((configData as any)?.tradable_balance_ratio ?? 1),
        include_stoploss: false,
        stoploss: undefined,
        trailing_stop: Boolean((configData as any)?.trailing_stop ?? false),
        trailing_stop_positive: Number((configData as any)?.trailing_stop_positive ?? 0.01),
        trailing_stop_positive_offset: Number((configData as any)?.trailing_stop_positive_offset ?? 0.02),
        trailing_only_offset_is_reached: Boolean((configData as any)?.trailing_only_offset_is_reached ?? false),
        minimal_roi: ((configData as any)?.minimal_roi && typeof (configData as any)?.minimal_roi === "object") ? (configData as any).minimal_roi : {},
        pairs: Array.isArray(configuredPairs) && configuredPairs.length > 0 ? configuredPairs : ["BTC/USDT", "ETH/USDT"]
      }
    };
  }, [configData]);

  // Backtest Config Form
  const form = useForm({
    defaultValues
  });

  const watchedMinimalRoi = form.watch("config.minimal_roi" as any) as any;
  const [roiText, setRoiText] = useState<string>("{}");
  useEffect(() => {
    try {
      if (watchedMinimalRoi && typeof watchedMinimalRoi === "object") {
        setRoiText(JSON.stringify(watchedMinimalRoi, null, 2));
      } else {
        setRoiText("{}");
      }
    } catch {
      setRoiText("{}");
    }
  }, [watchedMinimalRoi]);

  const watchedStrategyName = form.watch("strategyName");

  useEffect(() => {
    const s = typeof selectedStrategyName === "string" ? String(selectedStrategyName) : "";
    if (!s.trim()) return;
    const current = String(form.getValues("strategyName") || "");
    if (current === s) return;
    suppressStrategyNotifyRef.current = true;
    form.setValue("strategyName", s, { shouldDirty: true, shouldTouch: true });
    setTimeout(() => {
      suppressStrategyNotifyRef.current = false;
    }, 0);
  }, [form, selectedStrategyName]);

  useEffect(() => {
    const s = typeof watchedStrategyName === "string" ? watchedStrategyName : "";
    if (!s.trim()) return;
    if (suppressStrategyNotifyRef.current) {
      lastNotifiedStrategyRef.current = s;
      return;
    }
    if (lastNotifiedStrategyRef.current === s) return;
    lastNotifiedStrategyRef.current = s;
    onStrategySelected?.(s);
  }, [onStrategySelected, watchedStrategyName]);

  // Save form values to localStorage whenever they change
  useEffect(() => {
    const subscription = form.watch((data) => {
      localStorage.setItem('backtestFormData', JSON.stringify(data));
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Reset form when config data loads
  useEffect(() => {
    if (!savedFormData && configData && !configLoading) {
      suppressStrategyNotifyRef.current = true;
      form.reset(defaultValues);
      const s = typeof selectedStrategyName === "string" ? String(selectedStrategyName) : "";
      if (s.trim()) {
        form.setValue("strategyName", s, { shouldDirty: true, shouldTouch: true });
      }
      setTimeout(() => {
        suppressStrategyNotifyRef.current = false;
      }, 0);
    }
  }, [savedFormData, configData, configLoading, defaultValues, form, selectedStrategyName]);

  const selectedPairs = form.watch("config.pairs");
  const downloadDateFrom = form.watch("config.backtest_date_from");
  const downloadDateTo = form.watch("config.backtest_date_to");

  useEffect(() => {
    const pairsCount = Array.isArray(selectedPairs) ? selectedPairs.length : 0;
    const nextAuto = Math.max(0, pairsCount);
    const current = Number(form.getValues("config.max_open_trades"));
    const prevAuto = maxOpenTradesAutoRef.current;

    const shouldAuto = !maxOpenTradesManualRef.current || (prevAuto != null && current === prevAuto);
    maxOpenTradesAutoRef.current = nextAuto;

    if (shouldAuto && Number.isFinite(current) && current !== nextAuto) {
      form.setValue("config.max_open_trades", nextAuto, { shouldDirty: false, shouldTouch: false });
      maxOpenTradesManualRef.current = false;
    }
  }, [form, selectedPairs]);

  const togglePair = (pair: string) => {
    const current = [...selectedPairs];
    const index = current.indexOf(pair);
    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(pair);
    }
    form.setValue("config.pairs", current);
  };

  const selectAll = () => form.setValue("config.pairs", [...availablePairs]);
  const deselectAll = () => form.setValue("config.pairs", []);

  // Keyboard shortcuts
  const shortcuts: Shortcut[] = [
    {
      key: 'r',
      altKey: true,
      description: 'Run backtest',
      action: () => {
        if (formRef.current && !runBacktest.isPending && selectedPairs.length > 0) {
          formRef.current.requestSubmit();
        }
      }
    },
    {
      key: 's',
      altKey: true,
      description: 'Save preferences',
      action: () => {
        const data = form.getValues();
        localStorage.setItem('backtestFormData', JSON.stringify(data));
        onLog(`✓ Preferences saved`);
      }
    },
    {
      key: 'd',
      altKey: true,
      description: 'Download data',
      action: () => {
        const data = form.getValues();
        const pairs = Array.isArray(data?.config?.pairs) ? data.config.pairs : [];
        const tf = String(data?.config?.timeframe || "").trim();
        const timeframes = tf ? [tf] : [];

        if (pairs.length === 0 || timeframes.length === 0) {
          onLog("✗ Please select at least one pair and a timeframe before downloading data.");
          return;
        }

        const toTimerangePart = (value: string) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
          return value.replace(/-/g, "");
        };

        const fromPart = data?.config?.backtest_date_from
          ? toTimerangePart(String(data.config.backtest_date_from))
          : "";
        const toPart = data?.config?.backtest_date_to
          ? toTimerangePart(String(data.config.backtest_date_to))
          : "";

        const timerange = (fromPart || toPart) ? `${fromPart}-${toPart}` : "";
        const cmdParts = [
          "./.venv/bin/freqtrade",
          "download-data",
          "--config",
          "user_data/config.json",
          "-p",
          ...pairs,
          "-t",
          ...timeframes,
        ];
        if (timerange) cmdParts.push("--timerange", timerange);
        onLog(`> ${cmdParts.join(" ")}`);

        onLog(`Starting download-data for ${pairs.length} pairs (${timeframes.join(", ")})...`);
        downloadData.mutate({
          pairs,
          timeframes,
          date_from: data?.config?.backtest_date_from,
          date_to: data?.config?.backtest_date_to,
        }, {
          onSuccess: (result: any) => {
            if (result?.command) onLog(`> ${result.command}`);
            if (result?.output) onLog(String(result.output));
            if (result?.success) {
              onLog("✓ Data download completed.");
            } else {
              onLog(`✗ Data download failed (exit code ${result?.code ?? "?"}).`);
            }
          },
          onError: (error: any) => {
            onLog(`✗ Failed to download data: ${error.message}`);
          }
        });
      }
    },
    {
      key: 'a',
      altKey: true,
      description: 'Select all pairs',
      action: selectAll
    },
    {
      key: 'z',
      altKey: true,
      description: 'Deselect all pairs',
      action: deselectAll
    },
    {
      key: '1',
      altKey: true,
      description: 'Line chart',
      action: () => setChartType('line')
    },
    {
      key: '2',
      altKey: true,
      description: 'Area chart',
      action: () => setChartType('area')
    },
    {
      key: '3',
      altKey: true,
      description: 'Bar chart',
      action: () => setChartType('bar')
    },
    {
      key: 'm',
      altKey: true,
      description: 'Toggle SMA',
      action: () => setShowSMA(prev => !prev)
    },
    {
      key: 'p',
      altKey: true,
      description: 'Toggle Profit widget',
      action: () => toggleWidget('profit')
    },
    {
      key: 'w',
      altKey: true,
      description: 'Toggle Win Rate widget',
      action: () => toggleWidget('winrate')
    },
    {
      key: 'x',
      altKey: true,
      description: 'Toggle Drawdown widget',
      action: () => toggleWidget('drawdown')
    },
    {
      key: 'h',
      altKey: true,
      description: 'Toggle Sharpe Ratio widget',
      action: () => toggleWidget('sharpe')
    },
    {
      key: 'c',
      altKey: true,
      description: 'Toggle Chart widget',
      action: () => toggleWidget('chart')
    },
    {
      key: '?',
      altKey: true,
      description: 'Show keyboard shortcuts',
      action: () => setShowShortcuts(true)
    }
  ];

  useKeyboardShortcuts(shortcuts);

  const onSubmit = (data: any) => {
    const toTimerangePart = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
      return value.replace(/-/g, "");
    };

    const fromPart = data?.config?.backtest_date_from
      ? toTimerangePart(String(data.config.backtest_date_from))
      : "";
    const toPart = data?.config?.backtest_date_to
      ? toTimerangePart(String(data.config.backtest_date_to))
      : "";
    const timerange = (fromPart || toPart) ? `${fromPart}-${toPart}` : "";

    const includeStoploss = Boolean(data?.config?.include_stoploss);
    const config = {
      ...data?.config,
      timerange,
    };
    delete (config as any).include_stoploss;
    if (!includeStoploss) {
      delete (config as any).stoploss;
    }

    const payload = {
      ...data,
      config,
    };

    onLog(`Starting backtest for strategy: ${data.strategyName}...`);

    runBacktest.mutate(payload, {
      onSuccess: (result) => {
        onLog(`Backtest started with ID: ${result.id}`);

        setSelectedBacktestId(result.id);
        setStreamBacktestId(result.id);
        lastStreamedLogIndexRef.current = 0;
        completionNotifiedRef.current = null;
      }
    });
  };

  useEffect(() => {
    if (!streamBacktestId) return;
    const status = (streamBacktest as any)?.status;
    if (!status) return;

    if (status === "completed" && completionNotifiedRef.current !== streamBacktestId) {
      completionNotifiedRef.current = streamBacktestId;
      onLog(`Backtest completed: ${streamBacktestId}`);
      // Note: This callback is intentionally optional.
      // It allows the parent view to auto-navigate to results.
      onBacktestCompleted?.(streamBacktestId);
    }
  }, [onLog, onBacktestCompleted, streamBacktest, streamBacktestId]);

  useEffect(() => {
    if (!streamBacktestId) return;
    const logs = (streamBacktest as any)?.logs;
    if (!Array.isArray(logs)) return;

    const start = lastStreamedLogIndexRef.current;
    if (start >= logs.length) return;

    const newLogs = logs.slice(start);
    lastStreamedLogIndexRef.current = logs.length;

    for (const entry of newLogs) {
      const text = String(entry ?? "");
      const parts = text.split(/\r?\n/);
      for (const part of parts) {
        if (!part) continue;
        const trimmed = part.trimStart();
        if (trimmed.startsWith("$ ")) {
          onLog(`> ${trimmed.slice(2)}`);
        } else {
          onLog(part);
        }
      }
    }
  }, [onLog, streamBacktest, streamBacktestId]);

  const selectedBacktest = backtests?.find(b => b.id === selectedBacktestId);

  const selectedBatchId = (selectedBacktest as any)?.config?.batchId as string | undefined;
  const batchRuns = useMemo(() => {
    const id = typeof selectedBatchId === "string" ? selectedBatchId.trim() : "";
    if (!id) return [] as any[];
    const list = Array.isArray(backtests) ? backtests : [];
    const filtered = list.filter((bt) => String((bt as any)?.config?.batchId || "") === id);
    filtered.sort((a, b) => {
      const ai = Number((a as any)?.config?.batchIndex ?? 0);
      const bi = Number((b as any)?.config?.batchIndex ?? 0);
      return ai - bi;
    });
    return filtered as any[];
  }, [backtests, selectedBatchId]);

  const selectedResults = selectedBacktest?.results as any | undefined;
  const selectedTrades = Array.isArray(selectedResults?.trades) ? (selectedResults!.trades as any[]) : [];
  const wins = selectedTrades.filter((t) => parseFloat(String(t?.profit_ratio ?? "0")) > 0).length;
  const totalTrades = selectedTrades.length;
  const stakeAmount = Number((selectedBacktest as any)?.config?.stake_amount);

  const chartData = useMemo(() => {
    if (!selectedBacktest) return [] as Array<{ name: string; value: number; sma: number | null }>;
    if (!Number.isFinite(stakeAmount)) return [] as Array<{ name: string; value: number; sma: number | null }>;
    if (!Array.isArray(selectedTrades) || selectedTrades.length === 0) {
      return [] as Array<{ name: string; value: number; sma: number | null }>;
    }

    let cumulative = stakeAmount;
    const points = selectedTrades.map((t, i) => {
      const r = parseFloat(String(t?.profit_ratio ?? "0"));
      cumulative *= (1 + (Number.isFinite(r) ? r : 0));
      return { name: `T${i + 1}`, value: cumulative };
    });

    const window = 20;
    const withSma = points.map((p, i) => {
      if (i < window - 1) return { ...p, sma: null };
      const slice = points.slice(i - window + 1, i + 1);
      const avg = slice.reduce((sum, s) => sum + s.value, 0) / slice.length;
      return { ...p, sma: avg };
    });

    return withSma;
  }, [selectedBacktest, stakeAmount, selectedTrades]);

  const kpi = useMemo(() => {
    const profitTotal = parseFloat(String(selectedResults?.profit_total ?? ""));
    const winRate = parseFloat(String(selectedResults?.win_rate ?? ""));
    const maxDrawdown = parseFloat(String(selectedResults?.max_drawdown ?? ""));
    const sharpe = selectedResults?.sharpe;

    return {
      profit: {
        value: Number.isFinite(profitTotal) ? `${(profitTotal * 100).toFixed(2)}%` : "N/A",
        sub: totalTrades > 0 ? `${totalTrades} trades` : "N/A",
        trend: Number.isFinite(profitTotal)
          ? (profitTotal >= 0 ? ("up" as const) : ("down" as const))
          : undefined,
      },
      winrate: {
        value: Number.isFinite(winRate) ? `${(winRate * 100).toFixed(1)}%` : "N/A",
        sub: totalTrades > 0 ? `${wins} / ${totalTrades} trades` : "N/A",
      },
      drawdown: {
        value: Number.isFinite(maxDrawdown) ? `${(maxDrawdown * 100).toFixed(2)}%` : "N/A",
        sub: "N/A",
        trend: "down" as const,
      },
      sharpe: {
        value: typeof sharpe === "number" && Number.isFinite(sharpe) ? sharpe.toFixed(2) : "N/A",
        sub: "N/A",
      },
    };
  }, [selectedResults, totalTrades, wins]);

  const advancedMetrics = useMemo(() => {
    const trades = Array.isArray(selectedTrades) ? selectedTrades : [];
    if (trades.length === 0) {
      return {
        profitFactor: null as number | null,
        profitFactorAbs: null as number | null,
        expectancy: null as number | null,
        expectancyAbs: null as number | null,
        avgWin: null as number | null,
        avgLoss: null as number | null,
        avgWinAbs: null as number | null,
        avgLossAbs: null as number | null,
        payoffRatio: null as number | null,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        medianReturn: null as number | null,
        stdReturn: null as number | null,
        avgDurationMin: null as number | null,
        medianDurationMin: null as number | null,
        bestTrade: null as number | null,
        worstTrade: null as number | null,
        maxWinStreak: 0,
        maxLossStreak: 0,
        maxDrawdown: null as number | null,
        maxDrawdownAbs: null as number | null,
        topPairsByProfit: [] as Array<{ pair: string; trades: number; winRate: number; profitAbs: number }>,
        bottomPairsByProfit: [] as Array<{ pair: string; trades: number; winRate: number; profitAbs: number }>,
        bestPairsByWinRate: [] as Array<{ pair: string; trades: number; winRate: number; profitAbs: number }>,
        worstPairsByWinRate: [] as Array<{ pair: string; trades: number; winRate: number; profitAbs: number }>,
        avgMfe: null as number | null,
        avgMae: null as number | null,
      };
    }

    const toNum = (value: unknown) => {
      const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
      return Number.isFinite(n) ? n : NaN;
    };

    const ratios = trades
      .map((t) => toNum((t as any)?.profit_ratio))
      .filter((x) => Number.isFinite(x)) as number[];

    const profitAbsList = trades
      .map((t: any) => {
        const profitAbs = toNum(t?.profit_abs);
        if (Number.isFinite(profitAbs)) return profitAbs;
        const r = toNum(t?.profit_ratio);
        const equityBefore = toNum(t?.equity_before);
        if (Number.isFinite(r) && Number.isFinite(equityBefore)) return equityBefore * r;
        return NaN;
      })
      .filter((x) => Number.isFinite(x)) as number[];

    const winsR = ratios.filter((r) => r > 0);
    const lossesR = ratios.filter((r) => r < 0);
    const breakevenR = ratios.filter((r) => r === 0);

    const sumWin = winsR.reduce((s, r) => s + r, 0);
    const sumLossAbs = lossesR.reduce((s, r) => s + Math.abs(r), 0);

    const profitFactor = sumLossAbs > 0 ? sumWin / sumLossAbs : null;
    const expectancy = ratios.length > 0 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null;
    const avgWin = winsR.length > 0 ? sumWin / winsR.length : null;
    const avgLoss = lossesR.length > 0 ? lossesR.reduce((s, r) => s + r, 0) / lossesR.length : null;
    const bestTrade = ratios.length > 0 ? Math.max(...ratios) : null;
    const worstTrade = ratios.length > 0 ? Math.min(...ratios) : null;

    const winsAbs = profitAbsList.filter((p) => p > 0);
    const lossesAbs = profitAbsList.filter((p) => p < 0);
    const sumWinAbs = winsAbs.reduce((s, p) => s + p, 0);
    const sumLossAbsAbs = lossesAbs.reduce((s, p) => s + Math.abs(p), 0);
    const profitFactorAbs = sumLossAbsAbs > 0 ? sumWinAbs / sumLossAbsAbs : null;
    const expectancyAbs = profitAbsList.length > 0 ? profitAbsList.reduce((s, p) => s + p, 0) / profitAbsList.length : null;
    const avgWinAbs = winsAbs.length > 0 ? sumWinAbs / winsAbs.length : null;
    const avgLossAbs = lossesAbs.length > 0 ? lossesAbs.reduce((s, p) => s + p, 0) / lossesAbs.length : null;
    const payoffRatio =
      typeof avgWinAbs === "number" && Number.isFinite(avgWinAbs) && typeof avgLossAbs === "number" && Number.isFinite(avgLossAbs) && Math.abs(avgLossAbs) > 0
        ? avgWinAbs / Math.abs(avgLossAbs)
        : null;

    const sortedReturns = [...ratios].sort((a, b) => a - b);
    const medianReturn = (() => {
      if (sortedReturns.length === 0) return null;
      const mid = Math.floor(sortedReturns.length / 2);
      return sortedReturns.length % 2 === 1
        ? sortedReturns[mid]
        : (sortedReturns[mid - 1] + sortedReturns[mid]) / 2;
    })();

    const stdReturn = (() => {
      if (ratios.length < 2) return null;
      const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      const variance = ratios.reduce((s, r) => s + (r - mean) * (r - mean), 0) / ratios.length;
      const std = Math.sqrt(variance);
      return Number.isFinite(std) ? std : null;
    })();

    const durationsMin = trades
      .map((t: any) => {
        const od = t?.open_date ? new Date(String(t.open_date)) : null;
        const cd = t?.close_date ? new Date(String(t.close_date)) : null;
        if (!od || !cd) return null;
        const ms = cd.getTime() - od.getTime();
        if (!Number.isFinite(ms) || ms <= 0) return null;
        return ms / 60000;
      })
      .filter((x: any) => typeof x === "number" && Number.isFinite(x)) as number[];
    const avgDurationMin = durationsMin.length > 0 ? durationsMin.reduce((s, v) => s + v, 0) / durationsMin.length : null;

    const medianDurationMin = (() => {
      if (durationsMin.length === 0) return null;
      const sorted = [...durationsMin].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    })();

    let currWin = 0;
    let currLoss = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    for (const r of ratios) {
      if (r > 0) {
        currWin += 1;
        currLoss = 0;
      } else if (r < 0) {
        currLoss += 1;
        currWin = 0;
      } else {
        currWin = 0;
        currLoss = 0;
      }
      if (currWin > maxWinStreak) maxWinStreak = currWin;
      if (currLoss > maxLossStreak) maxLossStreak = currLoss;
    }

    const equitySeries = (() => {
      const series: number[] = [];
      let equity = (() => {
        const firstEq = toNum((trades[0] as any)?.equity_before);
        if (Number.isFinite(firstEq)) return firstEq;
        if (Number.isFinite(stakeAmount) && stakeAmount > 0) return stakeAmount;
        return 0;
      })();

      for (const t of trades as any[]) {
        const eqAfter = toNum(t?.equity_after);
        if (Number.isFinite(eqAfter)) {
          equity = eqAfter;
          series.push(equity);
          continue;
        }
        const r = toNum(t?.profit_ratio);
        if (Number.isFinite(r)) {
          equity = equity * (1 + r);
          series.push(equity);
          continue;
        }
      }
      return series;
    })();

    const maxDrawdown = (() => {
      if (equitySeries.length < 2) return null;
      let peak = equitySeries[0];
      let maxDd = 0;
      for (const e of equitySeries) {
        if (e > peak) peak = e;
        if (peak <= 0) continue;
        const dd = (peak - e) / peak;
        if (Number.isFinite(dd) && dd > maxDd) maxDd = dd;
      }
      return Number.isFinite(maxDd) ? maxDd : null;
    })();

    const maxDrawdownAbs = (() => {
      if (equitySeries.length < 2) return null;
      let peak = equitySeries[0];
      let maxDd = 0;
      for (const e of equitySeries) {
        if (e > peak) peak = e;
        const dd = peak - e;
        if (Number.isFinite(dd) && dd > maxDd) maxDd = dd;
      }
      return Number.isFinite(maxDd) ? maxDd : null;
    })();

    const pairStats = (() => {
      const map = new Map<string, { pair: string; trades: number; wins: number; profitAbs: number }>();

      for (const t of trades as any[]) {
        const pair = String(t?.pair || "-");
        const r = toNum(t?.profit_ratio);
        const eqBefore = toNum(t?.equity_before);
        const profitAbs = (() => {
          const p = toNum(t?.profit_abs);
          if (Number.isFinite(p)) return p;
          if (Number.isFinite(r) && Number.isFinite(eqBefore)) return eqBefore * r;
          return 0;
        })();

        const curr = map.get(pair) || { pair, trades: 0, wins: 0, profitAbs: 0 };
        curr.trades += 1;
        if (Number.isFinite(r) && r > 0) curr.wins += 1;
        curr.profitAbs += profitAbs;
        map.set(pair, curr);
      }

      const arr = Array.from(map.values()).map((p) => ({
        pair: p.pair,
        trades: p.trades,
        winRate: p.trades > 0 ? p.wins / p.trades : 0,
        profitAbs: p.profitAbs,
      }));

      const byProfitDesc = [...arr].sort((a, b) => b.profitAbs - a.profitAbs);
      const byProfitAsc = [...arr].sort((a, b) => a.profitAbs - b.profitAbs);

      const eligibleByTrades = (() => {
        const minTrades = Math.min(5, Math.max(1, Math.floor(trades.length / 10)));
        const filtered = arr.filter((p) => p.trades >= minTrades);
        return filtered.length > 0 ? filtered : arr;
      })();

      const bestByWinRate = [...eligibleByTrades].sort((a, b) => b.winRate - a.winRate);
      const worstByWinRate = [...eligibleByTrades].sort((a, b) => a.winRate - b.winRate);

      return {
        topPairsByProfit: byProfitDesc.slice(0, 3),
        bottomPairsByProfit: byProfitAsc.slice(0, 3),
        bestPairsByWinRate: bestByWinRate.slice(0, 3),
        worstPairsByWinRate: worstByWinRate.slice(0, 3),
      };
    })();

    const avgMfe = (() => {
      const values = trades
        .map((t: any) => {
          const open = toNum(t?.open_rate);
          const maxRate = toNum(t?.max_rate);
          if (!Number.isFinite(open) || open <= 0) return NaN;
          if (!Number.isFinite(maxRate)) return NaN;
          return (maxRate - open) / open;
        })
        .filter((x) => Number.isFinite(x)) as number[];
      if (values.length === 0) return null;
      return values.reduce((s, v) => s + v, 0) / values.length;
    })();

    const avgMae = (() => {
      const values = trades
        .map((t: any) => {
          const open = toNum(t?.open_rate);
          const minRate = toNum(t?.min_rate);
          if (!Number.isFinite(open) || open <= 0) return NaN;
          if (!Number.isFinite(minRate)) return NaN;
          return (minRate - open) / open;
        })
        .filter((x) => Number.isFinite(x)) as number[];
      if (values.length === 0) return null;
      return values.reduce((s, v) => s + v, 0) / values.length;
    })();

    return {
      profitFactor,
      profitFactorAbs,
      expectancy,
      expectancyAbs,
      avgWin,
      avgLoss,
      avgWinAbs,
      avgLossAbs,
      payoffRatio,
      winCount: winsR.length,
      lossCount: lossesR.length,
      breakevenCount: breakevenR.length,
      medianReturn,
      stdReturn,
      avgDurationMin,
      medianDurationMin,
      bestTrade,
      worstTrade,
      maxWinStreak,
      maxLossStreak,
      maxDrawdown,
      maxDrawdownAbs,
      topPairsByProfit: pairStats.topPairsByProfit,
      bottomPairsByProfit: pairStats.bottomPairsByProfit,
      bestPairsByWinRate: pairStats.bestPairsByWinRate,
      worstPairsByWinRate: pairStats.worstPairsByWinRate,
      avgMfe,
      avgMae,
    };
  }, [selectedTrades, stakeAmount]);

  return (
    <div className="h-full overflow-y-auto bg-background p-6 space-y-8">
      
      {/* Header with Settings and Alt Button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Backtest Dashboard</h1>
          <p className="text-muted-foreground text-sm">Run and analyze your trading strategies</p>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 border-border bg-card shadow-lg">
          <CardHeader>
            <CardTitle>Configure Backtest</CardTitle>
            <CardDescription>Run a strategy against historical data</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form ref={formRef} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="strategyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Strategy</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select strategy" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {strategyFiles.map(file => (
                            <SelectItem key={file.id} value={file.path}>
                              {file.path.split('/').pop()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <FormLabel>Pairs Selection</FormLabel>
                    <div className="flex gap-2">
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 px-2 text-[10px]"
                        onClick={selectAll}
                        title="Alt+A"
                      >
                        Select All
                      </Button>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 px-2 text-[10px]"
                        onClick={deselectAll}
                        title="Alt+Z"
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-3 border border-border rounded-md bg-background/50 max-h-[120px] overflow-y-auto">
                    {availablePairs.map(pair => (
                      <Badge
                        key={pair}
                        variant={selectedPairs.includes(pair) ? "default" : "outline"}
                        className={cn(
                          "cursor-pointer transition-all hover:scale-105 active:scale-95",
                          !selectedPairs.includes(pair) && "text-muted-foreground opacity-60"
                        )}
                        onClick={() => togglePair(pair)}
                      >
                        {pair}
                      </Badge>
                    ))}
                  </div>
                  <FormMessage>{(form.formState.errors as any)?.config?.pairs?.message ? String((form.formState.errors as any).config.pairs.message) : null}</FormMessage>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="config.timeframe"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timeframe</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Timeframe" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Timeframes.map(tf => (
                              <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="config.stake_amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stake Amount (USD)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            value={field.value}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            placeholder="1000"
                            min="1"
                            step="1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="config.include_stoploss"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={Boolean(field.value)}
                            onCheckedChange={(v) => {
                              const enabled = Boolean(v);
                              field.onChange(enabled);
                              if (!enabled) {
                                form.setValue("config.stoploss" as any, undefined, { shouldDirty: true, shouldTouch: true });
                              }
                            }}
                          />
                          <div className="text-xs text-muted-foreground">Include stoploss override</div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="config.stoploss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stoploss (ratio)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          disabled={!Boolean(form.getValues("config.include_stoploss" as any))}
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw) {
                              field.onChange(undefined);
                              return;
                            }
                            const n = Number(raw);
                            field.onChange(Number.isFinite(n) ? n : undefined);
                          }}
                          placeholder="-0.1"
                          step="0.001"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="config.trailing_stop"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trailing Stop</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Checkbox checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                          <div className="text-xs text-muted-foreground">Enable</div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="config.trailing_stop_positive"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trailing Stop Positive</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            step="0.001"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="config.trailing_stop_positive_offset"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trailing Stop Offset</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            step="0.001"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="config.trailing_only_offset_is_reached"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trailing Only Offset Reached</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Checkbox checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                          <div className="text-xs text-muted-foreground">Require offset</div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Minimal ROI (JSON)</FormLabel>
                  <FormControl>
                    <Textarea
                      value={roiText}
                      onChange={(e) => setRoiText(e.target.value)}
                      onBlur={() => {
                        try {
                          const parsed = JSON.parse(roiText || "{}");
                          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                            onLog("✗ minimal_roi must be a JSON object");
                            return;
                          }
                          form.setValue("config.minimal_roi" as any, parsed);
                        } catch (e: any) {
                          onLog(`✗ Invalid minimal_roi JSON: ${e?.message || String(e)}`);
                        }
                      }}
                      className="min-h-[90px] font-mono text-xs"
                    />
                  </FormControl>
                </FormItem>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="config.max_open_trades"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Open Trades</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value}
                            onChange={(e) => {
                              maxOpenTradesManualRef.current = true;
                              field.onChange(parseInt(e.target.value, 10) || 0);
                            }}
                            placeholder="1"
                            min="0"
                            step="1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="config.tradable_balance_ratio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tradable Balance Ratio</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            value={field.value}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            placeholder="1"
                            min="0"
                            max="1"
                            step="0.01"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="config.backtest_date_from"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From Date</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Input 
                            type="date" 
                            {...field}
                          />
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                            <Button
                              type="button"
                              variant={field.value === getDateDaysAgo(30) ? "default" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                field.onChange(getDateDaysAgo(30));
                                form.setValue('config.backtest_date_from', getDateDaysAgo(30));
                              }}
                            >
                              30d
                            </Button>
                            <Button
                              type="button"
                              variant={field.value === getDateDaysAgo(60) ? "default" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                field.onChange(getDateDaysAgo(60));
                                form.setValue('config.backtest_date_from', getDateDaysAgo(60));
                              }}
                            >
                              60d
                            </Button>
                            <Button
                              type="button"
                              variant={field.value === getDateDaysAgo(90) ? "default" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                field.onChange(getDateDaysAgo(90));
                                form.setValue('config.backtest_date_from', getDateDaysAgo(90));
                              }}
                            >
                              90d
                            </Button>
                            <Button
                              type="button"
                              variant={field.value === getDateDaysAgo(180) ? "default" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                field.onChange(getDateDaysAgo(180));
                                form.setValue('config.backtest_date_from', getDateDaysAgo(180));
                              }}
                            >
                              180
                            </Button>
                            <Button
                              type="button"
                              variant={field.value === getDateDaysAgo(240) ? "default" : "outline"}
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => {
                                field.onChange(getDateDaysAgo(240));
                                form.setValue('config.backtest_date_from', getDateDaysAgo(240));
                              }}
                            >
                              240
                            </Button>
                          </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="config.backtest_date_to"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>To Date</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Input 
                            type="date" 
                            {...field}
                          />
                          <Button
                            type="button"
                            variant={field.value === getTodayDate() ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs w-full"
                            onClick={() => field.onChange(getTodayDate())}
                          >
                            Today
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <Button 
                    type="button"
                    variant="outline"
                    className="flex-1 h-9 text-xs gap-1.5"
                    onClick={() => {
                      const data = form.getValues();
                      localStorage.setItem('backtestFormData', JSON.stringify(data));
                      onLog(`✓ Preferences saved`);
                    }}
                    title="Alt+S"
                  >
                    <>
                      <SaveIcon className="w-3 h-3" />
                      Save Preferences
                      <kbd className="ml-auto text-[9px] font-mono opacity-60">Alt+S</kbd>
                    </>
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20 h-9 text-xs"
                    disabled={runBacktest.isPending || selectedPairs.length === 0}
                    title="Alt+R"
                  >
                    {runBacktest.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        Run Backtest
                        <kbd className="ml-auto text-[9px] font-mono opacity-60">Alt+R</kbd>
                      </>
                    )}
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full h-9 text-xs"
                  disabled={runBacktestBatch.isPending || runBacktest.isPending || selectedPairs.length === 0}
                  onClick={() => {
                    const data = form.getValues();
                    if (!data?.strategyName) {
                      onLog("✗ Please select a strategy before running a batch validation.");
                      return;
                    }
                    const ok = confirm("Run rolling validation (4 x 90-day windows ending at 'To Date')?");
                    if (!ok) return;

                    const end = String(data?.config?.backtest_date_to || "").trim();
                    const payload = {
                      strategyName: String(data.strategyName),
                      baseConfig: {
                        ...data.config,
                      },
                      rolling: {
                        windowDays: 90,
                        stepDays: 90,
                        count: 4,
                        end: end || undefined,
                      },
                    };
                    onLog(`Starting rolling validation batch for: ${data.strategyName}`);
                    runBacktestBatch.mutate(payload as any);
                  }}
                >
                  Validate (Rolling 4×90d)
                </Button>

                <div className="space-y-2">
                  <FormLabel>Download Data</FormLabel>
                  <div className="text-[10px] text-muted-foreground">
                    Range: {downloadDateFrom || "-"} → {downloadDateTo || "-"}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-9 text-xs gap-1.5"
                    disabled={downloadData.isPending || selectedPairs.length === 0}
                    onClick={() => {
                      const data = form.getValues();
                      const pairs = Array.isArray(data?.config?.pairs) ? data.config.pairs : [];
                      const tf = String(data?.config?.timeframe || "").trim();
                      const timeframes = tf ? [tf] : [];

                      if (pairs.length === 0 || timeframes.length === 0) {
                        onLog("✗ Please select at least one pair and a timeframe before downloading data.");
                        return;
                      }

                      const toTimerangePart = (value: string) => {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
                        return value.replace(/-/g, "");
                      };

                      const fromPart = data?.config?.backtest_date_from
                        ? toTimerangePart(String(data.config.backtest_date_from))
                        : "";
                      const toPart = data?.config?.backtest_date_to
                        ? toTimerangePart(String(data.config.backtest_date_to))
                        : "";

                      const timerange = (fromPart || toPart) ? `${fromPart}-${toPart}` : "";
                      const cmdParts = [
                        "./.venv/bin/freqtrade",
                        "download-data",
                        "--config",
                        "user_data/config.json",
                        "-p",
                        ...pairs,
                        "-t",
                        ...timeframes,
                      ];
                      if (timerange) cmdParts.push("--timerange", timerange);
                      onLog(`> ${cmdParts.join(" ")}`);

                      onLog(`Starting download-data for ${pairs.length} pairs (${timeframes.join(", ")})...`);
                      downloadData.mutate({
                        pairs,
                        timeframes,
                        date_from: data?.config?.backtest_date_from,
                        date_to: data?.config?.backtest_date_to,
                      }, {
                        onSuccess: (result: any) => {
                          if (result?.command) onLog(`> ${result.command}`);
                          if (result?.output) onLog(String(result.output));
                          if (result?.success) {
                            onLog("✓ Data download completed.");
                          } else {
                            onLog(`✗ Data download failed (exit code ${result?.code ?? "?"}).`);
                          }
                        },
                        onError: (error: any) => {
                          onLog(`✗ Failed to download data: ${error.message}`);
                        }
                      });
                    }}
                    title="Alt+D"
                  >
                    {downloadData.isPending ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="w-3 h-3" />
                        Download Data
                        <kbd className="ml-auto text-[9px] font-mono opacity-60">Alt+D</kbd>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* History List */}
        <Card className="lg:col-span-2 border-border bg-card shadow-lg flex flex-col max-h-[500px]">
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>History of your strategy performance</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
             <div className="divide-y divide-border">
               {backtests?.length === 0 && (
                 <div className="p-8 text-center text-muted-foreground">No backtests run yet.</div>
               )}
               {backtests?.map((bt) => (
                 <div 
                   key={bt.id} 
                   className={`p-4 hover:bg-secondary/40 cursor-pointer transition-colors flex items-center justify-between ${selectedBacktestId === bt.id ? 'bg-secondary/60 border-l-2 border-primary' : ''}`}
                   onClick={() => setSelectedBacktestId(bt.id)}
                 >
                   <div className="space-y-1">
                     <div className="font-semibold text-sm flex items-center gap-2">
                       {bt.strategyName.split('/').pop()}
                       <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                         bt.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                         bt.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                         'bg-yellow-500/10 text-yellow-500'
                       }`}>
                         {bt.status}
                       </span>
                     </div>
                     <div className="text-xs text-muted-foreground">
                       {bt.createdAt ? format(new Date(bt.createdAt), "MMM d, HH:mm") : "-"} • 
                       {/* @ts-ignore */}
                       <span className="ml-1">{bt.config.timeframe}</span> • 
                       {/* @ts-ignore */}
                       <span className="ml-1">${bt.config.stake_amount}</span>
                     </div>
                   </div>

                   {/* Quick Stats Preview */}
                   {Boolean(bt.results) && (
                     <div className="flex gap-4 text-right">
                       <div>
                         <p className="text-[10px] text-muted-foreground">Profit</p>
                         {(() => {
                           const pt = (bt.results as any)?.profit_total;
                           const ptNum = typeof pt === "number" ? pt : typeof pt === "string" ? parseFloat(pt) : NaN;
                           const formatted = Number.isFinite(ptNum) ? `${(ptNum * 100).toFixed(1)}%` : "0.0%";
                           const cls = Number.isFinite(ptNum) && ptNum < 0 ? "text-red-500" : "text-green-500";
                           return <p className={`text-sm font-bold ${cls}`}>{formatted}</p>;
                         })()}
                       </div>
                       <div>
                         <p className="text-[10px] text-muted-foreground">Trades</p>
                         <p className="text-sm font-medium">{(bt.results as any)?.total_trades || 0}</p>
                       </div>
                     </div>
                   )}
                 </div>
               ))}
             </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Section - Only if a backtest is selected */}
      {selectedBacktest && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">Results: {selectedBacktest.strategyName.split('/').pop()}</h2>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-layout-settings">
                  <Settings2 className="h-4 w-4" />
                  Settings
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 p-3" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-sm border-b pb-2 mb-3">Widget Visibility & Order</h4>
                    <div className="space-y-2">
                      {sortedWidgets.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-2 p-1.5 rounded-md hover:bg-secondary/40">
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6" 
                            onClick={() => toggleWidget(w.id)}
                            data-testid={`button-toggle-${w.id}`}
                          >
                            {w.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                          </Button>
                          <span className="text-xs capitalize">{String(w.id)}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6" 
                            onClick={() => moveWidget(w.id, 'up')}
                            disabled={w.order === 0}
                            data-testid={`button-move-up-${w.id}`}
                          >
                            <TrendingUp className="h-3 w-3 rotate-[-45deg]" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6" 
                            onClick={() => moveWidget(w.id, 'down')}
                            disabled={w.order === widgetPrefs.length - 1}
                            data-testid={`button-move-down-${w.id}`}
                          >
                            <TrendingDown className="h-3 w-3 rotate-[45deg]" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </PopoverContent>
            </Popover>
          </div>
          
          <div className="flex flex-col gap-6">
            {batchRuns.length > 1 && (
              <Card className="border-border bg-card shadow-md" data-testid="batch-results">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Batch Results</CardTitle>
                  <CardDescription className="text-xs">
                    Batch {String(selectedBatchId)} • {batchRuns.length} runs
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground px-2 py-2 border-b border-border/50">
                    <div>Range</div>
                    <div className="text-right">Profit</div>
                    <div className="text-right">Max DD</div>
                    <div className="text-right">Win Rate</div>
                    <div className="text-right">Trades</div>
                  </div>

                  <div className="divide-y divide-border/50">
                    {batchRuns.map((bt) => {
                      const cfg = (bt as any)?.config || {};
                      const res = (bt as any)?.results || {};
                      const pt = typeof res?.profit_total === "number" ? res.profit_total : parseFloat(String(res?.profit_total ?? ""));
                      const dd = typeof res?.max_drawdown === "number" ? res.max_drawdown : parseFloat(String(res?.max_drawdown ?? ""));
                      const wr = typeof res?.win_rate === "number" ? res.win_rate : parseFloat(String(res?.win_rate ?? ""));
                      const tr = typeof res?.total_trades === "number" ? res.total_trades : parseInt(String(res?.total_trades ?? "0"), 10);

                      const range = String(cfg?.batchRange || "").trim() || (() => {
                        const f = String(cfg?.backtest_date_from || "").trim();
                        const t = String(cfg?.backtest_date_to || "").trim();
                        return (f || t) ? `${f || "?"}→${t || "?"}` : "-";
                      })();

                      const profitText = Number.isFinite(pt) ? `${(pt * 100).toFixed(2)}%` : "-";
                      const ddText = Number.isFinite(dd) ? `${(dd * 100).toFixed(2)}%` : "-";
                      const wrText = Number.isFinite(wr) ? `${(wr * 100).toFixed(1)}%` : "-";
                      const profitCls = Number.isFinite(pt) && pt < 0 ? "text-red-500" : "text-green-500";

                      return (
                        <div
                          key={bt.id}
                          className={cn(
                            "grid grid-cols-5 gap-2 px-2 py-2 text-xs cursor-pointer hover:bg-secondary/40",
                            selectedBacktestId === bt.id && "bg-secondary/60"
                          )}
                          onClick={() => setSelectedBacktestId(bt.id)}
                        >
                          <div className="truncate" title={range}>{range}</div>
                          <div className={cn("text-right font-semibold", profitCls)}>{profitText}</div>
                          <div className="text-right">{ddText}</div>
                          <div className="text-right">{wrText}</div>
                          <div className="text-right">{Number.isFinite(tr) ? tr : 0}</div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {sortedWidgets.filter(w => w.id !== 'chart' && w.visible).map((w) => {
                const widgetId = w.id;
                if (widgetId === 'profit') return <StatsCard key="profit" title="Total Profit" value={kpi.profit.value} subValue={kpi.profit.sub} icon={DollarSign} trend={kpi.profit.trend} data-testid="widget-profit" />;
                if (widgetId === 'winrate') return <StatsCard key="winrate" title="Win Rate" value={kpi.winrate.value} subValue={kpi.winrate.sub} icon={Percent} data-testid="widget-winrate" />;
                if (widgetId === 'drawdown') return <StatsCard key="drawdown" title="Max Drawdown" value={kpi.drawdown.value} subValue={kpi.drawdown.sub} icon={TrendingDown} trend={kpi.drawdown.trend} data-testid="widget-drawdown" />;
                if (widgetId === 'sharpe') return <StatsCard key="sharpe" title="Sharpe Ratio" value={kpi.sharpe.value} subValue={kpi.sharpe.sub} icon={Activity} data-testid="widget-sharpe" />;
                return null;
              })}
            </div>

            {selectedTrades.length > 0 && (
              <Card className="border-border bg-card shadow-md" data-testid="advanced-metrics">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Advanced Metrics</CardTitle>
                  <CardDescription className="text-xs">Derived from trade list</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Wins / Losses / BE</div>
                      <div className="font-semibold">
                        {advancedMetrics.winCount} / {advancedMetrics.lossCount} / {advancedMetrics.breakevenCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Profit Factor</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.profitFactor === "number" && Number.isFinite(advancedMetrics.profitFactor)
                          ? advancedMetrics.profitFactor.toFixed(2)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Profit Factor (Abs)</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.profitFactorAbs === "number" && Number.isFinite(advancedMetrics.profitFactorAbs)
                          ? advancedMetrics.profitFactorAbs.toFixed(2)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Expectancy / Trade</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.expectancy === "number" && Number.isFinite(advancedMetrics.expectancy)
                          ? `${(advancedMetrics.expectancy * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Expectancy (Abs)</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.expectancyAbs === "number" && Number.isFinite(advancedMetrics.expectancyAbs)
                          ? advancedMetrics.expectancyAbs.toFixed(2)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Avg Win</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.avgWin === "number" && Number.isFinite(advancedMetrics.avgWin)
                          ? `${(advancedMetrics.avgWin * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Avg Loss</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.avgLoss === "number" && Number.isFinite(advancedMetrics.avgLoss)
                          ? `${(advancedMetrics.avgLoss * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Payoff Ratio (Abs)</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.payoffRatio === "number" && Number.isFinite(advancedMetrics.payoffRatio)
                          ? advancedMetrics.payoffRatio.toFixed(2)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Avg Duration</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.avgDurationMin === "number" && Number.isFinite(advancedMetrics.avgDurationMin)
                          ? `${advancedMetrics.avgDurationMin.toFixed(1)}m`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Median Duration</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.medianDurationMin === "number" && Number.isFinite(advancedMetrics.medianDurationMin)
                          ? `${advancedMetrics.medianDurationMin.toFixed(1)}m`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Best Trade</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.bestTrade === "number" && Number.isFinite(advancedMetrics.bestTrade)
                          ? `${(advancedMetrics.bestTrade * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Worst Trade</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.worstTrade === "number" && Number.isFinite(advancedMetrics.worstTrade)
                          ? `${(advancedMetrics.worstTrade * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Median Return</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.medianReturn === "number" && Number.isFinite(advancedMetrics.medianReturn)
                          ? `${(advancedMetrics.medianReturn * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Return StdDev</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.stdReturn === "number" && Number.isFinite(advancedMetrics.stdReturn)
                          ? `${(advancedMetrics.stdReturn * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Max Win Streak</div>
                      <div className="font-semibold">{advancedMetrics.maxWinStreak}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Max Loss Streak</div>
                      <div className="font-semibold">{advancedMetrics.maxLossStreak}</div>
                    </div>

                    <div>
                      <div className="text-[10px] text-muted-foreground">Trade-Series Max DD</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.maxDrawdown === "number" && Number.isFinite(advancedMetrics.maxDrawdown)
                          ? `${(advancedMetrics.maxDrawdown * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-muted-foreground">Trade-Series Max DD (Abs)</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.maxDrawdownAbs === "number" && Number.isFinite(advancedMetrics.maxDrawdownAbs)
                          ? advancedMetrics.maxDrawdownAbs.toFixed(2)
                          : "-"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-muted-foreground">Avg MFE</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.avgMfe === "number" && Number.isFinite(advancedMetrics.avgMfe)
                          ? `${(advancedMetrics.avgMfe * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-muted-foreground">Avg MAE</div>
                      <div className="font-semibold">
                        {typeof advancedMetrics.avgMae === "number" && Number.isFinite(advancedMetrics.avgMae)
                          ? `${(advancedMetrics.avgMae * 100).toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="border border-border rounded-md p-3 bg-background/40">
                      <div className="text-[10px] text-muted-foreground mb-2">Top Pairs (Profit)</div>
                      <div className="space-y-1">
                        {advancedMetrics.topPairsByProfit.length === 0 ? (
                          <div className="text-muted-foreground">-</div>
                        ) : (
                          advancedMetrics.topPairsByProfit.map((p) => (
                            <div key={`top-profit-${p.pair}`} className="flex items-center justify-between gap-2">
                              <div className="font-medium">{p.pair}</div>
                              <div className="text-muted-foreground">{p.trades} trades</div>
                              <div className="font-semibold">{p.profitAbs.toFixed(2)}</div>
                              <div className="text-muted-foreground">{(p.winRate * 100).toFixed(0)}%</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-border rounded-md p-3 bg-background/40">
                      <div className="text-[10px] text-muted-foreground mb-2">Bottom Pairs (Profit)</div>
                      <div className="space-y-1">
                        {advancedMetrics.bottomPairsByProfit.length === 0 ? (
                          <div className="text-muted-foreground">-</div>
                        ) : (
                          advancedMetrics.bottomPairsByProfit.map((p) => (
                            <div key={`bottom-profit-${p.pair}`} className="flex items-center justify-between gap-2">
                              <div className="font-medium">{p.pair}</div>
                              <div className="text-muted-foreground">{p.trades} trades</div>
                              <div className="font-semibold">{p.profitAbs.toFixed(2)}</div>
                              <div className="text-muted-foreground">{(p.winRate * 100).toFixed(0)}%</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-border rounded-md p-3 bg-background/40">
                      <div className="text-[10px] text-muted-foreground mb-2">Best Pairs (Win Rate)</div>
                      <div className="space-y-1">
                        {advancedMetrics.bestPairsByWinRate.length === 0 ? (
                          <div className="text-muted-foreground">-</div>
                        ) : (
                          advancedMetrics.bestPairsByWinRate.map((p) => (
                            <div key={`best-winrate-${p.pair}`} className="flex items-center justify-between gap-2">
                              <div className="font-medium">{p.pair}</div>
                              <div className="text-muted-foreground">{p.trades} trades</div>
                              <div className="font-semibold">{(p.winRate * 100).toFixed(0)}%</div>
                              <div className="text-muted-foreground">{p.profitAbs.toFixed(2)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border border-border rounded-md p-3 bg-background/40">
                      <div className="text-[10px] text-muted-foreground mb-2">Worst Pairs (Win Rate)</div>
                      <div className="space-y-1">
                        {advancedMetrics.worstPairsByWinRate.length === 0 ? (
                          <div className="text-muted-foreground">-</div>
                        ) : (
                          advancedMetrics.worstPairsByWinRate.map((p) => (
                            <div key={`worst-winrate-${p.pair}`} className="flex items-center justify-between gap-2">
                              <div className="font-medium">{p.pair}</div>
                              <div className="text-muted-foreground">{p.trades} trades</div>
                              <div className="font-semibold">{(p.winRate * 100).toFixed(0)}%</div>
                              <div className="text-muted-foreground">{p.profitAbs.toFixed(2)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Equity Curve Chart */}
            {widgetPrefs.find(w => w.id === 'chart')?.visible && (
              <Card className="border-border bg-card shadow-md" data-testid="widget-chart">
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base font-semibold">Equity Curve</CardTitle>
                    <CardDescription className="text-xs">Visualize strategy performance over time</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-secondary/30 p-1 rounded-md border border-border">
                      <Button 
                        variant={chartType === 'line' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-7 w-7" 
                        onClick={() => setChartType('line')}
                        title="Alt+1"
                      >
                        <LineChartIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button 
                        variant={chartType === 'area' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-7 w-7" 
                        onClick={() => setChartType('area')}
                        title="Alt+2"
                      >
                        <Activity className="h-3.5 w-3.5" />
                      </Button>
                      <Button 
                        variant={chartType === 'bar' ? 'secondary' : 'ghost'} 
                        size="icon" 
                        className="h-7 w-7" 
                        onClick={() => setChartType('bar')}
                        title="Alt+3"
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Badge 
                      variant={showSMA ? 'default' : 'outline'} 
                      className="cursor-pointer text-[10px] h-7"
                      onClick={() => setShowSMA(!showSMA)}
                      title="Alt+M"
                    >
                      SMA 20
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="h-[400px] pt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} opacity={0.5} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#666" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false} 
                        dy={10}
                      />
                      <YAxis 
                        stroke="#666" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(value) => `$${value}`}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1A1D23', 
                          border: '1px solid #31353C', 
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" />
                      
                      {chartType === 'area' && (
                        <Area 
                          name="Equity"
                          type="monotone" 
                          dataKey="value" 
                          stroke="#3B82F6" 
                          strokeWidth={2.5}
                          fillOpacity={1} 
                          fill="url(#colorValue)" 
                          activeDot={{ r: 5, fill: "#3B82F6", strokeWidth: 2, stroke: "#fff" }} 
                        />
                      )}
                      
                      {chartType === 'line' && (
                        <Line 
                          name="Equity"
                          type="monotone" 
                          dataKey="value" 
                          stroke="#3B82F6" 
                          strokeWidth={2.5} 
                          dot={false}
                          activeDot={{ r: 5, fill: "#3B82F6", strokeWidth: 2, stroke: "#fff" }} 
                        />
                      )}

                      {chartType === 'bar' && (
                        <Bar 
                          name="Equity"
                          dataKey="value" 
                          fill="#3B82F6" 
                          opacity={0.8}
                          radius={[4, 4, 0, 0]}
                        />
                      )}

                      {showSMA && (
                        <Line 
                          name="SMA 20"
                          type="monotone" 
                          dataKey="sma" 
                          stroke="#F59E0B" 
                          strokeWidth={1.5} 
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md mx-4 border-border bg-card shadow-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Keyboard Shortcuts</CardTitle>
                  <CardDescription>Press Alt + key to execute actions</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowShortcuts(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.key}
                    className="flex items-center justify-between p-3 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-primary/10 rounded border border-primary/20">
                      {getShortcutLabel(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatsCard({ title, value, subValue, icon: Icon, trend, "data-testid": testId }: { title: string, value: string, subValue: string, icon: any, trend?: "up" | "down", "data-testid"?: string }) {
  return (
    <Card className="border-border bg-card shadow-sm hover:shadow-md transition-shadow" data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col">
          <div className={`text-xl font-bold ${trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-foreground'}`}>
            {String(value)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{String(subValue)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Stake Amount Input Component with Presets
// Timerange Input Component with Date Picker

