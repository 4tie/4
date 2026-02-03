import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart, 
  PieChart, 
  Info,
  CheckCircle2,
  AlertCircle,
  Activity,
  Calendar,
  ShieldCheck,
  Search,
  MessageSquare,
  DollarSign,
  Target,
  List,
  Grid,
  Download,
  FileJson,
  FileSpreadsheet
} from "lucide-react";
import { 
  BarChart as ReBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area
} from "recharts";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAIStore } from "@/hooks/use-ai";
import { DiagnosticReportView } from "./diagnostic/DiagnosticReportView";
import type { DiagnosticReport } from "@shared/schema";

interface BacktestResultsProps {
  backtestId: number;
  strategyName: string;
  stakeAmount?: number;
  results: {
    total_trades: number;
    win_rate: number | string;
    profit_total: number | string;
    profit_abs_total?: number | string;
    start_balance?: number | string;
    end_balance?: number | string;
    max_drawdown: number | string;
    trades: Array<{
      pair: string;
      profit_ratio: number | string;
      open_date: string;
      close_date: string;
      open_rate?: number;
      close_rate?: number;
      enter_tag?: string;
      exit_reason?: string;
      stake_amount?: number;
      amount?: number;
      equity_before?: number;
      equity_after?: number;
      profit_abs?: number;
    }>;
  };
}

export function BacktestResults({ backtestId, strategyName, stakeAmount, results }: BacktestResultsProps) {
  const { toast } = useToast();
  const { selectedModel } = useAIStore();
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "trades" | "pairs" | "analysis" | "heatmap">("overview");

  const diagnosticMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/diagnostic/analyze", {
        backtestId,
        strategyPath: strategyName
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/diagnostic/reports/${backtestId}`] });
      setShowDiagnostic(true);
      toast({
        title: "Diagnostic Queued",
        description: "The diagnostic job is running. Open Diagnostics for progress.",
      });
      fetch("/api/ai-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "diagnostic_run",
          description: `Diagnostics queued for backtest ${backtestId}`,
          backtestId,
        }),
      }).catch(() => {});
    },
    onError: (error: any) => {
      toast({
        title: "Diagnostic Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const { data: reports } = useQuery<DiagnosticReport[]>({
    queryKey: [`/api/diagnostic/reports/${backtestId}`],
    enabled: !!backtestId,
    refetchInterval: 3000,
  });

  const latestReport = reports?.[0]?.report;
  const hasLatestReport = Boolean(latestReport);
  const toNum = (value: unknown) => {
    const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };

  const startBalance = (() => {
    const v = toNum((results as any)?.start_balance);
    if (Number.isFinite(v)) return v;
    const s = toNum(stakeAmount);
    return Number.isFinite(s) && s > 0 ? s : 1000;
  })();

  const profitTotal = toNum((results as any)?.profit_total);
  const profitAbsTotal = (() => {
    const v = toNum((results as any)?.profit_abs_total);
    if (Number.isFinite(v)) return v;
    return Number.isFinite(profitTotal) ? startBalance * profitTotal : 0;
  })();

  const endBalance = (() => {
    const v = toNum((results as any)?.end_balance);
    if (Number.isFinite(v)) return v;
    return startBalance + profitAbsTotal;
  })();

  const profitNum = Number.isFinite(profitTotal) ? profitTotal : 0;
  const isProfitable = profitNum >= 0;

  const computedTrades = useMemo(() => {
    let equity = startBalance;
    return results.trades.map((t) => {
      const profitRatio = toNum(t.profit_ratio);
      const open = t.open_date ? new Date(t.open_date) : null;
      const close = t.close_date ? new Date(t.close_date) : null;
      const durationMs = open && close ? Math.max(0, close.getTime() - open.getTime()) : 0;

      const equityBefore = Number.isFinite(toNum((t as any)?.equity_before)) ? toNum((t as any).equity_before) : equity;
      const profitAbs = Number.isFinite(toNum((t as any)?.profit_abs)) ? toNum((t as any).profit_abs) : equityBefore * profitRatio;
      const equityAfter = Number.isFinite(toNum((t as any)?.equity_after)) ? toNum((t as any).equity_after) : equityBefore * (1 + profitRatio);

      equity = equityAfter;

      return {
        ...t,
        _profitRatio: profitRatio,
        _profitPct: profitRatio * 100,
        _profitAbs: profitAbs,
        _equityBefore: equityBefore,
        _equityAfter: equityAfter,
        _durationMs: durationMs,
      };
    });
  }, [results.trades, startBalance, toNum]);

  const pairStats = useMemo(() => {
    const map = new Map<string, {
      pair: string;
      trades: number;
      wins: number;
      profitAbs: number;
      profitPct: number;
      durationMs: number;
    }>();

    for (const tr of computedTrades) {
      const pair = String(tr.pair || "-");
      const curr = map.get(pair) || { pair, trades: 0, wins: 0, profitAbs: 0, profitPct: 0, durationMs: 0 };
      curr.trades += 1;
      if (tr._profitRatio > 0) curr.wins += 1;
      curr.profitAbs += tr._profitAbs;
      curr.profitPct += tr._profitPct;
      curr.durationMs += tr._durationMs;
      map.set(pair, curr);
    }

    return Array.from(map.values()).sort((a, b) => b.profitAbs - a.profitAbs);
  }, [computedTrades]);

  // Process data for charts
  const tradeData = computedTrades.map((t, i) => ({
    name: `T${i + 1}`,
    profit: t._profitPct,
    pair: t.pair
  }));

  // Calculate cumulative equity curve
  let cumulative = startBalance;
  const equityData = computedTrades.map((t, i) => {
    cumulative = t._equityAfter;
    return {
      name: `Trade ${i + 1}`,
      equity: cumulative,
      date: new Date(t.close_date).toLocaleDateString()
    };
  });

  // Calculate additional analysis
  const winners = computedTrades.filter(t => t._profitRatio > 0);
  const losers = computedTrades.filter(t => t._profitRatio < 0);
  const breakeven = computedTrades.filter(t => t._profitRatio === 0);
  const avgProfit = winners.length > 0 ? winners.reduce((sum, t) => sum + t._profitRatio, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((sum, t) => sum + t._profitRatio, 0) / losers.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? (avgProfit * winners.length) / (Math.abs(avgLoss) * losers.length) : winners.length > 0 ? Infinity : 0;
  const expectancy = computedTrades.length > 0
    ? computedTrades.reduce((sum, t) => sum + t._profitRatio, 0) / computedTrades.length
    : 0;
  const winLossRatio = Math.abs(avgLoss) > 0 ? avgProfit / Math.abs(avgLoss) : 0;
  const avgTradeDurationMin =
    computedTrades.length > 0
      ? computedTrades.reduce((sum, t) => sum + t._durationMs, 0) / computedTrades.length / 60000
      : 0;
  const tradesPerDay = (() => {
    if (computedTrades.length === 0) return 0;
    const times: number[] = [];
    for (const t of computedTrades) {
      const open = t.open_date ? new Date(t.open_date).getTime() : NaN;
      const close = t.close_date ? new Date(t.close_date).getTime() : NaN;
      if (Number.isFinite(open)) times.push(open);
      if (Number.isFinite(close)) times.push(close);
    }
    if (!times.length) return 0;
    const minTs = Math.min(...times);
    const maxTs = Math.max(...times);
    const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(spanDays) || spanDays <= 0) return 0;
    return computedTrades.length / spanDays;
  })();

  const insightItems = useMemo(() => {
    const items: Array<{ tone: "good" | "warn" | "bad"; text: string }> = [];
    const total = computedTrades.length;
    if (total === 0) return items;

    const dd = toNum(results.max_drawdown);
    const ddPct = Number.isFinite(dd) ? dd * 100 : 0;

    const winnersCount = computedTrades.reduce((acc, t) => acc + (t._profitAbs > 0 ? 1 : 0), 0);
    const losersCount = computedTrades.reduce((acc, t) => acc + (t._profitAbs < 0 ? 1 : 0), 0);
    const winRate = total > 0 ? winnersCount / total : 0;

    const grossProfit = computedTrades.reduce((acc, t) => acc + (t._profitAbs > 0 ? t._profitAbs : 0), 0);
    const grossLoss = computedTrades.reduce((acc, t) => acc + (t._profitAbs < 0 ? Math.abs(t._profitAbs) : 0), 0);

    if (isProfitable) {
      items.push({
        tone: "good",
        text: `Profitable overall (+${(profitNum * 100).toFixed(2)}%). ${Number.isFinite(dd) ? `Max drawdown was ${ddPct.toFixed(2)}%.` : ""}`.trim(),
      });
    } else {
      items.push({
        tone: "bad",
        text: `Unprofitable overall (${(profitNum * 100).toFixed(2)}%). ${Number.isFinite(dd) ? `Max drawdown reached ${ddPct.toFixed(2)}%.` : ""}`.trim(),
      });
    }

    if (total < 30) {
      items.push({
        tone: "warn",
        text: `Low sample size (${total} trades). Results may not be reliable; run a longer timerange or more pairs.`
      });
    }

    if (Number.isFinite(dd) && dd >= 0.25) {
      items.push({
        tone: "warn",
        text: `High drawdown (${ddPct.toFixed(2)}%). Consider tightening stoploss, reducing leverage/exposure, or adding filters to avoid bad regimes.`
      });
    }

    if (grossProfit > 0) {
      const topWinners = computedTrades
        .filter((t) => t._profitAbs > 0)
        .slice()
        .sort((a, b) => b._profitAbs - a._profitAbs);
      const top3Profit = topWinners.slice(0, 3).reduce((acc, t) => acc + t._profitAbs, 0);
      const share = top3Profit / grossProfit;
      if (share >= 0.75 && topWinners.length >= 3) {
        items.push({
          tone: "warn",
          text: `Profit concentration: top 3 winning trades contribute ${(share * 100).toFixed(0)}% of total profits. Watch for overfitting or reliance on rare moves.`
        });
      }
    }

    if (grossLoss > 0) {
      const topLosers = computedTrades
        .filter((t) => t._profitAbs < 0)
        .slice()
        .sort((a, b) => a._profitAbs - b._profitAbs);
      const top3Loss = topLosers.slice(0, 3).reduce((acc, t) => acc + Math.abs(t._profitAbs), 0);
      const share = top3Loss / grossLoss;
      if (share >= 0.6 && topLosers.length >= 3) {
        items.push({
          tone: "warn",
          text: `Loss concentration: top 3 losing trades contribute ${(share * 100).toFixed(0)}% of total losses. Consider tighter risk limits per trade (stoploss / max duration).`
        });
      }
    }

    const worstPair = (() => {
      if (!pairStats.length) return null;
      const last = pairStats[pairStats.length - 1];
      return last && last.profitAbs < 0 ? last : null;
    })();

    if (worstPair && grossLoss > 0) {
      const lossShare = Math.abs(worstPair.profitAbs) / grossLoss;
      if (lossShare >= 0.4) {
        items.push({
          tone: "warn",
          text: `Pair issue: ${worstPair.pair} is driving ${(lossShare * 100).toFixed(0)}% of total losses. Consider filtering/blacklisting this pair or adjusting entry rules for it.`
        });
      } else {
        items.push({
          tone: "warn",
          text: `Some pairs are losing (worst: ${worstPair.pair}). Consider per-pair filters or a blacklist to avoid persistent underperformers.`
        });
      }
    }

    if (isProfitable && winRate < 0.35) {
      items.push({
        tone: "warn",
        text: `Low win rate (${(winRate * 100).toFixed(1)}%) but still profitable. This usually means the strategy relies on a few large winners; watch for long losing streaks.`
      });
    }

    if (!isProfitable && winRate > 0.55) {
      items.push({
        tone: "warn",
        text: `High win rate (${(winRate * 100).toFixed(1)}%) but losing overall. Losses are bigger than gains; consider tightening stoploss and letting winners run longer.`
      });
    }

    let losingStreak = 0;
    let maxLosingStreak = 0;
    for (const t of computedTrades) {
      if (t._profitAbs < 0) {
        losingStreak += 1;
        if (losingStreak > maxLosingStreak) maxLosingStreak = losingStreak;
      } else {
        losingStreak = 0;
      }
    }
    if (maxLosingStreak >= 5) {
      items.push({
        tone: "warn",
        text: `Losing streak risk: max ${maxLosingStreak} losing trades in a row. Consider adding trend/regime filters or reducing position size.`
      });
    }

    if (Number.isFinite(profitFactor) && profitFactor > 0 && profitFactor < 1.1) {
      items.push({
        tone: "warn",
        text: `Thin edge: Profit Factor is ${profitFactor.toFixed(2)}. Small changes in market conditions/fees can flip results. Focus on improving average winner vs average loser.`
      });
    }

    return items.slice(0, 6);
  }, [computedTrades, isProfitable, pairStats, profitFactor, profitNum, results.max_drawdown, toNum]);

  const exportData = (format: 'json' | 'csv') => {
    let content = "";
    let mimeType = "";
    let fileName = `backtest_${strategyName}_${backtestId}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(results, null, 2);
      mimeType = "application/json";
    } else {
      const headers = ["Pair", "Open Date", "Close Date", "Profit Ratio"];
      const rows = results.trades.map(t => [t.pair, t.open_date, t.close_date, t.profit_ratio]);
      content = [headers, ...rows].map(row => row.join(",")).join("\n");
      mimeType = "text/csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Report Exported",
      description: `Your ${format.toUpperCase()} report has been downloaded.`,
    });
  };

  // Heatmap Data (by Day of Week and Hour of Day)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  const heatmapData = results.trades.reduce((acc: any, trade) => {
    const date = new Date(trade.close_date);
    const day = date.getDay();
    const hour = date.getHours();
    const profit = toNum(trade.profit_ratio);
    
    const key = `${day}-${hour}`;
    if (!acc[key]) acc[key] = { count: 0, profit: 0 };
    acc[key].count += 1;
    acc[key].profit += profit;
    return acc;
  }, {});

  const metrics = [
    {
      title: "Total Profit/Loss",
      value: `${(profitNum * 100).toFixed(2)}%`,
      description: "Overall percentage return on investment.",
      tooltipEn: "Your overall performance for the whole backtest. Positive means you made money, negative means you lost money.",
      tooltipAr: "الأداء الإجمالي خلال الاختبار. إذا كانت القيمة موجبة فهذا يعني ربح، وإذا كانت سالبة فهذا يعني خسارة.",
      icon: isProfitable ? TrendingUp : TrendingDown,
      color: isProfitable ? "text-green-500" : "text-red-500",
      bg: isProfitable ? "bg-green-500/10" : "bg-red-500/10"
    },
    {
      title: "Start Balance",
      value: `$${startBalance.toFixed(2)}`,
      description: "Starting wallet used for equity curve.",
      tooltipEn: "The amount of money you start with at the beginning of the backtest. All profits and losses are calculated from this.",
      tooltipAr: "المبلغ الذي تبدأ به في بداية الاختبار. يتم حساب الأرباح والخسائر بناءً عليه.",
      icon: DollarSign,
      color: "text-muted-foreground",
      bg: "bg-muted/50"
    },
    {
      title: "End Balance",
      value: `$${endBalance.toFixed(2)}`,
      description: "Ending wallet after all trades.",
      tooltipEn: "The estimated final amount after all trades finish. If it’s lower than Start Balance, the strategy lost money overall.",
      tooltipAr: "المبلغ النهائي بعد انتهاء جميع الصفقات. إذا كان أقل من رصيد البداية فهذا يعني أن الاستراتيجية خاسرة إجمالاً.",
      icon: DollarSign,
      color: isProfitable ? "text-green-500" : "text-red-500",
      bg: isProfitable ? "bg-green-500/10" : "bg-red-500/10"
    },
    {
      title: "Net PnL",
      value: `${profitAbsTotal >= 0 ? "+" : ""}$${profitAbsTotal.toFixed(2)}`,
      description: "Profit in quote currency based on equity curve.",
      tooltipEn: "Net Profit and Loss (PnL). This is the total money gained or lost in dollars. Positive = profit, negative = loss.",
      tooltipAr: "صافي الربح/الخسارة (PnL). هو إجمالي المال الذي تم ربحه أو خسارته بالدولار. موجب = ربح، سالب = خسارة.",
      icon: DollarSign,
      color: profitAbsTotal >= 0 ? "text-green-500" : "text-red-500",
      bg: profitAbsTotal >= 0 ? "bg-green-500/10" : "bg-red-500/10"
    },
    {
      title: "Win Rate",
      value: `${(toNum(results.win_rate) * 100).toFixed(1)}%`,
      description: "Percentage of profitable trades.",
      tooltipEn: `How often your trades ended in profit. Here: ${(toNum(results.win_rate) * 100).toFixed(1)}% = ${winners.length} winning trade(s) out of ${computedTrades.length} total trade(s).`,
      tooltipAr: `نسبة الصفقات الرابحة. هنا: ${(toNum(results.win_rate) * 100).toFixed(1)}% = ${winners.length} صفقة رابحة من أصل ${computedTrades.length} صفقة.`,
      icon: BarChart,
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      title: "Max Drawdown",
      value: `${(toNum(results.max_drawdown) * 100).toFixed(2)}%`,
      description: "Largest peak-to-trough decline.",
      tooltipEn: "The worst drop from a high point to a low point during the backtest. Higher drawdown means higher risk.",
      tooltipAr: "أكبر هبوط من قمة إلى قاع أثناء الاختبار. كلما زاد الهبوط الأقصى زادت المخاطرة.",
      icon: TrendingDown,
      color: "text-orange-500",
      bg: "bg-orange-500/10"
    },
    {
      title: "Profit Factor",
      value: profitFactor.toFixed(2),
      description: "Ratio of gross profit to gross loss.",
      tooltipEn: "Gross Profit ÷ Gross Loss. Above 1.0 means the strategy makes more than it loses. Example: 1.50 means $1.50 profit for each $1 lost.",
      tooltipAr: "إجمالي الأرباح ÷ إجمالي الخسائر. إذا كانت أكبر من 1.0 فهذا يعني أن الأرباح أكبر من الخسائر. مثال: 1.50 تعني 1.50$ ربح مقابل كل 1$ خسارة.",
      icon: ShieldCheck,
      color: "text-purple-500",
      bg: "bg-purple-500/10"
    }
  ];

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <Dialog open={tradeDialogOpen} onOpenChange={setTradeDialogOpen}>
          <DialogContent className="sm:max-w-[700px]">
            <DialogHeader>
              <DialogTitle>Trade Details</DialogTitle>
            </DialogHeader>
            {(() => {
              const tr = typeof selectedTradeIndex === "number" ? computedTrades[selectedTradeIndex] : undefined;
              if (!tr) return <div className="text-sm text-muted-foreground">No trade selected.</div>;
              const profitPct = tr._profitPct;
              const profitAbs = tr._profitAbs;

              const durationMin = Math.round(tr._durationMs / 60000);
              const durationText = durationMin >= 1440
                ? `${Math.floor(durationMin / 1440)}d ${Math.floor((durationMin % 1440) / 60)}h`
                : durationMin >= 60
                  ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
                  : `${durationMin}m`;

              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Pair</div>
                      <div className="text-sm font-semibold">{tr.pair}</div>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Profit</div>
                      <div className={cn("text-sm font-semibold", profitPct >= 0 ? "text-green-500" : "text-red-500")}>
                        {(profitPct >= 0 ? "+" : "") + profitPct.toFixed(2)}% ({(profitAbs >= 0 ? "+" : "") + "$" + profitAbs.toFixed(2)})
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Hold Duration</div>
                      <div className="text-sm font-semibold">{durationText}</div>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Equity</div>
                      <div className="text-xs text-muted-foreground">Before: ${tr._equityBefore.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">After: ${tr._equityAfter.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Entry</div>
                      <div className="text-xs">{tr.open_date ? new Date(tr.open_date).toLocaleString() : "-"}</div>
                      {(tr as any)?.open_rate !== undefined ? (
                        <div className="text-[10px] text-muted-foreground mt-1">Rate: {String((tr as any).open_rate)}</div>
                      ) : null}
                    </div>
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Exit</div>
                      <div className="text-xs">{tr.close_date ? new Date(tr.close_date).toLocaleString() : "-"}</div>
                      {(tr as any)?.close_rate !== undefined ? (
                        <div className="text-[10px] text-muted-foreground mt-1">Rate: {String((tr as any).close_rate)}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Exit Reason</div>
                      <div className="text-xs">{String((tr as any)?.exit_reason ?? "-")}</div>
                    </div>
                    <div className="p-3 rounded-md bg-muted/30 border border-border/50">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">Entry Tag</div>
                      <div className="text-xs">{String((tr as any)?.enter_tag ?? "-")}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backtest Results</h1>
            <p className="text-muted-foreground text-sm">Interactive performance analysis for {strategyName}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => {
                const resultsText = `Backtest Results for ${strategyName}:\n- Profit: ${(profitNum * 100).toFixed(2)}%\n- Win Rate: ${(toNum(results.win_rate) * 100).toFixed(1)}%\n- Max Drawdown: ${(toNum(results.max_drawdown) * 100).toFixed(2)}%\n- Trades: ${results.total_trades}`;
                window.dispatchEvent(new CustomEvent('attach-backtest-results', { detail: resultsText }));
                toast({
                  title: "Results Attached",
                  description: "Performance metrics have been added to your chat input.",
                });
              }}
            >
              <MessageSquare className="w-4 h-4" />
              Attach to AI
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => diagnosticMutation.mutate()}
              disabled={diagnosticMutation.isPending}
            >
              <ShieldCheck className="w-4 h-4" />
              {diagnosticMutation.isPending ? "Queueing..." : "Analyze Logic"}
            </Button>
            {hasLatestReport && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2"
                onClick={() => setShowDiagnostic(!showDiagnostic)}
              >
                {showDiagnostic ? <Activity className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                {showDiagnostic ? "Show Stats" : "Show Logic"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportData('csv')} className="gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportData('json')} className="gap-2">
                  <FileJson className="w-4 h-4" />
                  Export JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg w-fit border border-border/50">
          <Button 
            variant={activeTab === "overview" ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 text-xs px-4"
            onClick={() => setActiveTab("overview")}
          >
            <BarChart className="w-3 h-3 mr-2" />
            Overview
          </Button>
          <Button 
            variant={activeTab === "trades" ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 text-xs px-4"
            onClick={() => setActiveTab("trades")}
          >
            <List className="w-3 h-3 mr-2" />
            Trades ({results.total_trades})
          </Button>
          <Button 
            variant={activeTab === "pairs" ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 text-xs px-4"
            onClick={() => setActiveTab("pairs")}
          >
            <PieChart className="w-3 h-3 mr-2" />
            Pairs
          </Button>
          <Button 
            variant={activeTab === "analysis" ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 text-xs px-4"
            onClick={() => setActiveTab("analysis")}
          >
            <Activity className="w-3 h-3 mr-2" />
            Analytics
          </Button>
          <Button 
            variant={activeTab === "heatmap" ? "secondary" : "ghost"} 
            size="sm" 
            className="h-8 text-xs px-4"
            onClick={() => setActiveTab("heatmap")}
          >
            <Grid className="w-3 h-3 mr-2" />
            Heatmap
          </Button>
        </div>

        {showDiagnostic && latestReport ? (
          <DiagnosticReportView report={latestReport} />
        ) : activeTab === "overview" ? (
          <>
            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {metrics.map((metric) => (
                  <Tooltip key={metric.title}>
                    <TooltipTrigger asChild>
                      <Card className="hover-elevate">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{metric.title}</CardTitle>
                          <div className={cn("p-1.5 rounded-md", metric.bg)}>
                            <metric.icon className={cn("w-4 h-4", metric.color)} />
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className={cn("text-2xl font-bold", metric.color)}>{metric.value}</div>
                          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                            {metric.description}
                          </p>
                        </CardContent>
                      </Card>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <div className="space-y-2">
                        <div>
                          <div className="text-[11px] font-semibold">What it means</div>
                          <div className="text-[11px] text-muted-foreground leading-relaxed">{(metric as any).tooltipEn}</div>
                        </div>
                        <div className="border-t border-border/50 pt-2" dir="rtl">
                          <div className="text-[11px] font-semibold">المعنى</div>
                          <div className="text-[11px] text-muted-foreground leading-relaxed">{(metric as any).tooltipAr}</div>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Equity Curve
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px]">USD Value</Badge>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={equityData}>
                        <defs>
                          <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                        <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val.toFixed(0)}`} domain={['auto', 'auto']} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, "Equity"]}
                        />
                        <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorEquity)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart className="w-4 h-4" />
                    Quick View
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 rounded-md bg-primary/5 border border-primary/20">
                    <h4 className="text-[10px] font-bold uppercase mb-1 text-primary tracking-wider">Insight</h4>
                    <div className="space-y-2">
                      {insightItems.map((it, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] h-5",
                              it.tone === "good"
                                ? "border-green-500/30 text-green-500"
                                : it.tone === "bad"
                                  ? "border-red-500/30 text-red-500"
                                  : "border-orange-500/30 text-orange-500"
                            )}
                          >
                            {it.tone === "good" ? "Good" : it.tone === "bad" ? "Issue" : "Watch"}
                          </Badge>
                          <p className="text-xs text-muted-foreground leading-relaxed">{it.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Winners</span>
                      <span className="text-green-500 font-bold">{winners.length}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Losers</span>
                      <span className="text-red-500 font-bold">{losers.length}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Break-even</span>
                      <span className="text-muted-foreground font-bold">{breakeven.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : activeTab === "trades" ? (
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase font-bold">Pair</TableHead>
                    <TableHead className="text-xs uppercase font-bold">Entry</TableHead>
                    <TableHead className="text-xs uppercase font-bold">Exit</TableHead>
                    <TableHead className="text-xs uppercase font-bold">Duration</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Profit %</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Profit $</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Equity After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.trades.map((trade, i) => {
                    const profit = toNum(trade.profit_ratio);
                    const entry = trade.open_date ? new Date(trade.open_date) : null;
                    const exit = trade.close_date ? new Date(trade.close_date) : null;
                    const durationMs = entry && exit ? Math.max(0, exit.getTime() - entry.getTime()) : 0;
                    const durationMin = Math.round(durationMs / 60000);
                    const durationText = entry && exit
                      ? (durationMin >= 1440
                        ? `${Math.floor(durationMin / 1440)}d ${Math.floor((durationMin % 1440) / 60)}h`
                        : durationMin >= 60
                          ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
                          : `${durationMin}m`)
                      : "-";
                    const profitAbs = Number.isFinite(toNum((trade as any)?.profit_abs))
                      ? toNum((trade as any).profit_abs)
                      : (Number.isFinite(profit) ? startBalance * profit : 0);
                    const equityAfter = Number.isFinite(toNum((trade as any)?.equity_after))
                      ? toNum((trade as any).equity_after)
                      : NaN;
                    return (
                      <TableRow
                        key={i}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          setSelectedTradeIndex(i);
                          setTradeDialogOpen(true);
                        }}
                      >
                        <TableCell className="text-xs font-medium">{trade.pair}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{entry ? entry.toLocaleString() : "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{exit ? exit.toLocaleString() : "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{durationText}</TableCell>
                        <TableCell className={cn("text-xs font-bold text-right", profit >= 0 ? "text-green-500" : "text-red-500")}>
                          {(profit * 100).toFixed(2)}%
                        </TableCell>
                        <TableCell className={cn("text-xs font-bold text-right", profitAbs >= 0 ? "text-green-500" : "text-red-500")}>
                          {(profitAbs >= 0 ? "+" : "") + "$" + profitAbs.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-right">
                          {Number.isFinite(equityAfter) ? `$${equityAfter.toFixed(2)}` : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : activeTab === "pairs" ? (
          <Card className="border-border/50 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary" />
                Pair Breakdown
              </CardTitle>
              <CardDescription className="text-xs">Aggregated performance per trading pair.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase font-bold">Pair</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Trades</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Win Rate</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Total Profit %</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Total PnL $</TableHead>
                    <TableHead className="text-xs uppercase font-bold text-right">Avg Hold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairStats.map((p) => {
                    const winRate = p.trades > 0 ? p.wins / p.trades : 0;
                    const avgHoldMin = p.trades > 0 ? Math.round(p.durationMs / p.trades / 60000) : 0;
                    const avgHoldText = avgHoldMin >= 1440
                      ? `${Math.floor(avgHoldMin / 1440)}d ${Math.floor((avgHoldMin % 1440) / 60)}h`
                      : avgHoldMin >= 60
                        ? `${Math.floor(avgHoldMin / 60)}h ${avgHoldMin % 60}m`
                        : `${avgHoldMin}m`;

                    return (
                      <TableRow key={p.pair} className="hover:bg-muted/50">
                        <TableCell className="text-xs font-medium">{p.pair}</TableCell>
                        <TableCell className="text-xs font-medium text-right">{p.trades}</TableCell>
                        <TableCell className="text-xs font-medium text-right">{(winRate * 100).toFixed(1)}%</TableCell>
                        <TableCell className={cn("text-xs font-bold text-right", p.profitPct >= 0 ? "text-green-500" : "text-red-500")}>
                          {(p.profitPct >= 0 ? "+" : "") + p.profitPct.toFixed(2)}%
                        </TableCell>
                        <TableCell className={cn("text-xs font-bold text-right", p.profitAbs >= 0 ? "text-green-500" : "text-red-500")}>
                          {(p.profitAbs >= 0 ? "+" : "") + "$" + p.profitAbs.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground text-right">{avgHoldText}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : activeTab === "analysis" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-500" />
                  Profit Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ReBarChart data={tradeData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                      <XAxis dataKey="name" hide />
                      <YAxis fontSize={9} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '10px' }}
                        formatter={(v: number) => [`${v.toFixed(2)}%`, "Profit"]}
                      />
                      <Bar dataKey="profit" radius={[2, 2, 0, 0]}>
                        {tradeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#22c55e' : '#ef4444'} />
                        ))}
                      </Bar>
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
              </Card>

              <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary" />
                  Performance Statistics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Avg Win</div>
                    <div className="text-lg font-bold text-green-500">+{(avgProfit * 100).toFixed(2)}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Avg Loss</div>
                    <div className="text-lg font-bold text-red-500">{(avgLoss * 100).toFixed(2)}%</div>
                  </div>
                </div>
                <div className="p-3 rounded-md bg-orange-500/5 border border-orange-500/20">
                  <h4 className="text-[10px] font-bold uppercase mb-1 text-orange-500 tracking-wider">Risk Metric</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Strategy expectancy is <strong>{profitFactor.toFixed(2)}</strong>. 
                    {profitFactor > 1.2 ? " This is a robust risk-reward profile." : " Consider widening profit targets or tightening stops."}
                  </p>
                </div>
              </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Derived Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Expectancy</div>
                    <div className="text-sm font-semibold">{(expectancy * 100).toFixed(3)}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Profit Factor</div>
                    <div className="text-sm font-semibold">{profitFactor.toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Win/Loss Ratio</div>
                    <div className="text-sm font-semibold">{winLossRatio.toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Avg Win</div>
                    <div className="text-sm font-semibold text-green-500">+{(avgProfit * 100).toFixed(2)}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Avg Loss</div>
                    <div className="text-sm font-semibold text-red-500">{(avgLoss * 100).toFixed(2)}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Avg Duration</div>
                    <div className="text-sm font-semibold">{avgTradeDurationMin ? `${avgTradeDurationMin.toFixed(1)} min` : "N/A"}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Trades/Day</div>
                    <div className="text-sm font-semibold">{tradesPerDay ? tradesPerDay.toFixed(2) : "N/A"}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Winners/Losers</div>
                    <div className="text-sm font-semibold">{winners.length}/{losers.length}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/10 border-b border-border/50">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Grid className="w-4 h-4 text-primary" />
                Performance Heatmap
              </CardTitle>
              <CardDescription className="text-xs">Visualize trade density and profitability by day and hour.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="relative overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* Header: Hours */}
                  <div className="flex ml-12 mb-2">
                    {hours.map(hour => (
                      <div key={hour} className="flex-1 text-[9px] text-muted-foreground text-center">
                        {hour}h
                      </div>
                    ))}
                  </div>
                  
                  {/* Body: Days */}
                  {days.map((day, dayIdx) => (
                    <div key={day} className="flex items-center mb-1 h-8">
                      <div className="w-12 text-[10px] font-bold text-muted-foreground pr-2 text-right">{day}</div>
                      <div className="flex-1 flex gap-1 h-full">
                        {hours.map(hour => {
                          const data = heatmapData[`${dayIdx}-${hour}`];
                          const hasData = !!data;
                          const avgProfit = hasData ? data.profit / data.count : 0;
                          
                          // Color mapping: Intensity based on count, Hue based on profit
                          let bgColor = "bg-muted/20";
                          if (hasData) {
                            if (avgProfit > 0) {
                              bgColor = "bg-green-500";
                            } else if (avgProfit < 0) {
                              bgColor = "bg-red-500";
                            } else {
                              bgColor = "bg-blue-500";
                            }
                          }
                          
                          const opacity = hasData ? Math.min(0.2 + (data.count * 0.15), 1) : 0.1;
                          
                          return (
                            <div 
                              key={hour}
                              className={cn(
                                "flex-1 rounded-sm border border-border/10 transition-all cursor-default",
                                bgColor
                              )}
                              style={{ opacity }}
                              title={hasData ? `${data.count} trades, ${(avgProfit * 100).toFixed(2)}% avg profit` : "No trades"}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  
                  {/* Legend */}
                  <div className="mt-6 flex items-center justify-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded-sm" />
                      <span className="text-[10px] text-muted-foreground">Profitable</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded-sm" />
                      <span className="text-[10px] text-muted-foreground">Loss</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-muted/20 rounded-sm border border-border/20" />
                      <span className="text-[10px] text-muted-foreground">No Data</span>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-[10px] text-muted-foreground italic">Opacity indicates trade density</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
