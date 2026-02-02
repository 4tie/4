export interface EntryTagStats {
  tag: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnLAbs: number;
  avgPnLAbs: number;
}

export interface EntryTimingAnalysis {
  medianWinnerDurationHours: number | null;
  medianLoserDurationHours: number | null;
  quickLoserPct: number | null;
  diagnosis: string;
  redFlags: string[];
}

export interface EntryQualityReport {
  byTag: EntryTagStats[];
  timing: EntryTimingAnalysis;
  redFlags: string[];
}

function toNum(v: any) {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

export class Phase4EntryQuality {
  analyze(backtestData: any): EntryQualityReport {
    const trades: any[] = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const byTagMap = new Map<string, { trades: number; wins: number; totalPnLAbs: number }>();

    const allDurations: number[] = [];
    const winnerDurations: number[] = [];
    const loserDurations: number[] = [];

    let losers = 0;
    let quickLosers = 0;

    const durationsForThreshold: Array<{ durationHours: number; isLoser: boolean }> = [];

    for (const tr of trades) {
      const tag = String(tr?.enter_tag ?? "").trim();
      const key = tag || "(empty)";

      const profitAbs = (() => {
        const v = toNum(tr?.profit_abs);
        if (v != null) return v;
        const pr = toNum(tr?.profit_ratio);
        const stake = toNum(tr?.stake_amount);
        if (pr != null && stake != null) return pr * stake;
        return 0;
      })();

      const open = parseDate(tr?.open_date);
      const close = parseDate(tr?.close_date);
      const durationHours = open && close ? Math.max(0, (close.getTime() - open.getTime()) / (1000 * 60 * 60)) : null;

      const curr = byTagMap.get(key) || { trades: 0, wins: 0, totalPnLAbs: 0 };
      curr.trades += 1;
      if (profitAbs > 0) curr.wins += 1;
      curr.totalPnLAbs += profitAbs;
      byTagMap.set(key, curr);

      if (durationHours != null) {
        allDurations.push(durationHours);
        durationsForThreshold.push({ durationHours, isLoser: profitAbs < 0 });
        if (profitAbs > 0) winnerDurations.push(durationHours);
        if (profitAbs < 0) loserDurations.push(durationHours);
      }

      if (profitAbs < 0) losers += 1;
    }

    const threshold = percentile(allDurations, 0.25);
    if (threshold != null) {
      for (const d of durationsForThreshold) {
        if (!d.isLoser) continue;
        if (d.durationHours <= threshold) quickLosers += 1;
      }
    }

    const byTag: EntryTagStats[] = Array.from(byTagMap.entries())
      .map(([tag, v]) => ({
        tag,
        trades: v.trades,
        wins: v.wins,
        winRate: v.trades > 0 ? v.wins / v.trades : 0,
        totalPnLAbs: v.totalPnLAbs,
        avgPnLAbs: v.trades > 0 ? v.totalPnLAbs / v.trades : 0,
      }))
      .sort((a, b) => a.totalPnLAbs - b.totalPnLAbs);

    const redFlags: string[] = [];

    const empty = byTag.find((t) => t.tag === "(empty)");
    if (empty && trades.length > 0 && empty.trades / trades.length >= 0.8) {
      redFlags.push("Most trades have an empty enter_tag. Consider setting enter_tag to track which entry rule is firing.");
    }

    const worst = byTag.find((t) => t.trades >= 5 && t.totalPnLAbs < 0);
    if (worst) {
      redFlags.push(`Entry tag '${worst.tag}' is losing overall (total PnL ${worst.totalPnLAbs.toFixed(2)} across ${worst.trades} trades).`);
    }

    const medianWinner = median(winnerDurations);
    const medianLoser = median(loserDurations);

    const quickLoserPct = (() => {
      if (!Number.isFinite(losers) || losers <= 0) return null;
      if (threshold == null) return null;
      return quickLosers / losers;
    })();

    const timingRedFlags: string[] = [];
    if (quickLoserPct != null && quickLoserPct >= 0.5) {
      timingRedFlags.push("Many losing trades close quickly after entry. This often indicates late/poor entries or noisy signals.");
    }

    const diagnosisParts: string[] = [];
    if (quickLoserPct != null) {
      diagnosisParts.push(`Quick loser ratio: ${(quickLoserPct * 100).toFixed(1)}% (based on the bottom 25% hold-time threshold).`);
    }
    if (medianWinner != null && medianLoser != null) {
      diagnosisParts.push(`Median hold time winners: ${medianWinner.toFixed(2)}h, losers: ${medianLoser.toFixed(2)}h.`);
    }

    return {
      byTag,
      timing: {
        medianWinnerDurationHours: medianWinner,
        medianLoserDurationHours: medianLoser,
        quickLoserPct,
        diagnosis: diagnosisParts.join(" "),
        redFlags: timingRedFlags,
      },
      redFlags,
    };
  }
}
