import type { PerformanceMetricsReport } from "./types";

export class Phase2Performance {
  analyze(backtestData: any): PerformanceMetricsReport {
    const trades = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const profitRatioOf = (t: any) => {
      const v = t?.profit_ratio ?? t?.profitRatio ?? t?.profit;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const profitAbsOf = (t: any) => {
      const v = t?.profit_abs ?? t?.profitAbs ?? t?.profit_abs_total;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const toMs = (v: any) => {
      const d = v ? new Date(v) : null;
      const ms = d ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : NaN;
    };

    const winners = trades.filter((t: any) => profitRatioOf(t) > 0 || profitAbsOf(t) > 0);
    const losers = trades.filter((t: any) => profitRatioOf(t) < 0 || profitAbsOf(t) < 0);
    const breakeven = trades.filter((t: any) => profitRatioOf(t) === 0 && profitAbsOf(t) === 0);

    const totalTrades = Number.isFinite(Number(backtestData?.total_trades))
      ? Number(backtestData.total_trades)
      : trades.length;

    const winRate = totalTrades > 0 ? winners.length / totalTrades : 0;
    const lossRate = totalTrades > 0 ? losers.length / totalTrades : 0;

    const avg = (arr: number[]) => {
      if (!arr.length) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    const avgWinRatio = avg(winners.map((t: any) => profitRatioOf(t)).filter((v: number) => v > 0));
    const avgLossRatio = avg(losers.map((t: any) => Math.abs(profitRatioOf(t))).filter((v: number) => v > 0));

    const avgWinAbs = avg(winners.map((t: any) => profitAbsOf(t)).filter((v: number) => v > 0));
    const avgLossAbs = avg(losers.map((t: any) => Math.abs(profitAbsOf(t))).filter((v: number) => v > 0));

    const expectancy = (winRate * avgWinRatio) - (lossRate * avgLossRatio);

    const redFlags: string[] = [];
    let diagnosis = "";

    if (totalTrades === 0) {
      diagnosis = "No trades were executed. Strategy may be over-filtered or conditions never trigger.";
      redFlags.push("No trades executed");
    } else {
      if (winRate > 0.5 && expectancy < 0) {
        diagnosis = "Win rate is decent but expectancy is negative: average losses are likely too large compared to wins.";
        redFlags.push("Loss magnitude dominates wins");
      } else if (winRate < 0.5 && avgWinRatio > avgLossRatio && expectancy < 0) {
        diagnosis = "Average wins exceed average losses, but low win rate makes expectancy negative: entries may be too early/late or too frequent in noise.";
        redFlags.push("Low win rate / entry timing issue");
      } else if (winRate < 0.4 && avgWinRatio < avgLossRatio) {
        diagnosis = "Both win rate and payoff ratio are unfavorable: signals may have little edge or exits are poor.";
        redFlags.push("Signal quality failure");
      } else if (expectancy >= 0) {
        diagnosis = "Expectancy is non-negative. Focus on robustness (avoid overfitting) and risk constraints (drawdown).";
      } else {
        diagnosis = "Expectancy is negative. Improve either win rate (signal quality) or payoff ratio (cut losses / let winners run).";
      }

      if (totalTrades < 30) redFlags.push("Low sample size (< 30 trades)");
    }

    const openTimes = trades.map((t: any) => toMs(t?.open_date ?? t?.openDate ?? t?.open_time)).filter(Number.isFinite);
    const closeTimes = trades.map((t: any) => toMs(t?.close_date ?? t?.closeDate ?? t?.close_time)).filter(Number.isFinite);

    const startMs = openTimes.length ? Math.min(...openTimes) : NaN;
    const endMs = closeTimes.length ? Math.max(...closeTimes) : NaN;
    const days = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1 / 24, (endMs - startMs) / (1000 * 60 * 60 * 24))
      : 0;

    const tradesPerDay = days > 0 ? totalTrades / days : 0;
    if (tradesPerDay > 50) redFlags.push("Very high trade frequency (> 50 trades/day) suggests noise trading");

    const avgTimeInMarketHours = avg(trades.map((t: any) => {
      const o = toMs(t?.open_date ?? t?.openDate ?? t?.open_time);
      const c = toMs(t?.close_date ?? t?.closeDate ?? t?.close_time);
      if (!Number.isFinite(o) || !Number.isFinite(c) || c < o) return 0;
      return (c - o) / (1000 * 60 * 60);
    }).filter((v: number) => v > 0));

    const isShort = (t: any) => {
      if (typeof t?.is_short === "boolean") return t.is_short;
      if (typeof t?.isShort === "boolean") return t.isShort;
      const dir = String(t?.direction ?? t?.trade_direction ?? "").toLowerCase();
      return dir === "short";
    };

    const shortCount = trades.filter((t: any) => isShort(t)).length;
    const longCount = Math.max(0, totalTrades - shortCount);
    const longShortRatio = shortCount > 0 ? longCount / shortCount : longCount;

    const avgCapitalDeployedPct = avg(trades.map((t: any) => {
      const stake = Number(t?.stake_amount);
      const eqBefore = Number(t?.equity_before ?? t?.equityBefore);
      if (!Number.isFinite(stake) || !Number.isFinite(eqBefore) || eqBefore <= 0) return 0;
      return (stake / eqBefore) * 100;
    }).filter((v: number) => v > 0));

    if (avgCapitalDeployedPct > 90) redFlags.push("Very high capital deployment per trade (> 90%) increases exposure risk");

    return {
      expectancy: {
        winRate,
        avgWin: avgWinRatio,
        avgLoss: avgLossRatio,
        lossRate,
        expectancy,
        diagnosis,
        redFlags,
        totals: {
          totalTrades,
          winners: winners.length,
          losers: losers.length,
          breakeven: breakeven.length,
          avgWinAbs,
          avgLossAbs,
        },
      },
      distribution: {
        totalTrades,
        tradesPerDay,
        longCount,
        shortCount,
        longShortRatio,
        capitalDeployedPct: avgCapitalDeployedPct,
        avgTimeInMarketHours,
        redFlags,
      },
    };
  }
}
