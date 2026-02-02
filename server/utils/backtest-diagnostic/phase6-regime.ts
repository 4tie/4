import path from "path";
import fs from "fs/promises";
import { detectRegimesFromCandles, TrendLabel, VolLabel } from "./regime-detector";
import { findCandleIndexAtOrBefore, loadCandles } from "./ohlcv";

export interface PairPerformance {
  pair: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnLAbs: number;
  pnlShareAbs: number;
}

export interface AssetConcentration {
  topPairPnlShareAbs: number | null;
  top3PnlShareAbs: number | null;
  redFlags: string[];
}

export interface AssetAnalysis {
  topPairs: PairPerformance[];
  concentration: AssetConcentration;
}

export interface RegimePerformance {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnLAbs: number;
  avgPnLAbs: number;
}

export interface RegimeSegmentation {
  available: boolean;
  source: "btc_ohlcv" | "trade_time_buckets";
  usedTimeframe: string | null;
  usedExchange: string | null;
  benchmarkPair: string | null;
  performanceByRegime: RegimePerformance[];
  redFlags: string[];
}

export interface RegimeAnalysisReport {
  regimeSegmentation: RegimeSegmentation;
  assetAnalysis: AssetAnalysis;
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

function normalizeExchangeName(exchangeName: string): string {
  return String(exchangeName || "").trim().toLowerCase();
}

async function detectExchangeFromConfig(): Promise<string | null> {
  try {
    const cfgPath = path.join(process.cwd(), "user_data", "config.json");
    const raw = await fs.readFile(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    const ex = cfg?.exchange?.name ?? cfg?.exchange;
    if (typeof ex === "string" && ex.trim()) return normalizeExchangeName(ex);
    return null;
  } catch {
    return null;
  }
}

async function detectTimeframeFromConfig(): Promise<string | null> {
  try {
    const cfgPath = path.join(process.cwd(), "user_data", "config.json");
    const raw = await fs.readFile(cfgPath, "utf-8");
    const cfg = JSON.parse(raw);
    const tf = cfg?.timeframe;
    if (typeof tf === "string" && tf.trim()) return tf.trim();
    return null;
  } catch {
    return null;
  }
}

function weekKeyUTC(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class Phase6Regime {
  async analyze(backtestData: any): Promise<RegimeAnalysisReport> {
    const trades: any[] = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const assetAnalysis = this.analyzeAssets(trades);

    const timeframeFromStrategy = (() => {
      const strat = backtestData?.strategy?.[Object.keys(backtestData?.strategy ?? {})[0]];
      const tf = strat?.timeframe;
      return typeof tf === "string" && tf.trim() ? tf.trim() : null;
    })();

    const exchange = (await detectExchangeFromConfig()) || "binance";
    const timeframe = timeframeFromStrategy || (await detectTimeframeFromConfig());

    const startEnd = (() => {
      let start: number | null = null;
      let end: number | null = null;
      for (const t of trades) {
        const o = parseDate(t?.open_date);
        const c = parseDate(t?.close_date);
        if (o) start = start == null ? o.getTime() : Math.min(start, o.getTime());
        if (c) end = end == null ? c.getTime() : Math.max(end, c.getTime());
      }
      return { start, end };
    })();

    const benchPair = "BTC/USDT";

    if (!timeframe || startEnd.start == null || startEnd.end == null) {
      return {
        regimeSegmentation: this.analyzeTimeBuckets(trades, {
          usedTimeframe: timeframe,
          usedExchange: exchange,
          benchmarkPair: benchPair,
        }),
        assetAnalysis,
      };
    }
    const candlesResult = await loadCandles({
      exchange,
      pair: benchPair,
      timeframe,
      startMs: startEnd.start - 1000 * 60 * 60 * 24 * 14,
      endMs: startEnd.end + 1000 * 60 * 60 * 24 * 2,
    });

    if (!candlesResult) {
      return {
        regimeSegmentation: this.analyzeTimeBuckets(trades, { usedTimeframe: timeframe, usedExchange: exchange, benchmarkPair: benchPair }),
        assetAnalysis,
      };
    }

    const { points } = detectRegimesFromCandles(candlesResult.candles, timeframe);

    const buckets = new Map<string, { trades: number; wins: number; totalPnLAbs: number }>();

    for (const tr of trades) {
      const open = parseDate(tr?.open_date);
      if (!open) continue;
      const profitAbs = (() => {
        const v = toNum(tr?.profit_abs);
        if (v != null) return v;
        const pr = toNum(tr?.profit_ratio);
        const stake = toNum(tr?.stake_amount);
        if (pr != null && stake != null) return pr * stake;
        return 0;
      })();

      const idx = findCandleIndexAtOrBefore(candlesResult.candles, open.getTime());
      const rp = idx >= 0 && idx < points.length ? points[idx] : null;
      const trend: TrendLabel = rp?.trend ?? "unknown";
      const vol: VolLabel = rp?.vol ?? "unknown";
      const key = `${trend}/${vol}`;

      const b = buckets.get(key) || { trades: 0, wins: 0, totalPnLAbs: 0 };
      b.trades += 1;
      if (profitAbs > 0) b.wins += 1;
      b.totalPnLAbs += profitAbs;
      buckets.set(key, b);
    }

    const performanceByRegime: RegimePerformance[] = Array.from(buckets.entries())
      .map(([key, v]) => ({
        key,
        trades: v.trades,
        wins: v.wins,
        winRate: v.trades > 0 ? v.wins / v.trades : 0,
        totalPnLAbs: v.totalPnLAbs,
        avgPnLAbs: v.trades > 0 ? v.totalPnLAbs / v.trades : 0,
      }))
      .sort((a, b) => a.totalPnLAbs - b.totalPnLAbs);

    const redFlags: string[] = [];
    const best = performanceByRegime.length ? performanceByRegime[performanceByRegime.length - 1] : null;
    const worst = performanceByRegime.length ? performanceByRegime[0] : null;
    if (best && worst && best.totalPnLAbs > 0 && worst.totalPnLAbs < 0) {
      redFlags.push(`Performance varies strongly by regime (best: ${best.key} ${best.totalPnLAbs.toFixed(2)}, worst: ${worst.key} ${worst.totalPnLAbs.toFixed(2)}).`);
    }

    return {
      regimeSegmentation: {
        available: true,
        source: "btc_ohlcv",
        usedTimeframe: timeframe,
        usedExchange: exchange,
        benchmarkPair: benchPair,
        performanceByRegime,
        redFlags,
      },
      assetAnalysis,
    };
  }

  private analyzeAssets(trades: any[]): AssetAnalysis {
    const perPair = new Map<string, { trades: number; wins: number; totalPnLAbs: number }>();

    let totalAbs = 0;

    for (const tr of trades) {
      const pair = String(tr?.pair ?? "").trim() || "unknown";
      const profitAbs = (() => {
        const v = toNum(tr?.profit_abs);
        if (v != null) return v;
        const pr = toNum(tr?.profit_ratio);
        const stake = toNum(tr?.stake_amount);
        if (pr != null && stake != null) return pr * stake;
        return 0;
      })();

      totalAbs += Math.abs(profitAbs);

      const p = perPair.get(pair) || { trades: 0, wins: 0, totalPnLAbs: 0 };
      p.trades += 1;
      if (profitAbs > 0) p.wins += 1;
      p.totalPnLAbs += profitAbs;
      perPair.set(pair, p);
    }

    const list: PairPerformance[] = Array.from(perPair.entries())
      .map(([pair, v]) => ({
        pair,
        trades: v.trades,
        wins: v.wins,
        winRate: v.trades > 0 ? v.wins / v.trades : 0,
        totalPnLAbs: v.totalPnLAbs,
        pnlShareAbs: totalAbs > 0 ? Math.abs(v.totalPnLAbs) / totalAbs : 0,
      }))
      .sort((a, b) => Math.abs(b.totalPnLAbs) - Math.abs(a.totalPnLAbs));

    const topPairs = list.slice(0, 10);

    const topPairShare = topPairs.length ? topPairs[0].pnlShareAbs : null;
    const top3Share = topPairs.length
      ? topPairs.slice(0, 3).reduce((s, p) => s + p.pnlShareAbs, 0)
      : null;

    const redFlags: string[] = [];
    if (topPairShare != null && topPairShare >= 0.5) {
      redFlags.push(`PnL is highly concentrated in one pair (${(topPairShare * 100).toFixed(1)}% of absolute PnL).`);
    }
    if (top3Share != null && top3Share >= 0.8) {
      redFlags.push(`PnL is concentrated in the top 3 pairs (${(top3Share * 100).toFixed(1)}% of absolute PnL).`);
    }

    return {
      topPairs,
      concentration: {
        topPairPnlShareAbs: topPairShare,
        top3PnlShareAbs: top3Share,
        redFlags,
      },
    };
  }

  private analyzeTimeBuckets(
    trades: any[],
    opts?: { usedTimeframe: string | null; usedExchange: string | null; benchmarkPair: string | null },
  ): RegimeSegmentation {
    const buckets = new Map<string, { trades: number; wins: number; totalPnLAbs: number }>();

    for (const tr of trades) {
      const open = parseDate(tr?.open_date);
      if (!open) continue;
      const profitAbs = (() => {
        const v = toNum(tr?.profit_abs);
        if (v != null) return v;
        const pr = toNum(tr?.profit_ratio);
        const stake = toNum(tr?.stake_amount);
        if (pr != null && stake != null) return pr * stake;
        return 0;
      })();

      const key = weekKeyUTC(open);
      const b = buckets.get(key) || { trades: 0, wins: 0, totalPnLAbs: 0 };
      b.trades += 1;
      if (profitAbs > 0) b.wins += 1;
      b.totalPnLAbs += profitAbs;
      buckets.set(key, b);
    }

    const perf: RegimePerformance[] = Array.from(buckets.entries())
      .map(([key, v]) => ({
        key,
        trades: v.trades,
        wins: v.wins,
        winRate: v.trades > 0 ? v.wins / v.trades : 0,
        totalPnLAbs: v.totalPnLAbs,
        avgPnLAbs: v.trades > 0 ? v.totalPnLAbs / v.trades : 0,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    const redFlags: string[] = [];
    const totals = perf.map((p) => p.totalPnLAbs);
    const max = totals.length ? Math.max(...totals) : 0;
    const min = totals.length ? Math.min(...totals) : 0;
    if (max > 0 && min < 0) {
      redFlags.push(`Weekly performance swings between ${min.toFixed(2)} and ${max.toFixed(2)} (regime dependence likely).`);
    }

    return {
      available: perf.length > 0,
      source: "trade_time_buckets",
      usedTimeframe: opts?.usedTimeframe ?? null,
      usedExchange: opts?.usedExchange ?? null,
      benchmarkPair: opts?.benchmarkPair ?? null,
      performanceByRegime: perf,
      redFlags,
    };
  }
}
