import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonChart } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface EquityCurveChartProps {
  data: Array<{
    date: string;
    balance: number;
    profit: number;
  }>;
  height?: number;
  showGrid?: boolean;
  className?: string;
}

export function EquityCurveChart({
  data,
  height = 300,
  showGrid = true,
  className,
}: EquityCurveChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d, i) => ({
      ...d,
      index: i,
      profitPct: i === 0 ? 0 : ((d.balance - data[0].balance) / data[0].balance) * 100,
    }));
  }, [data]);

  const minBalance = useMemo(() => Math.min(...chartData.map((d) => d.balance)), [chartData]);
  const maxBalance = useMemo(() => Math.max(...chartData.map((d) => d.balance)), [chartData]);
  const initialBalance = data[0]?.balance ?? 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-black/90 border border-white/20 rounded-lg p-3 shadow-xl">
          <p className="text-xs text-slate-400 mb-1">{dataPoint.date}</p>
          <p className="text-sm font-semibold text-white">
            Balance: ${dataPoint.balance.toFixed(2)}
          </p>
          <p className={cn("text-xs font-medium", dataPoint.profitPct >= 0 ? "text-emerald-400" : "text-red-400")}>
            {dataPoint.profitPct >= 0 ? "+" : ""}{dataPoint.profitPct.toFixed(2)}%
          </p>
        </div>
      );
    }
    return null;
  };

  if (!data || data.length === 0) {
    return <SkeletonChart height={height} />;
  }

  return (
    <Card className={cn("bg-black/20 border-white/10", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-300">Equity Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />}
            <XAxis
              dataKey="index"
              hide
            />
            <YAxis
              domain={[minBalance * 0.95, maxBalance * 1.05]}
              tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={initialBalance} stroke="#64748b" strokeDasharray="5 5" />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#colorBalance)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface ProfitDistributionChartProps {
  trades: Array<{
    profit_abs: number;
    profit_ratio: number;
  }>;
  height?: number;
  className?: string;
}

export function ProfitDistributionChart({
  trades,
  height = 200,
  className,
}: ProfitDistributionChartProps) {
  const chartData = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    
    const profits = trades.map((t) => toFiniteNumber(t.profit_abs) ?? 0);
    const min = Math.min(...profits);
    const max = Math.max(...profits);
    const bucketCount = 20;
    const bucketSize = (max - min) / bucketCount;
    
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      range: `${(min + i * bucketSize).toFixed(1)}`,
      count: 0,
      isProfit: (min + i * bucketSize + bucketSize / 2) > 0,
    }));
    
    profits.forEach((profit) => {
      const bucketIndex = Math.min(Math.floor((profit - min) / bucketSize), bucketCount - 1);
      if (bucketIndex >= 0 && bucketIndex < bucketCount) {
        buckets[bucketIndex].count++;
      }
    });
    
    return buckets;
  }, [trades]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-black/90 border border-white/20 rounded-lg p-2 shadow-xl">
          <p className="text-xs text-slate-400">
            {data.isProfit ? "Profit" : "Loss"}: ${data.range}
          </p>
          <p className="text-sm font-semibold text-white">{data.count} trades</p>
        </div>
      );
    }
    return null;
  };

  if (!trades || trades.length === 0) {
    return <SkeletonChart height={height} />;
  }

  return (
    <Card className={cn("bg-black/20 border-white/10", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-300">Profit Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" opacity={0.3} />
            <XAxis
              dataKey="range"
              tick={{ fill: "#64748b", fontSize: 10 }}
              tickFormatter={(value) => `$${value}`}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: "#8b5cf6", r: 3 }}
              activeDot={{ r: 5, fill: "#a78bfa" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function toFiniteNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}
