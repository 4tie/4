import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtPct, fmtDateTime, fmtDurationMinutes, toFiniteNumber, dateMs } from "@/lib/workspaceUtils";
import type { TradesPageSize, TradesViewTab, PerPairSortKey } from "@/hooks/use-trade-results";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradesTableProps {
  allTrades: any[];
  tradePairs: string[];
  tradePairCounts: Map<string, number>;
  filteredTrades: any[];
  pagedTrades: { page: number; maxPage: number; total: number; rows: any[] };
  filteredTradesTotals: {
    pairsCount: number;
    durationMin: number;
    durationCount: number;
    netProfitAbs: number;
    grossProfitAbs: number;
    grossLossAbs: number;
    wins: number;
    losses: number;
    profitPctAvg: number | null;
  };
  resultsSummary: any;
  tradesViewTab: TradesViewTab;
  setTradesViewTab: (v: TradesViewTab) => void;
  tradesFilterPair: string;
  setTradesFilterPair: (v: string) => void;
  tradesFilterPnL: "all" | "profit" | "loss";
  setTradesFilterPnL: (v: "all" | "profit" | "loss") => void;
  tradesSearch: string;
  setTradesSearch: (v: string) => void;
  tradesPage: number;
  setTradesPage: (v: number | ((prev: number) => number)) => void;
  tradesPageSize: TradesPageSize;
  setTradesPageSize: (v: TradesPageSize) => void;
  perPairSort: { key: PerPairSortKey; dir: "asc" | "desc" };
  setPerPairSort: (v: { key: PerPairSortKey; dir: "asc" | "desc" } | ((prev: { key: PerPairSortKey; dir: "asc" | "desc" }) => { key: PerPairSortKey; dir: "asc" | "desc" })) => void;
  tradeColWidths: Record<string, number>;
  startResizeTradeCol: (key: string) => (e: React.MouseEvent) => void;
  onSelectProfitablePairs?: (pairs: string[]) => void;
}

export function TradesTable({
  allTrades,
  tradePairs,
  tradePairCounts,
  filteredTrades,
  pagedTrades,
  filteredTradesTotals,
  resultsSummary,
  tradesViewTab,
  setTradesViewTab,
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
  perPairSort,
  setPerPairSort,
  tradeColWidths,
  startResizeTradeCol,
  onSelectProfitablePairs,
}: TradesTableProps) {
  const perPairData = useMemo(() => {
    return tradePairs.map((p) => {
      const pairTrades = allTrades.filter((t: any) => String((t as any)?.pair) === p);
      const tradesCount = pairTrades.length;
      const wins = pairTrades.filter((t: any) => (toFiniteNumber((t as any)?.profit_abs) ?? 0) > 0).length;
      const winRate = tradesCount > 0 ? (wins / tradesCount) * 100 : 0;
      const netProfit = pairTrades.reduce((sum: number, t: any) => sum + (toFiniteNumber((t as any)?.profit_abs) ?? 0), 0);
      const avgProfit = tradesCount > 0 ? netProfit / tradesCount : 0;
      const totalProfitPct = pairTrades.reduce((sum: number, t: any) => sum + ((toFiniteNumber((t as any)?.profit_ratio) ?? 0) * 100), 0);
      return { pair: p, tradesCount, winRate, netProfit, avgProfit, totalProfitPct };
    });
  }, [allTrades, tradePairs]);

  const sortedPerPairData = useMemo(() => {
    return [...perPairData].sort((a, b) => {
      const dir = perPairSort.dir === "asc" ? 1 : -1;
      switch (perPairSort.key) {
        case "pair": return dir * a.pair.localeCompare(b.pair);
        case "trades": return dir * (a.tradesCount - b.tradesCount);
        case "winRate": return dir * (a.winRate - b.winRate);
        case "profitPct": return dir * (a.totalProfitPct - b.totalProfitPct);
        case "profit": return dir * ((a.netProfit ?? 0) - (b.netProfit ?? 0));
        case "avgProfit": return dir * ((a.avgProfit ?? 0) - (b.avgProfit ?? 0));
        default: return 0;
      }
    });
  }, [perPairData, perPairSort]);

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: PerPairSortKey }) => {
    const isActive = perPairSort.key === sortKey;
    return (
      <th
        className="px-2 py-2 text-right cursor-pointer hover:bg-white/5 select-none"
        onClick={() => setPerPairSort((prev: { key: PerPairSortKey; dir: "asc" | "desc" }) => ({
          key: sortKey,
          dir: prev.key === sortKey && prev.dir === "desc" ? "asc" : "desc"
        }))}
      >
        <div className="flex items-center justify-end gap-1">
          <span>{label}</span>
          {isActive && (
            <span className="text-[8px]">{perPairSort.dir === "desc" ? "▼" : "▲"}</span>
          )}
        </div>
      </th>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Summary Cards */}
      <div className="p-3 border-b border-white/10 bg-black/30">
        {resultsSummary ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {/* Profit Card */}
            {(() => {
              const positive = (resultsSummary.profitAbs ?? 0) >= 0;
              return (
                <div className={cn(
                  "rounded-xl border bg-gradient-to-br px-3 py-2",
                  positive
                    ? "border-emerald-500/20 from-emerald-500/15 via-black/30 to-purple-500/10"
                    : "border-red-500/20 from-red-500/15 via-black/30 to-purple-500/10",
                )}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Total Profit</div>
                  <div className={cn("mt-0.5 text-sm font-bold", positive ? "text-emerald-400" : "text-red-400")}>
                    {fmtPct(resultsSummary.profitPct)}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {fmtMoney(resultsSummary.profitAbs)} {resultsSummary.stakeCurrency}
                  </div>
                </div>
              );
            })()}

            {(() => {
              const v = toFiniteNumber(resultsSummary.startingBalance);
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Starting Balance</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-100">
                    {v != null ? fmtMoney(v) : "-"} {resultsSummary.stakeCurrency}
                  </div>
                  <div className="text-[11px] text-slate-300">Start</div>
                </div>
              );
            })()}

            {(() => {
              const v = toFiniteNumber(resultsSummary.finalBalance);
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Ending Balance</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-100">
                    {v != null ? fmtMoney(v) : "-"} {resultsSummary.stakeCurrency}
                  </div>
                  <div className="text-[11px] text-slate-300">End</div>
                </div>
              );
            })()}

            {/* Profit Factor Card */}
            {(() => {
              const profitFactor = filteredTradesTotals.grossLossAbs > 0
                ? filteredTradesTotals.grossProfitAbs / filteredTradesTotals.grossLossAbs
                : filteredTradesTotals.grossProfitAbs > 0 ? Infinity : 0;
              const pfGood = profitFactor >= 1.5;
              const pfBad = profitFactor < 1 && profitFactor > 0;
              return (
                <div className={cn(
                  "rounded-xl border bg-gradient-to-br px-3 py-2",
                  pfGood ? "border-emerald-500/20 from-emerald-500/10 via-black/30 to-purple-500/10" : 
                  pfBad ? "border-red-500/20 from-red-500/10 via-black/30 to-purple-500/10" :
                  "border-white/10 from-purple-500/10 via-black/30 to-purple-500/5"
                )}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Profit Factor</div>
                  <div className={cn("mt-0.5 text-sm font-bold", 
                    pfGood ? "text-emerald-400" : pfBad ? "text-red-400" : "text-slate-100"
                  )}>
                    {Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {profitFactor >= 1.5 ? "Good" : profitFactor >= 1 ? "Breakeven" : "Poor"}
                  </div>
                </div>
              );
            })()}

            {/* Expectancy Card */}
            {(() => {
              const expectancy = pagedTrades.total > 0
                ? filteredTradesTotals.netProfitAbs / pagedTrades.total
                : 0;
              const positive = expectancy >= 0;
              return (
                <div className={cn(
                  "rounded-xl border bg-gradient-to-br px-3 py-2",
                  positive
                    ? "border-emerald-500/20 from-emerald-500/10 via-black/30 to-purple-500/10"
                    : "border-red-500/20 from-red-500/10 via-black/30 to-purple-500/10",
                )}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Expectancy / Trade</div>
                  <div className={cn("mt-0.5 text-sm font-bold", positive ? "text-emerald-400" : "text-red-400")}>
                    {fmtMoney(expectancy)} {resultsSummary.stakeCurrency}
                  </div>
                  <div className="text-[11px] text-slate-300">Avg per trade</div>
                </div>
              );
            })()}

            {/* Win Rate Card */}
            {(() => {
              const total = filteredTradesTotals.wins + filteredTradesTotals.losses;
              const winRate = total > 0 ? (filteredTradesTotals.wins / total) * 100 : 0;
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Win Rate</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-100">{winRate.toFixed(1)}%</div>
                  <div className="text-[11px] text-slate-300">
                    {filteredTradesTotals.wins}W / {filteredTradesTotals.losses}L
                  </div>
                </div>
              );
            })()}

            {/* Avg Win/Loss Card */}
            {(() => {
              const avgWin = filteredTradesTotals.wins > 0
                ? filteredTradesTotals.grossProfitAbs / filteredTradesTotals.wins
                : 0;
              const avgLoss = filteredTradesTotals.losses > 0
                ? filteredTradesTotals.grossLossAbs / filteredTradesTotals.losses
                : 0;
              const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Avg Win / Loss</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-100">
                    {fmtMoney(avgWin)} / {fmtMoney(avgLoss)}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    Ratio: {payoffRatio.toFixed(2)}
                  </div>
                </div>
              );
            })()}

            {/* Best/Worst Trade Card */}
            {(() => {
              const profits = allTrades.map((t: any) => toFiniteNumber(t?.profit_ratio) ?? 0).filter((n: number) => n !== 0);
              const best = profits.length > 0 ? Math.max(...profits) : 0;
              const worst = profits.length > 0 ? Math.min(...profits) : 0;
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Best / Worst</div>
                  <div className="mt-0.5 text-sm font-bold">
                    <span className="text-emerald-400">{fmtPct(best * 100)}</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-red-400">{fmtPct(worst * 100)}</span>
                  </div>
                  <div className="text-[11px] text-slate-300">Best vs Worst trade</div>
                </div>
              );
            })()}

            {/* Avg Duration Card */}
            {(() => {
              const avgDur = filteredTradesTotals.durationCount > 0
                ? filteredTradesTotals.durationMin / filteredTradesTotals.durationCount
                : 0;
              const avgDurStr = avgDur >= 60 
                ? `${(avgDur / 60).toFixed(1)}h` 
                : `${avgDur.toFixed(0)}m`;
              return (
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Avg Duration</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-100">{avgDurStr}</div>
                  <div className="text-[11px] text-slate-300">Per trade</div>
                </div>
              );
            })()}

            {/* Risk Card */}
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Max Drawdown</div>
              <div className="mt-0.5 text-sm font-bold text-slate-100">{fmtPct(resultsSummary.ddPct)}</div>
              <div className="text-[11px] text-slate-300">
                {fmtMoney(resultsSummary.ddAbs)} {resultsSummary.stakeCurrency}
              </div>
            </div>

            {/* Trades Count Card */}
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-purple-500/10 via-black/30 to-purple-500/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Total Trades</div>
              <div className="mt-0.5 text-sm font-bold text-slate-100">
                {resultsSummary.totalTrades != null ? String(Math.round(resultsSummary.totalTrades)) : "-"}
              </div>
              <div className="text-[11px] text-slate-300">
                {tradePairs.length} pairs
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-400">No results yet.</div>
        )}
      </div>

      {/* Trades Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-3 space-y-3">
          {/* View Tabs & Filters */}
          <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-black/20">
              <div className="flex items-center gap-1 mb-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-[10px] rounded-md",
                    tradesViewTab === "trades" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                  onClick={() => setTradesViewTab("trades")}
                >
                  All Trades
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-3 text-[10px] rounded-md",
                    tradesViewTab === "per-pair" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                  onClick={() => setTradesViewTab("per-pair")}
                >
                  Per-Pair Results
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  {tradesViewTab === "trades" ? "Trades" : "Pair Summary"}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[10px] text-slate-400">
                    {tradesViewTab === "trades" ? (
                      <>
                        {pagedTrades.total} trades
                        {allTrades.length !== pagedTrades.total ? ` of ${allTrades.length}` : ""}
                        {filteredTradesTotals.pairsCount ? ` • ${filteredTradesTotals.pairsCount} pairs` : ""}
                      </>
                    ) : (
                      <>{tradePairs.length} pairs</>
                    )}
                  </div>
                  {onSelectProfitablePairs && tradePairs.length > 0 && tradesViewTab === "per-pair" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                      onClick={() => {
                        const profitablePairs = tradePairs.filter((p) => {
                          const pairTrades = allTrades.filter((t: any) => String((t as any)?.pair) === p);
                          const netProfit = pairTrades.reduce((sum: number, t: any) => sum + (toFiniteNumber((t as any)?.profit_abs) ?? 0), 0);
                          return netProfit > 0;
                        });
                        if (profitablePairs.length > 0) {
                          onSelectProfitablePairs(profitablePairs);
                        }
                      }}
                      title="Select only profitable pairs for Quick Backtest"
                    >
                      <span className="flex items-center gap-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Use profitable ({(() => {
                          const count = tradePairs.filter((p) => {
                            const pairTrades = allTrades.filter((t: any) => String((t as any)?.pair) === p);
                            const net = pairTrades.reduce((sum: number, t: any) => sum + (toFiniteNumber((t as any)?.profit_abs) ?? 0), 0);
                            return net > 0;
                          }).length;
                          return count;
                        })()})
                      </span>
                    </Button>
                  )}
                </div>
              </div>

              {tradesViewTab === "trades" && (
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
                    {tradePairs.map((p) => {
                      const pairTrades = allTrades.filter((t: any) => String((t as any)?.pair) === p);
                      const netProfit = pairTrades.reduce((sum: number, t: any) => {
                        const profitAbs = toFiniteNumber((t as any)?.profit_abs);
                        return sum + (profitAbs ?? 0);
                      }, 0);
                      const isProfitable = netProfit > 0;
                      const isLosing = netProfit < 0;
                      return (
                        <option key={p} value={p} style={{ color: isProfitable ? '#10b981' : isLosing ? '#ef4444' : undefined }}>
                          {p} ({tradePairCounts.get(p) ?? 0}) {isProfitable ? '▲' : isLosing ? '▼' : ''}
                        </option>
                      );
                    })}
                  </select>

                  <select
                    value={tradesFilterPnL}
                    onChange={(e) => setTradesFilterPnL(e.target.value as any)}
                    className="w-full h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                  >
                    <option value="all">All trades</option>
                    <option value="profit" style={{ color: '#10b981' }}>Profit only</option>
                    <option value="loss" style={{ color: '#ef4444' }}>Loss only</option>
                  </select>

                  <div className="flex items-center justify-end gap-2">
                    <select
                      value={String(tradesPageSize)}
                      onChange={(e) => {
                        const v = String(e.target.value || "").trim().toLowerCase();
                        if (v === "all") {
                          setTradesPageSize("all");
                          return;
                        }
                        const n = Number(v);
                        if (n === 10 || n === 20 || n === 50 || n === 100) {
                          setTradesPageSize(n);
                          return;
                        }
                        setTradesPageSize(50);
                      }}
                      className="h-8 rounded-md bg-black/30 border border-white/10 px-2 text-xs text-slate-200 outline-none"
                      title="Rows"
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="all">All</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setTradesPage(Math.max(1, tradesPage - 1))}
                      disabled={tradesPageSize === "all" || pagedTrades.page <= 1}
                    >
                      Prev
                    </Button>
                    <div className="text-xs text-slate-300">
                      {tradesPageSize === "all" ? "All" : `${pagedTrades.page}/${pagedTrades.maxPage}`}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setTradesPage(Math.min(pagedTrades.maxPage, tradesPage + 1))}
                      disabled={tradesPageSize === "all" || pagedTrades.page >= pagedTrades.maxPage}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Table Content */}
            <div className="p-3">
              {tradesViewTab === "trades" ? (
                pagedTrades.rows.length ? (
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
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("pair")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-left relative">
                            <div className="pr-2">Open</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("open")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-left relative">
                            <div className="pr-2">Close</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("close")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-left relative">
                            <div className="pr-2">Duration</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("duration")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-right relative">
                            <div className="pr-2">Profit %</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("profitPct")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-right relative">
                            <div className="pr-2">Profit</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("profitAbs")} title="Drag to resize" />
                          </th>
                          <th className="px-2 py-2 text-left relative">
                            <div className="pr-2">Exit</div>
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" onMouseDown={startResizeTradeCol("exit")} title="Drag to resize" />
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
                            <tr 
                              key={String((t as any)?.open_timestamp ?? idx)} 
                              className={cn(
                                "transition-colors",
                                idx % 2 === 0 ? "bg-black/10" : "bg-black/0",
                                "hover:bg-white/5",
                                positive ? "hover:bg-emerald-500/10" : "hover:bg-red-500/10"
                              )}
                            >
                              <td className="px-2 py-2 font-semibold text-slate-100 whitespace-nowrap">
                                <span className={cn(
                                  "inline-flex items-center gap-1.5",
                                  positive ? "text-emerald-400" : "text-red-400"
                                )}>
                                  {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                  {pair}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-slate-200 whitespace-nowrap">{openDate}</td>
                              <td className="px-2 py-2 text-slate-200 whitespace-nowrap">{closeDate}</td>
                              <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{fmtDurationMinutes(durationMin)}</td>
                              <td className={cn("px-2 py-2 text-right font-semibold whitespace-nowrap", positive ? "text-emerald-400" : "text-red-400")}>
                                {profitPct != null ? fmtPct(profitPct) : "-"}
                              </td>
                              <td className={cn("px-2 py-2 text-right font-semibold whitespace-nowrap", positive ? "text-emerald-400" : "text-red-400")}>
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
                )
              ) : (
                sortedPerPairData.length ? (
                  <div className="overflow-auto rounded-md border border-white/10">
                    <table className="w-full text-xs">
                      <thead className="bg-black/30 text-[10px] uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-2 py-2 text-left cursor-pointer hover:bg-white/5 select-none" onClick={() => setPerPairSort((prev: { key: PerPairSortKey; dir: "asc" | "desc" }) => ({ key: "pair", dir: prev.key === "pair" && prev.dir === "desc" ? "asc" : "desc" }))}>
                            <div className="flex items-center gap-1">
                              <span>Pair</span>
                              {perPairSort.key === "pair" && <span className="text-[8px]">{perPairSort.dir === "desc" ? "▼" : "▲"}</span>}
                            </div>
                          </th>
                          <SortHeader label="Trades" sortKey="trades" />
                          <SortHeader label="Win Rate" sortKey="winRate" />
                          <SortHeader label="Profit %" sortKey="profitPct" />
                          <SortHeader label="Profit" sortKey="profit" />
                          <SortHeader label="Avg Profit" sortKey="avgProfit" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {sortedPerPairData.map((data) => {
                          const isProfitable = (data.netProfit ?? 0) > 0;
                          return (
                            <tr key={data.pair} className="hover:bg-white/5">
                              <td className="px-2 py-2 font-semibold text-slate-100">{data.pair}</td>
                              <td className="px-2 py-2 text-right text-slate-200">{data.tradesCount}</td>
                              <td className="px-2 py-2 text-right text-slate-200">{data.winRate.toFixed(1)}%</td>
                              <td className={cn("px-2 py-2 text-right font-semibold", isProfitable ? "text-emerald-400" : "text-red-400")}>
                                {data.totalProfitPct.toFixed(2)}%
                              </td>
                              <td className={cn("px-2 py-2 text-right font-semibold", isProfitable ? "text-emerald-400" : "text-red-400")}>
                                {fmtMoney(data.netProfit)} {resultsSummary?.stakeCurrency ?? ""}
                              </td>
                              <td className={cn("px-2 py-2 text-right", isProfitable ? "text-emerald-400" : "text-red-400")}>
                                {fmtMoney(data.avgProfit)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">No pair data available.</div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
