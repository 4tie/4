import { useBacktests } from "@/hooks/use-backtests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { BarChart3, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function StrategyComparison() {
  const { data: backtests, isLoading } = useBacktests();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const completedBacktests = backtests?.filter(b => b.status === "completed" && b.results) || [];

  const toggleSelection = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectedBacktests = completedBacktests.filter(b => selectedIds.includes(b.id));

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading backtests...</div>;

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-hidden bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Strategy Comparison</h1>
        </div>
        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
          {selectedIds.length} Strategies Selected
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 overflow-hidden">
        {/* Selection List */}
        <Card className="md:col-span-1 flex flex-col overflow-hidden border-border/50 shadow-sm">
          <CardHeader className="py-3 px-4 border-b border-border/50 bg-muted/30">
            <CardTitle className="text-sm font-medium">Select Backtests</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {completedBacktests.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center space-x-2 p-2 rounded-md hover:bg-secondary/50 transition-colors cursor-pointer"
                    onClick={() => toggleSelection(b.id)}
                  >
                    <Checkbox
                      checked={selectedIds.includes(b.id)}
                      onCheckedChange={() => toggleSelection(b.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{b.strategyName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(b.createdAt!).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
                {completedBacktests.length === 0 && (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No completed backtests available
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Comparison Table */}
        <Card className="md:col-span-3 overflow-hidden border-border/50 shadow-sm flex flex-col">
          <CardContent className="p-0 flex-1 overflow-hidden">
            {selectedBacktests.length > 0 ? (
              <ScrollArea className="h-full w-full">
                <Table>
                  <TableHeader className="bg-muted/30 sticky top-0 z-20">
                    <TableRow>
                      <TableHead className="w-[180px] bg-muted/30 sticky left-0 z-30">Metric</TableHead>
                      {selectedBacktests.map(b => (
                        <TableHead key={b.id} className="min-w-[150px] text-center font-bold text-primary">
                          {b.strategyName}
                          <div className="text-[10px] font-normal text-muted-foreground">ID: {b.id}</div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <MetricRow label="Total Profit %" selectedBacktests={selectedBacktests} metricKey="profit_total" format={(v) => `${(v * 100).toFixed(2)}%`} isNumeric />
                    <MetricRow label="Win Rate %" selectedBacktests={selectedBacktests} metricKey="win_rate" format={(v) => `${(v * 100).toFixed(2)}%`} isNumeric />
                    <MetricRow label="Total Trades" selectedBacktests={selectedBacktests} metricKey="total_trades" isNumeric />
                    <MetricRow label="Max Drawdown %" selectedBacktests={selectedBacktests} metricKey="max_drawdown" format={(v) => `${(v * 100).toFixed(2)}%`} isNumeric isNegativeBetter />
                    <MetricRow label="Sharpe Ratio" selectedBacktests={selectedBacktests} metricKey="sharpe_ratio" format={(v) => v?.toFixed(2)} isNumeric />
                    <MetricRow label="Avg Profit %" selectedBacktests={selectedBacktests} metricKey="avg_profit_per_trade" format={(v) => `${(v * 100).toFixed(2)}%`} isNumeric />
                    <MetricRow label="Profit Factor" selectedBacktests={selectedBacktests} metricKey="profit_factor" format={(v) => v?.toFixed(2)} isNumeric />
                    <MetricRow label="Avg Duration" selectedBacktests={selectedBacktests} metricKey="avg_duration_minutes" format={(v) => v ? `${Math.floor(v / 60)}h ${v % 60}m` : "N/A"} isNumeric isNegativeBetter />
                    <MetricRow label="Expectancy" selectedBacktests={selectedBacktests} metricKey="expectancy" format={(v) => v?.toFixed(4)} isNumeric />
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 space-y-4">
                <BarChart3 className="w-12 h-12 opacity-20" />
                <div className="text-center">
                  <h3 className="text-lg font-medium text-foreground">Compare Strategies</h3>
                  <p className="text-sm">Select at least one backtest from the list to start comparing performance metrics side-by-side.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricRow({ label, selectedBacktests, metricKey, format, isNumeric, isNegativeBetter }: {
  label: string;
  selectedBacktests: any[];
  metricKey: string;
  format?: (v: any) => string;
  isNumeric?: boolean;
  isNegativeBetter?: boolean;
}) {
  const values = selectedBacktests.map(b => (b.results as any)?.[metricKey]);
  const validValues = values.filter(v => v !== undefined && v !== null);
  
  const bestValue = validValues.length > 0 ? (
    isNegativeBetter ? Math.min(...validValues) : Math.max(...validValues)
  ) : null;

  return (
    <TableRow className="hover:bg-muted/20">
      <TableCell className="font-medium bg-background sticky left-0 z-10 border-r border-border/50">{label}</TableCell>
      {values.map((v, i) => {
        const isBest = v !== undefined && v !== null && v === bestValue && validValues.length > 1;
        return (
          <TableCell key={i} className={cn("text-center font-mono text-sm", isBest && "text-green-500 font-bold")}>
            {v !== undefined && v !== null ? (format ? format(v) : v) : "N/A"}
            {isBest && <Badge variant="outline" className="ml-2 h-4 px-1 text-[8px] border-green-500 text-green-500 bg-green-500/10">BEST</Badge>}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
