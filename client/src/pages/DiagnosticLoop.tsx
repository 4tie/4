import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useFiles } from "@/hooks/use-files";
import { useGetConfig } from "@/hooks/use-config";
import { cn } from "@/lib/utils";

function fmtPct(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtNum(value: unknown, digits = 4): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

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

function getTodayDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.floor(days)));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getYearStartDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  return `${y}-01-01`;
}

function getDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - Math.max(0, Math.floor(years)));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildTimerangeFromDates(from?: string, to?: string): string {
  const toPart = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    return value.replace(/-/g, "");
  };
  const a = from ? toPart(String(from)) : "";
  const b = to ? toPart(String(to)) : "";
  return a || b ? `${a}-${b}` : "";
}

function prettyStopReason(value: unknown): string {
  const s = String(value || "");
  if (!s) return "-";
  const map: Record<string, string> = {
    edge_detected_5m: "Edge detected (5m)",
    edge_detected_15m: "Edge detected (15m)",
    no_edge_detected: "No edge detected (profit/CI/drawdown gates not met)",
    low_confidence: "Low confidence classification (stopped)",
    max_iterations_reached: "Max iterations reached",
    validation_failed: "Validation failed (guardrails) — rolled back",
    structural_fail: "Structural integrity failed (Phase 1)",
    backtest_failed: "Backtest failed (missing data/config error)",
    backtest_timeout: "Backtest timeout",
    backtest_missing: "Backtest record missing",
    stop_requested: "Stopped by user",
    internal_error: "Internal error",
  };
  return map[s] || s;
}

function ReportSection({ title, children }: { title: string; children: any }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = String(status || "").toLowerCase();
  if (s === "running") return "default";
  if (s === "queued") return "secondary";
  if (s === "completed") return "outline";
  if (s === "failed") return "destructive";
  if (s === "stopped") return "destructive";
  return "secondary";
}

export function DiagnosticLoopPage({ selectedStrategyPath }: { selectedStrategyPath?: string | null }) {
  const queryClient = useQueryClient();
  const { data: files } = useFiles();
  const { data: configData } = useGetConfig();

  const strategyFiles = useMemo(() => {
    const all = Array.isArray(files) ? files : [];
    return all
      .filter((f: any) => typeof f?.path === "string")
      .filter((f: any) => String(f.path).startsWith("user_data/strategies/") && String(f.path).endsWith(".py"))
      .map((f: any) => ({ path: String(f.path), name: String(f.path).split("/").pop() || String(f.path) }));
  }, [files]);

  const defaultStrategy = useMemo(() => {
    if (selectedStrategyPath && selectedStrategyPath.startsWith("user_data/strategies/") && selectedStrategyPath.endsWith(".py")) {
      return selectedStrategyPath;
    }
    return strategyFiles[0]?.path ?? "";
  }, [selectedStrategyPath, strategyFiles]);

  const [strategyPath, setStrategyPath] = useState<string>(defaultStrategy);

  useEffect(() => {
    if (!defaultStrategy) return;
    setStrategyPath((prev) => (prev && prev.trim() ? prev : defaultStrategy));
  }, [defaultStrategy]);

  const [stakeAmount, setStakeAmount] = useState<string>("100");
  const [timerangeOverride, setTimerangeOverride] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>(() => getDateDaysAgo(30));
  const [dateTo, setDateTo] = useState<string>(() => getTodayDate());
  const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
  const [extraPairs, setExtraPairs] = useState<string[]>([]);
  const [autoPickLimit, setAutoPickLimit] = useState<string>("10");
  const [maxIterations, setMaxIterations] = useState<string>("3");
  const [drawdownCap, setDrawdownCap] = useState<string>("0.2");
  const [ignoreCoverageWarnings, setIgnoreCoverageWarnings] = useState<boolean>(false);
  const [openDiffs, setOpenDiffs] = useState<Record<number, boolean>>({});

  const computedTimerange = useMemo(() => buildTimerangeFromDates(dateFrom, dateTo), [dateFrom, dateTo]);

  const effectiveTimerange = useMemo(() => {
    const override = String(timerangeOverride || "").trim();
    if (override) return override;
    return computedTimerange;
  }, [computedTimerange, timerangeOverride]);

  const availablePairs = useMemo(() => {
    const exchangePairs = (configData as any)?.exchange?.pair_whitelist;
    const pairlistPairs = (configData as any)?.pairlists?.[0]?.pair_whitelist;

    const fromConfig = [exchangePairs, pairlistPairs]
      .flatMap((p: any) => (Array.isArray(p) ? p : []))
      .map((p: any) => String(p))
      .filter((p: string) => p.trim().length > 0);

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of [...AVAILABLE_PAIRS, ...fromConfig, ...(Array.isArray(extraPairs) ? extraPairs : [])]) {
      if (seen.has(p)) continue;
      seen.add(p);
      merged.push(p);
    }

    return merged;
  }, [configData, extraPairs]);

  const autoPickPairsMutation = useMutation({
    mutationFn: async () => {
      const n = Number(autoPickLimit);
      const limit = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 10;
      const url = `/api/pairs/top-volume?limit=${encodeURIComponent(String(limit))}&quote=USDT`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.message || "Failed to auto-pick pairs");
      }
      return res.json() as Promise<{ pairs?: string[] }>;
    },
    onSuccess: (data) => {
      const pairs = Array.isArray((data as any)?.pairs) ? (data as any).pairs.map((p: any) => String(p)).filter(Boolean) : [];
      if (!pairs.length) return;
      setExtraPairs((prev) => {
        const curr = Array.isArray(prev) ? prev : [];
        const seen = new Set(curr);
        const next = [...curr];
        for (const p of pairs) {
          if (seen.has(p)) continue;
          seen.add(p);
          next.push(p);
        }
        return next;
      });
      setSelectedPairs(pairs);
      setIgnoreCoverageWarnings(false);
    },
  });

  const togglePair = (pair: string) => {
    setSelectedPairs((prev) => {
      const curr = Array.isArray(prev) ? [...prev] : [];
      const idx = curr.indexOf(pair);
      if (idx >= 0) curr.splice(idx, 1);
      else curr.push(pair);
      return curr;
    });
  };

  const selectAllPairs = () => setSelectedPairs([...availablePairs]);
  const deselectAllPairs = () => setSelectedPairs([]);

  const coverageQuery = useQuery({
    queryKey: ["/api/data/coverage", effectiveTimerange, selectedPairs.join(",")],
    enabled: selectedPairs.length > 0 && Boolean(effectiveTimerange),
    queryFn: async () => {
      const res = await fetch("/api/data/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pairs: selectedPairs,
          timeframes: ["5m", "15m"],
          timerange: effectiveTimerange,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.message || "Failed to check data coverage");
      }
      return res.json() as Promise<any>;
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });

  const coverageIssues = useMemo(() => {
    const data = coverageQuery.data;
    if (!data || !Array.isArray(data.items)) return { blocking: false, messages: [] as string[] };
    const items = data.items as any[];
    const missing = items.filter((x) => x && x.exists === false);
    const outOfRange = items.filter((x) => x && x.exists === true && x.coversRequested === false);

    const msgs: string[] = [];
    if (missing.length) {
      msgs.push(
        `Missing candle files for: ${missing
          .slice(0, 8)
          .map((x) => `${x.pair} (${x.timeframe})`)
          .join(", ")}${missing.length > 8 ? " …" : ""}`,
      );
    }
    if (outOfRange.length) {
      msgs.push(
        `Selected date range is outside available data for: ${outOfRange
          .slice(0, 8)
          .map((x) => {
            const range = x.firstDate && x.lastDate ? `available ${x.firstDate}→${x.lastDate}` : "";
            return `${x.pair} (${x.timeframe}) ${range}`.trim();
          })
          .join(", ")}${outOfRange.length > 8 ? " …" : ""}`,
      );
    }

    const blocking = missing.length > 0 || outOfRange.length > 0;
    return { blocking, messages: msgs };
  }, [coverageQuery.data]);

  const { data: runs } = useQuery({
    queryKey: [api.diagnosticLoop.runs.path],
    queryFn: async () => {
      const res = await fetch(api.diagnosticLoop.runs.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch diagnostic loop runs");
      return res.json() as Promise<any[]>;
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const [selectedRunId, setSelectedRunId] = useState<string>("");

  const selectedRun = useMemo(() => {
    const arr = Array.isArray(runs) ? runs : [];
    const id = selectedRunId || arr[0]?.id;
    if (!id) return null;
    return arr.find((r: any) => String(r?.id) === String(id)) ?? null;
  }, [runs, selectedRunId]);

  const runDetailsQuery = useQuery({
    queryKey: [api.diagnosticLoop.run.path, selectedRun?.id],
    enabled: Boolean(selectedRun?.id),
    queryFn: async () => {
      const url = buildUrl(api.diagnosticLoop.run.path, { runId: String(selectedRun?.id) });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch run");
      return res.json() as Promise<any>;
    },
    refetchInterval: (data: any) => {
      const s = String(data?.status || "").toLowerCase();
      return s === "running" || s === "queued" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const details = runDetailsQuery.data as any;

  const iterations = useMemo(() => {
    const arr = Array.isArray(details?.iterations) ? details.iterations : [];
    return arr;
  }, [details]);

  const finalReport = details?.report ?? null;
  const finalOutcome = String(finalReport?.outcome || details?.status || "-");
  const stopReason = prettyStopReason(finalReport?.stopReason ?? details?.stopReason);
  const backtestError = finalReport?.backtestError ?? null;
  const summary = finalReport?.summary ?? null;
  const reportIterations = Array.isArray(finalReport?.iterations) ? finalReport.iterations : [];

  const startMutation = useMutation({
    mutationFn: async () => {
      const maxIt = Number(maxIterations);
      const dd = Number(drawdownCap);
      const stake = Number(stakeAmount);
      const pairs = Array.isArray(selectedPairs) ? selectedPairs : [];

      if (!strategyPath) {
        throw new Error("Please select a strategy");
      }

      const baseConfig: any = {
        config: {
          timeframe: "5m",
          stake_amount: Number.isFinite(stake) ? stake : 100,
          ...(dateFrom ? { backtest_date_from: dateFrom } : {}),
          ...(dateTo ? { backtest_date_to: dateTo } : {}),
        },
      };

      const payload: any = {
        strategyPath,
        baseConfig,
        ...(effectiveTimerange ? { timerange: effectiveTimerange } : {}),
        ...(pairs.length ? { pairs } : {}),
        ...(Number.isFinite(maxIt) ? { maxIterations: maxIt } : {}),
        ...(Number.isFinite(dd) ? { drawdownCap: dd } : {}),
      };

      const res = await fetch(api.diagnosticLoop.start.path, {
        method: api.diagnosticLoop.start.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.message || "Failed to start run");
      }

      return res.json() as Promise<{ runId: string; status: string }>;
    },
    onSuccess: async (data) => {
      if (data?.runId) setSelectedRunId(String(data.runId));
      await queryClient.invalidateQueries({ queryKey: [api.diagnosticLoop.runs.path] }).catch(() => {});
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (runId: string) => {
      const url = buildUrl(api.diagnosticLoop.stop.path, { runId: String(runId) });
      const res = await fetch(url, {
        method: api.diagnosticLoop.stop.method,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.message || "Failed to stop run");
      }
      return res.json() as Promise<any>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [api.diagnosticLoop.run.path, selectedRun?.id] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: [api.diagnosticLoop.runs.path] }).catch(() => {});
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Start Diagnostic Loop</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Strategy</Label>
              <Select value={strategyPath} onValueChange={setStrategyPath}>
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {strategyFiles.map((f: any) => (
                    <SelectItem key={String(f.path)} value={String(f.path)}>
                      {String(f.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Stake Amount (USD)</Label>
                <Input value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} type="number" min="1" step="1" />
              </div>
              <div className="space-y-1">
                <Label>Max Iterations</Label>
                <Input value={maxIterations} onChange={(e) => setMaxIterations(e.target.value)} type="number" min="1" max="3" step="1" />
              </div>
            </div>

            {autoPickPairsMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Auto-pick failed</AlertTitle>
                <AlertDescription>{String((autoPickPairsMutation.error as any)?.message || "Unknown error")}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-1">
              <Label>Drawdown Cap</Label>
              <Input value={drawdownCap} onChange={(e) => setDrawdownCap(e.target.value)} type="number" min="0" max="1" step="0.01" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Date From (optional)</Label>
                <div className="space-y-2">
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    <Button type="button" variant={dateFrom === getDateDaysAgo(7) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getDateDaysAgo(7))}>
                      7d
                    </Button>
                    <Button type="button" variant={dateFrom === getDateDaysAgo(30) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getDateDaysAgo(30))}>
                      30d
                    </Button>
                    <Button type="button" variant={dateFrom === getDateDaysAgo(60) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getDateDaysAgo(60))}>
                      60d
                    </Button>
                    <Button type="button" variant={dateFrom === getDateDaysAgo(90) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getDateDaysAgo(90))}>
                      90d
                    </Button>
                    <Button type="button" variant={dateFrom === getYearStartDate() ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getYearStartDate())}>
                      YTD
                    </Button>
                    <Button type="button" variant={dateFrom === getDateYearsAgo(1) ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDateFrom(getDateYearsAgo(1))}>
                      1y
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Date To (optional)</Label>
                <div className="space-y-2">
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  <Button
                    type="button"
                    variant={dateTo === getTodayDate() ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs w-full"
                    onClick={() => setDateTo(getTodayDate())}
                  >
                    Today
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Timerange</Label>
              <Input value={computedTimerange} readOnly />
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <Label>Timerange Override (advanced, optional)</Label>
                <Input value={timerangeOverride} onChange={(e) => setTimerangeOverride(e.target.value)} placeholder="YYYYMMDD-YYYYMMDD" />
              </div>
              <div className="text-xs text-muted-foreground">
                Use this only if you want to manually force the exact timerange string sent to Freqtrade (e.g. to match a known format or troubleshoot date parsing).
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pairs Selection (optional)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={autoPickLimit}
                    onChange={(e) => setAutoPickLimit(e.target.value)}
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    className="h-6 w-[70px] px-2 text-[10px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => autoPickPairsMutation.mutate()}
                    disabled={autoPickPairsMutation.isPending}
                  >
                    {autoPickPairsMutation.isPending ? "Picking…" : "Auto-pick"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={selectAllPairs}>
                    Select All
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={deselectAllPairs}>
                    Deselect All
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 p-3 border border-border rounded-md bg-background/50 max-h-[120px] overflow-y-auto">
                {availablePairs.map((pair) => (
                  <Badge
                    key={pair}
                    variant={selectedPairs.includes(pair) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer transition-all hover:scale-105 active:scale-95",
                      !selectedPairs.includes(pair) && "text-muted-foreground opacity-60",
                    )}
                    onClick={() => togglePair(pair)}
                  >
                    {pair}
                  </Badge>
                ))}
              </div>
            </div>

            {selectedPairs.length === 0 ? (
              <Alert>
                <AlertTitle>No pairs selected</AlertTitle>
                <AlertDescription>The run will use pairs from your Freqtrade config (pair_whitelist).</AlertDescription>
              </Alert>
            ) : null}

            {selectedPairs.length > 0 ? (
              <div className="space-y-2">
                {coverageQuery.isLoading ? (
                  <Alert>
                    <AlertTitle>Checking data coverage…</AlertTitle>
                    <AlertDescription>Verifying 5m + 15m candles exist for the selected pairs and date range.</AlertDescription>
                  </Alert>
                ) : coverageIssues.messages.length ? (
                  <Alert variant="destructive">
                    <AlertTitle>Data coverage warning</AlertTitle>
                    <AlertDescription>
                      <div className="space-y-1">
                        {coverageIssues.messages.map((m, idx) => (
                          <div key={idx}>- {m}</div>
                        ))}
                        <div className="pt-2">
                          <Button
                            type="button"
                            variant={ignoreCoverageWarnings ? "default" : "outline"}
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setIgnoreCoverageWarnings((v) => !v)}
                          >
                            {ignoreCoverageWarnings ? "Warnings ignored (will run)" : "Ignore warnings and run anyway"}
                          </Button>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <AlertTitle>Data coverage OK</AlertTitle>
                    <AlertDescription>5m + 15m candles appear available for the selected pairs and date range.</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : null}

            <Button
              className="w-full"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !strategyPath || (coverageIssues.blocking && !ignoreCoverageWarnings)}
            >
              {startMutation.isPending ? "Starting..." : "Start Run"}
            </Button>

            {startMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Failed to start run</AlertTitle>
                <AlertDescription>{String((startMutation.error as any)?.message || "Unknown error")}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={selectedRun?.id ? String(selectedRun.id) : ""} onValueChange={setSelectedRunId}>
                <SelectTrigger className="max-w-[420px]">
                  <SelectValue placeholder="Select run" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(runs) ? runs : []).map((r: any) => (
                    <SelectItem key={String(r.id)} value={String(r.id)}>
                      {String(r.id).slice(0, 8)} • {String(r.status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedRun?.id ? (
                <Button variant="outline" onClick={() => stopMutation.mutate(String(selectedRun.id))} disabled={stopMutation.isPending}>
                  Stop
                </Button>
              ) : null}

              {selectedRun?.status ? <Badge variant={statusBadgeVariant(String(selectedRun.status))}>{String(selectedRun.status)}</Badge> : null}
            </div>

            {details ? (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  <div>
                    Strategy: <span className="text-foreground">{String(details.strategyPath)}</span>
                  </div>
                  <div>
                    Stop Reason: <span className="text-foreground">{details.stopReason ? prettyStopReason(details.stopReason) : "-"}</span>
                  </div>
                  <div>
                    Progress: <span className="text-foreground">{String(details?.progress?.stage || "-")}</span>
                    {details?.progress?.timeframe ? ` • ${String(details.progress.timeframe)}` : ""}
                    {details?.progress?.step ? ` • ${String(details.progress.step)}` : ""}
                    {typeof details?.progress?.percent === "number" ? ` • ${details.progress.percent}%` : ""}
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Iter</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Backtest</TableHead>
                      <TableHead>Failure</TableHead>
                      <TableHead>Conf</TableHead>
                      <TableHead>Profit</TableHead>
                      <TableHead>DD</TableHead>
                      <TableHead>CI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {iterations.map((it: any) => {
                      const edge = it?.validation?.edge;
                      return (
                        <TableRow key={String(it.id)}>
                          <TableCell>{it.iteration}</TableCell>
                          <TableCell>{String(it.stage)}</TableCell>
                          <TableCell>{String(it.timeframe)}</TableCell>
                          <TableCell>{it.backtestId != null ? String(it.backtestId) : "-"}</TableCell>
                          <TableCell>{it.failure ? String(it.failure) : "-"}</TableCell>
                          <TableCell>{it.confidence != null ? fmtNum(it.confidence, 2) : "-"}</TableCell>
                          <TableCell>{edge ? fmtPct(edge.profitTotal, 2) : "-"}</TableCell>
                          <TableCell>{edge ? fmtPct(edge.maxDrawdown, 2) : "-"}</TableCell>
                          <TableCell>{edge ? String(edge.phase9Verdict) : "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {iterations
                  .filter((it: any) => typeof it?.appliedDiff === "string" && String(it.appliedDiff).trim())
                  .map((it: any) => {
                    const open = Boolean(openDiffs[Number(it.id)]);
                    return (
                      <Collapsible
                        key={`diff-${String(it.id)}`}
                        open={open}
                        onOpenChange={(next) => setOpenDiffs((p) => ({ ...p, [Number(it.id)]: next }))}
                        className="border rounded-md"
                      >
                        <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span>
                              Diff (iter {it.iteration} • {String(it.timeframe)} • {String(it.stage)})
                            </span>
                          </div>
                          <Badge variant="outline">applied</Badge>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <pre className="p-3 text-xs overflow-auto whitespace-pre-wrap">{String(it.appliedDiff)}</pre>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}

                {finalReport ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Final Report</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusBadgeVariant(finalOutcome)}>{finalOutcome}</Badge>
                        <span className="text-sm text-muted-foreground">{stopReason}</span>
                      </div>

                      {backtestError ? (
                        <Alert variant="destructive">
                          <AlertTitle>Backtest issue</AlertTitle>
                          <AlertDescription>
                            <div className="space-y-2">
                              <div>
                                Timeframe: <span className="font-medium">{String(backtestError.timeframe || "-")}</span>
                                {backtestError.backtestId != null ? ` • Backtest: ${String(backtestError.backtestId)}` : ""}
                              </div>
                              <div className="whitespace-pre-wrap text-xs">{String(backtestError.message || "")}</div>
                              {Array.isArray(backtestError.logsTail) && backtestError.logsTail.length ? (
                                <Collapsible>
                                  <CollapsibleTrigger className="w-full flex items-center justify-between px-0 py-1 text-xs">
                                    <div className="flex items-center gap-2">
                                      <ChevronRight className="h-4 w-4" />
                                      <span>Show log tail</span>
                                    </div>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <pre className="p-2 text-[11px] overflow-auto whitespace-pre-wrap border rounded-md">{backtestError.logsTail.join("\n")}</pre>
                                  </CollapsibleContent>
                                </Collapsible>
                              ) : null}
                            </div>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {summary?.summary ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">What happened</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <ReportSection title="Primary loss driver">{String(summary.summary.primaryLossDriver || "-")}</ReportSection>
                              <ReportSection title="Secondary issue">{String(summary.summary.secondaryIssue || "-")}</ReportSection>
                              <ReportSection title="Regime">{String(summary.summary.regimeFailure || "-")}</ReportSection>
                              <ReportSection title="Asset risk">{String(summary.summary.assetRisk || "-")}</ReportSection>
                              <ReportSection title="Statistics">{String(summary.summary.statisticalVerdict || "-")}</ReportSection>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">Suggested next steps</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {Array.isArray(summary.summary.suggestedFixes) && summary.summary.suggestedFixes.length ? (
                                <div className="space-y-1">
                                  {summary.summary.suggestedFixes.map((s: any, idx: number) => (
                                    <div key={idx} className="text-sm text-muted-foreground">
                                      - {String(s)}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground">-</div>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      ) : null}

                      {summary?.signals ? (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Signals</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <ReportSection title="Primary">{String(summary.signals.primaryFailureReason || "-")}</ReportSection>
                            {Array.isArray(summary.signals.secondaryIssues) && summary.signals.secondaryIssues.length ? (
                              <ReportSection title="Secondary">
                                <div className="space-y-1">
                                  {summary.signals.secondaryIssues.slice(0, 6).map((s: any, idx: number) => (
                                    <div key={idx}>- {String(s)}</div>
                                  ))}
                                </div>
                              </ReportSection>
                            ) : null}
                            {Array.isArray(summary.signals.recommendedChangeTypes) && summary.signals.recommendedChangeTypes.length ? (
                              <ReportSection title="Recommended focus">
                                <div className="flex flex-wrap gap-1">
                                  {summary.signals.recommendedChangeTypes.slice(0, 10).map((s: any) => (
                                    <Badge key={String(s)} variant="outline">
                                      {String(s)}
                                    </Badge>
                                  ))}
                                </div>
                              </ReportSection>
                            ) : null}
                          </CardContent>
                        </Card>
                      ) : null}

                      {reportIterations.length ? (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Loop decision trail</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {reportIterations.map((it: any, idx: number) => (
                              <div key={idx} className="border rounded-md p-3">
                                <div className="text-sm font-medium">Iteration {String(it.iteration)}</div>
                                <div className="text-xs text-muted-foreground">
                                  Failure: {String(it.failure || "-")} • Confidence: {fmtNum(it.confidence, 2)}
                                </div>
                                {it?.baselineEdge ? (
                                  <div className="text-xs text-muted-foreground mt-2">
                                    Profit: {fmtPct(it.baselineEdge.profitTotal, 2)} • Drawdown: {fmtPct(it.baselineEdge.maxDrawdown, 2)} • Phase9: {String(it.baselineEdge.phase9Verdict)}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Select a run to view details.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
