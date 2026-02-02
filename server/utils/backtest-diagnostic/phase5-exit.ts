export type ExitCategory =
  | "stopLoss"
  | "roiTarget"
  | "trailingStop"
  | "forceExit"
  | "timeout"
  | "exitSignal"
  | "other";

export interface ExitTypeStats {
  count: number;
  totalPnL: number;
  avgPnL: number;
}

export interface ExitReasonAnalysis {
  exitTypes: {
    stopLoss: ExitTypeStats;
    roiTarget: ExitTypeStats;
    trailingStop: ExitTypeStats;
    forceExit: ExitTypeStats;
    timeout: ExitTypeStats;
    exitSignal: ExitTypeStats;
    other: ExitTypeStats;
  };
  conclusions: string[];
}

export interface DurationComparison {
  avgWinnerDurationHours: number | null;
  avgLoserDurationHours: number | null;
  durationRatio: number | null;
  antiPatterns: string[];
}

export interface ExitLogicReport {
  exitReasons: ExitReasonAnalysis;
  duration: DurationComparison;
}

function toNum(v: any) {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function emptyStats(): ExitTypeStats {
  return { count: 0, totalPnL: 0, avgPnL: 0 };
}

function categorizeExitReason(reason: string): ExitCategory {
  const r = (reason || "").toLowerCase();
  if (r.includes("roi")) return "roiTarget";
  if (r.includes("trailing")) return "trailingStop";
  if (r.includes("timeout")) return "timeout";
  if (r.includes("force")) return "forceExit";
  if (r.includes("stop") && r.includes("loss")) return "stopLoss";
  if (r.includes("exit_signal")) return "exitSignal";
  return "other";
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  const s = values.reduce((a, b) => a + b, 0);
  return s / values.length;
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

export class Phase5Exit {
  analyze(backtestData: any): ExitLogicReport {
    const trades: any[] = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const exitTypes = {
      stopLoss: emptyStats(),
      roiTarget: emptyStats(),
      trailingStop: emptyStats(),
      forceExit: emptyStats(),
      timeout: emptyStats(),
      exitSignal: emptyStats(),
      other: emptyStats(),
    };

    let totalPnL = 0;

    const winnerDurations: number[] = [];
    const loserDurations: number[] = [];

    for (const tr of trades) {
      const reason = String(tr?.exit_reason ?? "");
      const cat = categorizeExitReason(reason);

      const profitAbs = (() => {
        const v = toNum(tr?.profit_abs);
        if (v != null) return v;
        const pr = toNum(tr?.profit_ratio);
        const stake = toNum(tr?.stake_amount);
        if (pr != null && stake != null) return pr * stake;
        return 0;
      })();

      totalPnL += profitAbs;
      exitTypes[cat].count += 1;
      exitTypes[cat].totalPnL += profitAbs;

      const open = parseDate(tr?.open_date);
      const close = parseDate(tr?.close_date);
      if (open && close) {
        const hours = Math.max(0, (close.getTime() - open.getTime()) / (1000 * 60 * 60));
        if (profitAbs > 0) winnerDurations.push(hours);
        else if (profitAbs < 0) loserDurations.push(hours);
      }
    }

    for (const k of Object.keys(exitTypes) as ExitCategory[]) {
      const t = exitTypes[k];
      t.avgPnL = t.count > 0 ? t.totalPnL / t.count : 0;
    }

    const conclusions: string[] = [];

    const absTotal = Math.abs(totalPnL) || 0;
    const stopLossShare = absTotal > 0 ? Math.abs(exitTypes.stopLoss.totalPnL) / absTotal : 0;

    if (exitTypes.stopLoss.count > 0 && exitTypes.stopLoss.totalPnL < 0 && stopLossShare >= 0.4) {
      conclusions.push("Stop losses are catastrophic compared to other exits (stop placement or invalidation logic likely needs work).");
    }

    if (exitTypes.timeout.count > 0 && exitTypes.timeout.avgPnL < 0) {
      conclusions.push("Timeout exits are net negative (the trade idea often becomes invalid if held too long).");
    }

    if (exitTypes.trailingStop.count > 0 && exitTypes.trailingStop.avgPnL > 0 && exitTypes.roiTarget.avgPnL > 0) {
      if (exitTypes.trailingStop.avgPnL < exitTypes.roiTarget.avgPnL * 0.4) {
        conclusions.push("Trailing stops may be cutting winners too early (trailing distance could be too tight).");
      }
    }

    if (exitTypes.exitSignal.count > 0 && exitTypes.exitSignal.avgPnL < 0) {
      conclusions.push("Exit signals are on average closing trades at a loss (exit conditions may be too reactive or too late).");
    }

    const avgWinner = avg(winnerDurations);
    const avgLoser = avg(loserDurations);
    const ratio = avgWinner != null && avgLoser != null && avgWinner > 0 ? avgLoser / avgWinner : null;

    const antiPatterns: string[] = [];
    if (ratio != null && ratio > 1.25) {
      antiPatterns.push("Losers are held longer than winners (common risk/reward anti-pattern).");
    }
    if (ratio != null && ratio < 0.8) {
      antiPatterns.push("Winners are held longer than losers (can be OK, but verify losers are cut fast enough).");
    }

    return {
      exitReasons: {
        exitTypes,
        conclusions,
      },
      duration: {
        avgWinnerDurationHours: avgWinner,
        avgLoserDurationHours: avgLoser,
        durationRatio: ratio,
        antiPatterns,
      },
    };
  }
}
