import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useBacktests } from "@/hooks/use-backtests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DiagnosticReportView } from "@/components/diagnostic/DiagnosticReportView";
import { AIActionTimeline } from "@/components/ai/AIActionTimeline";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DiagnosticsPageProps = {
  selectedStrategyName?: string | null;
  placement: "header" | "sidebar";
  onPlacementChange: (next: "header" | "sidebar") => void;
  onOpenChat: () => void;
};

type DerivedTradeMetrics = {
  totalTrades: number;
  winners: number;
  losers: number;
  expectancy?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  profitFactor?: number | null;
  winLossRatio?: number | null;
  avgTradeDurationMin?: number | null;
  tradesPerDay?: number | null;
  units: "ratio" | "abs";
  coverageRatio: number;
};

const toNum = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

const computeDerivedTradeMetrics = (tradesRaw: any[]): DerivedTradeMetrics | null => {
  if (!Array.isArray(tradesRaw) || tradesRaw.length === 0) return null;
  const trades = tradesRaw.filter((t) => t && typeof t === "object");
  if (!trades.length) return null;

  const ratios = trades.map((t) => toNum(t.profit_ratio)).filter((v) => Number.isFinite(v));
  const abs = trades.map((t) => toNum(t.profit_abs)).filter((v) => Number.isFinite(v));
  const useRatios = ratios.length >= Math.max(3, Math.floor(trades.length * 0.5));
  const profits = useRatios ? ratios : abs;
  if (!profits.length) {
    return { totalTrades: trades.length, winners: 0, losers: 0, units: "ratio", coverageRatio: 0 };
  }

  const winners = profits.filter((v) => v > 0);
  const losers = profits.filter((v) => v < 0);
  const sum = profits.reduce((a, b) => a + b, 0);
  const sumWins = winners.reduce((a, b) => a + b, 0);
  const sumLoss = losers.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const durationsMin: number[] = [];
  for (const t of trades) {
    const open = Date.parse(String(t.open_date ?? t.open_date_utc ?? ""));
    const close = Date.parse(String(t.close_date ?? t.close_date_utc ?? ""));
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const mins = (close - open) / 60000;
    if (Number.isFinite(mins) && mins >= 0) durationsMin.push(mins);
  }

  let tradesPerDay: number | null = null;
  const times = trades
    .flatMap((t) => [
      Date.parse(String(t.open_date ?? t.open_date_utc ?? "")),
      Date.parse(String(t.close_date ?? t.close_date_utc ?? "")),
    ])
    .filter((v) => Number.isFinite(v));
  if (times.length) {
    const minTs = Math.min(...times);
    const maxTs = Math.max(...times);
    const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(spanDays) && spanDays > 0) {
      tradesPerDay = trades.length / spanDays;
    }
  }

  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    expectancy: profits.length ? sum / profits.length : null,
    avgWin: avg(winners),
    avgLoss: avg(losers),
    profitFactor: sumLoss < 0 ? sumWins / Math.abs(sumLoss) : null,
    winLossRatio: avg(winners) != null && avg(losers) != null && avg(losers)! !== 0 ? (avg(winners)! / Math.abs(avg(losers)!)) : null,
    avgTradeDurationMin: durationsMin.length ? avg(durationsMin) : null,
    tradesPerDay,
    units: useRatios ? "ratio" : "abs",
    coverageRatio: profits.length / trades.length,
  };
};

const fmtPct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "N/A" : v.toFixed(digits);

export function DiagnosticsPage({
  selectedStrategyName,
  placement,
  onPlacementChange,
  onOpenChat,
}: DiagnosticsPageProps) {
  const { data: backtests } = useBacktests();
  const completedBacktests = (backtests || []).filter((b: any) => String(b.status) === "completed");
  const filteredBacktests = selectedStrategyName
    ? completedBacktests.filter((b: any) => b.strategyName === selectedStrategyName)
    : completedBacktests;

  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(() => {
    const latest = filteredBacktests[0];
    return latest?.id ?? null;
  });

  useEffect(() => {
    if (selectedBacktestId == null && filteredBacktests.length > 0) {
      setSelectedBacktestId(filteredBacktests[0].id);
    }
  }, [filteredBacktests, selectedBacktestId]);

  useEffect(() => {
    if (!selectedStrategyName) return;
    const first = filteredBacktests[0];
    if (first && first.id !== selectedBacktestId) {
      setSelectedBacktestId(first.id);
    }
  }, [selectedStrategyName, filteredBacktests, selectedBacktestId]);

  const selectedBacktest = useMemo(() => {
    if (!selectedBacktestId) return null;
    return filteredBacktests.find((b: any) => b.id === selectedBacktestId) || null;
  }, [filteredBacktests, selectedBacktestId]);

  const { data: jobs } = useQuery({
    queryKey: ["/api/diagnostic/jobs", selectedBacktestId],
    queryFn: async () => {
      const q = selectedBacktestId ? `?backtestId=${selectedBacktestId}` : "";
      const res = await fetch(`/api/diagnostic/jobs${q}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: reports } = useQuery({
    queryKey: ["/api/diagnostic/reports", selectedBacktestId],
    queryFn: async () => {
      if (selectedBacktestId) {
        const res = await fetch(`/api/diagnostic/reports/${selectedBacktestId}`);
        if (!res.ok) return [];
        return res.json();
      }
      const res = await fetch("/api/diagnostic/reports");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const latestReport = reports?.[0]?.report;

  const { data: aiActions } = useQuery({
    queryKey: ["/api/backtests/ai-actions", selectedBacktestId],
    enabled: Boolean(selectedBacktestId),
    queryFn: async () => {
      if (!selectedBacktestId) return [];
      const res = await fetch(`/api/backtests/${selectedBacktestId}/ai-actions`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: selectedBacktestFull } = useQuery({
    queryKey: ["/api/backtests", selectedBacktestId],
    enabled: Boolean(selectedBacktestId),
    queryFn: async () => {
      if (!selectedBacktestId) return null;
      const res = await fetch(`/api/backtests/${selectedBacktestId}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const derived = useMemo(() => {
    const trades = (selectedBacktestFull as any)?.results?.trades;
    return computeDerivedTradeMetrics(Array.isArray(trades) ? trades : []);
  }, [selectedBacktestFull]);

  const evidenceRows = useMemo(() => {
    const rows: Array<{ metric: string; value: string; evidence: string; recommendation: string; confidence: number }> = [];
    const res = (selectedBacktestFull as any)?.results;
    const profitTotal = toNum(res?.profit_total);
    const winRate = toNum(res?.win_rate);
    const maxDrawdown = toNum(res?.max_drawdown);
    const totalTrades = toNum(res?.total_trades);

    const tradesCount = Number.isFinite(totalTrades) && totalTrades > 0
      ? totalTrades
      : (derived?.totalTrades ?? 0);
    const coverageRatio = derived?.coverageRatio ?? 0;

    const calcConfidence = (hasDerived: boolean) => {
      let score = 0.5;
      if (tradesCount >= 200) score += 0.3;
      else if (tradesCount >= 100) score += 0.25;
      else if (tradesCount >= 30) score += 0.15;
      else score -= 0.15;

      if (coverageRatio >= 0.8) score += 0.2;
      else if (coverageRatio >= 0.5) score += 0.1;
      else if (coverageRatio > 0) score -= 0.05;

      if (hasDerived) score += 0.05;
      if (!Number.isFinite(tradesCount) || tradesCount <= 0) score -= 0.2;

      score = Math.max(0.1, Math.min(0.95, score));
      return Math.round(score * 100);
    };

    if (Number.isFinite(profitTotal)) {
      rows.push({
        metric: "Total Profit",
        value: fmtPct(profitTotal),
        evidence: profitTotal >= 0 ? "Positive overall return" : "Negative overall return",
        recommendation: profitTotal >= 0 ? "Focus on stability and drawdown control" : "Improve edge (entries/exits) before optimization",
        confidence: calcConfidence(false),
      });
    }
    if (Number.isFinite(maxDrawdown)) {
      rows.push({
        metric: "Max Drawdown",
        value: fmtPct(maxDrawdown),
        evidence: maxDrawdown > 0.2 ? "High drawdown risk" : "Drawdown within moderate range",
        recommendation: maxDrawdown > 0.2 ? "Tighten stops or reduce exposure" : "Monitor risk; optimize for smoother equity",
        confidence: calcConfidence(false),
      });
    }
    if (Number.isFinite(winRate)) {
      rows.push({
        metric: "Win Rate",
        value: fmtPct(winRate),
        evidence: winRate < 0.4 ? "Low win rate" : "Reasonable win rate",
        recommendation: winRate < 0.4 ? "Improve entry quality or risk-reward balance" : "Maintain edge, improve payoff ratio",
        confidence: calcConfidence(false),
      });
    }
    if (Number.isFinite(totalTrades)) {
      rows.push({
        metric: "Total Trades",
        value: String(totalTrades),
        evidence: totalTrades < 30 ? "Low statistical confidence" : "Sample size is usable",
        recommendation: totalTrades < 30 ? "Increase sample size (longer range or more pairs)" : "Proceed with controlled tuning",
        confidence: calcConfidence(false),
      });
    }
    if (derived) {
      rows.push({
        metric: "Expectancy",
        value: derived.units === "ratio" ? fmtPct(derived.expectancy) : fmtNum(derived.expectancy),
        evidence: (derived.expectancy ?? 0) < 0 ? "Negative expectancy" : "Positive expectancy",
        recommendation: (derived.expectancy ?? 0) < 0 ? "Cut large losers / improve entry filters" : "Optimize exits to raise payoff",
        confidence: calcConfidence(true),
      });
      rows.push({
        metric: "Profit Factor",
        value: fmtNum(derived.profitFactor, 2),
        evidence: (derived.profitFactor ?? 0) < 1.2 ? "Weak risk/reward" : "Acceptable risk/reward",
        recommendation: (derived.profitFactor ?? 0) < 1.2 ? "Increase avg win or reduce avg loss" : "Incremental tuning only",
        confidence: calcConfidence(true),
      });
      if (derived.tradesPerDay != null) {
        rows.push({
          metric: "Trades/Day",
          value: fmtNum(derived.tradesPerDay, 2),
          evidence: derived.tradesPerDay < 0.2 ? "Very low trading frequency" : "Healthy trading frequency",
          recommendation: derived.tradesPerDay < 0.2 ? "Loosen filters or add pairs" : "Avoid over-trading; keep quality",
          confidence: calcConfidence(true),
        });
      }
      if (derived.avgTradeDurationMin != null) {
        rows.push({
          metric: "Avg Trade Duration",
          value: `${fmtNum(derived.avgTradeDurationMin, 1)} min`,
          evidence: derived.avgTradeDurationMin > 1440 ? "Very long holding time" : "Holding time within normal range",
          recommendation: derived.avgTradeDurationMin > 1440 ? "Consider tighter exits or timeframe alignment" : "No major change needed",
          confidence: calcConfidence(true),
        });
      }
    }

    const failureSignals = latestReport?.phase11?.failureSignals;
    if (failureSignals?.recommendedChangeTypes?.length) {
      rows.push({
        metric: "Diagnostic Signals",
        value: String(failureSignals.mainKillerMetric || "signal"),
        evidence: failureSignals.primaryFailureReason || "Diagnostic risk detected",
        recommendation: failureSignals.recommendedChangeTypes.slice(0, 3).join(", "),
        confidence: calcConfidence(true),
      });
    }

    return rows;
  }, [selectedBacktestFull, derived, latestReport]);

  const runDiagnosticMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBacktestId) throw new Error("Select a backtest first");
      const res = await fetch("/api/diagnostic/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backtestId: selectedBacktestId,
          strategyPath: selectedBacktest?.strategyName,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to queue diagnostics");
      }
      return res.json();
    },
    onSuccess: async (data: any) => {
      const jobId = data?.jobId;
      if (selectedBacktestId) {
        await fetch("/api/ai-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionType: "diagnostic_run",
            description: `Diagnostics queued (job ${jobId})`,
            backtestId: selectedBacktestId,
          }),
        }).catch(() => {});
      }
    },
  });

  const handleAttachToChat = () => {
    if (!latestReport) return;
    const summary = latestReport?.summary;
    const text = [
      "Diagnostic Summary:",
      `- Verdict: ${summary?.statisticalVerdict || "-"}`,
      `- Primary Loss Driver: ${summary?.primaryLossDriver || "-"}`,
      `- Secondary Issue: ${summary?.secondaryIssue || "-"}`,
      `- Regime Failure: ${summary?.regimeFailure || "-"}`,
      `- Asset Risk: ${summary?.assetRisk || "-"}`,
      "",
      "Suggested Fixes:",
      ...(Array.isArray(summary?.suggestedFixes) ? summary.suggestedFixes.map((s: string) => `- ${s}`) : ["- None"]),
    ].join("\n");

    window.dispatchEvent(new CustomEvent("attach-diagnostic-summary", { detail: text }));
    onOpenChat();
  };

  const handleSendToFixDesign = async () => {
    if (!latestReport) return;
    const runId = (globalThis.crypto as any)?.randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const envelope = {
      runId,
      agentId: "diagnostic",
      createdAt: new Date().toISOString(),
      inputs: {
        backtestId: selectedBacktestId,
        strategyPath: selectedBacktest?.strategyName,
      },
      artifacts: {
        diagnosticReportId: reports?.[0]?.id,
        diagnosticSummary: JSON.stringify(latestReport?.summary || {}),
        evidenceIndex: [],
        recommendedChangeTypes: latestReport?.phase11?.failureSignals?.recommendedChangeTypes || [],
      },
      aiActions: [],
      constraints: {
        productionSafe: true,
        maxLeverage: 1,
        allowLookAhead: false,
      },
      next: {
        recommendedNextAgent: "fix_design",
        questionsForNextAgent: [],
      },
    };

    await fetch("/api/agent-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        agentId: "diagnostic",
        envelope,
      }),
    }).catch(() => {});

    if (selectedBacktestId) {
      await fetch("/api/ai-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "analysis",
          description: "Sent diagnostic report to Fix Design agent",
          backtestId: selectedBacktestId,
          results: { runId },
        }),
      }).catch(() => {});
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Diagnostics</h1>
          <p className="text-sm text-muted-foreground">Run diagnostics, track jobs, and review reports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Placement: {placement}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPlacementChange(placement === "header" ? "sidebar" : "header")}
          >
            Preview {placement === "header" ? "Sidebar" : "Header"} Placement
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Backtest</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select
            value={selectedBacktestId ? String(selectedBacktestId) : ""}
            onValueChange={(v) => setSelectedBacktestId(Number(v))}
          >
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select a completed backtest" />
            </SelectTrigger>
            <SelectContent>
              {filteredBacktests.map((b: any) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.strategyName.split("/").pop()} (#{b.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => runDiagnosticMutation.mutate()}
            disabled={!selectedBacktestId || runDiagnosticMutation.isPending}
          >
            {runDiagnosticMutation.isPending ? "Queueing..." : "Run Diagnostic"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(jobs || []).length === 0 && <div className="text-sm text-muted-foreground">No jobs yet.</div>}
            {(jobs || []).map((job: any) => (
              <div key={job.id} className="p-2 rounded border border-border/40 bg-muted/40">
                <div className="flex items-center justify-between text-xs">
                  <span>Job {String(job.id).slice(0, 8)}</span>
                  <Badge variant="outline">{job.status}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Phase: {job.progress?.currentPhase || "queued"} · {job.progress?.percent ?? 0}%
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest Report</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleAttachToChat} disabled={!latestReport}>
                Discuss in Chat
              </Button>
              <Button size="sm" variant="outline" onClick={handleSendToFixDesign} disabled={!latestReport}>
                Send to Fix Design Agent
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {latestReport ? (
              <DiagnosticReportView report={latestReport} />
            ) : (
              <div className="text-sm text-muted-foreground">No diagnostic reports yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Derived Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {derived ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Expectancy</div>
                  <div className="text-sm font-semibold">
                    {derived.units === "ratio" ? fmtPct(derived.expectancy) : fmtNum(derived.expectancy)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Profit Factor</div>
                  <div className="text-sm font-semibold">{fmtNum(derived.profitFactor, 2)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Avg Win</div>
                  <div className="text-sm font-semibold">
                    {derived.units === "ratio" ? fmtPct(derived.avgWin) : fmtNum(derived.avgWin)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Avg Loss</div>
                  <div className="text-sm font-semibold">
                    {derived.units === "ratio" ? fmtPct(derived.avgLoss) : fmtNum(derived.avgLoss)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Win/Loss Ratio</div>
                  <div className="text-sm font-semibold">{fmtNum(derived.winLossRatio, 2)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Trades/Day</div>
                  <div className="text-sm font-semibold">{fmtNum(derived.tradesPerDay, 2)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Avg Duration</div>
                  <div className="text-sm font-semibold">
                    {derived.avgTradeDurationMin != null ? `${fmtNum(derived.avgTradeDurationMin, 1)} min` : "N/A"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Coverage</div>
                  <div className="text-sm font-semibold">{fmtNum(derived.coverageRatio * 100, 0)}%</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No trade data available to compute derived metrics.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Evidence Table</CardTitle>
          </CardHeader>
          <CardContent>
            {evidenceRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidenceRows.map((row, idx) => (
                    <TableRow key={`${row.metric}-${idx}`}>
                      <TableCell className="text-xs font-medium">{row.metric}</TableCell>
                      <TableCell className="text-xs">{row.value}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.evidence}</TableCell>
                      <TableCell className="text-xs">{row.recommendation}</TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          className={
                            row.confidence >= 80
                              ? "border-green-500 text-green-600"
                              : row.confidence >= 55
                                ? "border-yellow-500 text-yellow-600"
                                : "border-red-500 text-red-600"
                          }
                        >
                          {row.confidence}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-sm text-muted-foreground">No evidence rows available yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Action Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {Array.isArray(aiActions) && aiActions.length > 0 ? (
            <AIActionTimeline actions={aiActions} />
          ) : (
            <div className="text-sm text-muted-foreground">No AI actions logged yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
