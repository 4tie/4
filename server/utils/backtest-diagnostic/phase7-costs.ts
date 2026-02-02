import path from "path";
import fs from "fs/promises";
import { loadCandles } from "./ohlcv";

export interface CostSensitivityAnalysis {
  originalProfit: number;
  with25pctMoreFees: number;
  with50pctMoreSlippage: number;
  combinedStress: number;
  edgeViable: boolean;
  verdict: string;
}

export type LiquidityRisk = "low" | "medium" | "high" | "unknown";

export interface LiquidityAnalysis {
  avgOrderSize: number | null;
  avgMarketVolume: number | null;
  orderToVolumeRatio: number | null;
  unrealisticFills: boolean | null;
  liquidityRisk: LiquidityRisk;
}

export interface CostAnalysisReport {
  costSensitivity: CostSensitivityAnalysis;
  liquidity: LiquidityAnalysis;
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
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function normalizeExchangeName(exchangeName: string): string {
  return String(exchangeName || "").trim().toLowerCase();
}

async function readConfigJson(): Promise<any | null> {
  try {
    const cfgPath = path.join(process.cwd(), "user_data", "config.json");
    const raw = await fs.readFile(cfgPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function detectExchangeFromConfig(): Promise<string | null> {
  const cfg = await readConfigJson();
  const ex = cfg?.exchange?.name ?? cfg?.exchange;
  if (typeof ex === "string" && ex.trim()) return normalizeExchangeName(ex);
  return null;
}

async function detectTimeframeFromConfig(): Promise<string | null> {
  const cfg = await readConfigJson();
  const tf = cfg?.timeframe;
  if (typeof tf === "string" && tf.trim()) return tf.trim();
  return null;
}

async function detectTakerFeeFromConfig(): Promise<number | null> {
  const cfg = await readConfigJson();
  const fee = cfg?.exchange?.fees?.taker ?? cfg?.exchange?.fees?.maker;
  const n = toNum(fee);
  if (n == null) return null;
  if (n < 0 || n > 0.05) return null;
  return n;
}

export class Phase7Costs {
  async analyze(backtestData: any): Promise<CostAnalysisReport> {
    const trades: any[] = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const profitAbsTotal = (() => {
      const n = toNum(backtestData?.profit_abs_total);
      if (n != null) return n;
      let s = 0;
      for (const t of trades) s += toNum(t?.profit_abs) ?? 0;
      return s;
    })();

    const takerFee = (await detectTakerFeeFromConfig()) ?? 0.001;
    const feeRateTotal = takerFee * 2;

    const baseSlippageRateTotal = 0.0005;

    let baselineFeeCost = 0;
    let baselineSlippageCost = 0;
    let stakeSum = 0;
    let stakeCount = 0;

    const pairCounts = new Map<string, number>();

    let start: number | null = null;
    let end: number | null = null;

    for (const t of trades) {
      const stake = toNum(t?.stake_amount);
      if (stake != null) {
        baselineFeeCost += stake * feeRateTotal;
        baselineSlippageCost += stake * baseSlippageRateTotal;
        stakeSum += stake;
        stakeCount += 1;
      }

      const pair = String(t?.pair ?? "").trim();
      if (pair) pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);

      const o = parseDate(t?.open_date);
      const c = parseDate(t?.close_date);
      if (o) start = start == null ? o.getTime() : Math.min(start, o.getTime());
      if (c) end = end == null ? c.getTime() : Math.max(end, c.getTime());
    }

    const with25pctMoreFees = profitAbsTotal - baselineFeeCost * 0.25;
    const with50pctMoreSlippage = profitAbsTotal - baselineSlippageCost * 0.5;
    const combinedStress = profitAbsTotal - baselineFeeCost * 0.25 - baselineSlippageCost * 0.5;

    const costVerdict = (() => {
      if (!Number.isFinite(profitAbsTotal)) return "Unknown";
      if (profitAbsTotal <= 0) return "Already unprofitable (cost stress does not help).";
      if (combinedStress <= 0) return "Edge disappears under higher fees/slippage.";
      if (combinedStress / profitAbsTotal < 0.5) return "Edge is very thin after costs (material degradation).";
      return "Edge appears robust to reasonable execution costs.";
    })();

    const edgeViable = combinedStress > 0;

    const exchange = (await detectExchangeFromConfig()) || "binance";
    const timeframe = (await detectTimeframeFromConfig()) || null;

    const avgOrderSize = stakeCount > 0 ? stakeSum / stakeCount : null;

    const liquidity = await this.analyzeLiquidity({
      trades,
      exchange,
      timeframe,
      startMs: start,
      endMs: end,
      avgOrderSize,
      pairCounts,
    });

    const redFlags: string[] = [];
    if (profitAbsTotal > 0 && combinedStress <= 0) {
      redFlags.push("Profitability disappears under conservative fees/slippage stress (edge too thin).");
    }
    if (liquidity.unrealisticFills) {
      redFlags.push("Order sizes may be too large relative to market volume (unrealistic fills / slippage underestimated).");
    }

    return {
      costSensitivity: {
        originalProfit: profitAbsTotal,
        with25pctMoreFees,
        with50pctMoreSlippage,
        combinedStress,
        edgeViable,
        verdict: costVerdict,
      },
      liquidity,
      redFlags,
    };
  }

  private async analyzeLiquidity(opts: {
    trades: any[];
    exchange: string;
    timeframe: string | null;
    startMs: number | null;
    endMs: number | null;
    avgOrderSize: number | null;
    pairCounts: Map<string, number>;
  }): Promise<LiquidityAnalysis> {
    const { exchange, timeframe, startMs, endMs, avgOrderSize, pairCounts } = opts;

    if (!timeframe || startMs == null || endMs == null) {
      return {
        avgOrderSize,
        avgMarketVolume: null,
        orderToVolumeRatio: null,
        unrealisticFills: null,
        liquidityRisk: "unknown",
      };
    }

    const topPairs = Array.from(pairCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map((x) => x[0]);

    const avgVolumes: number[] = [];

    for (const pair of topPairs) {
      const candles = await loadCandles({
        exchange,
        pair,
        timeframe,
        startMs: startMs - 1000 * 60 * 60 * 24 * 2,
        endMs: endMs + 1000 * 60 * 60 * 24 * 1,
      });

      if (!candles?.candles?.length) continue;

      let sum = 0;
      let count = 0;
      for (const c of candles.candles) {
        const notional = c.volume * c.close;
        if (!Number.isFinite(notional) || notional <= 0) continue;
        sum += notional;
        count += 1;
      }
      if (count <= 0) continue;
      avgVolumes.push(sum / count);
    }

    const avgMarketVolume = median(avgVolumes);
    const ratio = avgOrderSize != null && avgMarketVolume != null && avgMarketVolume > 0 ? avgOrderSize / avgMarketVolume : null;

    const liquidityRisk: LiquidityRisk = (() => {
      if (ratio == null) return "unknown";
      if (ratio >= 0.03) return "high";
      if (ratio >= 0.01) return "medium";
      return "low";
    })();

    const unrealisticFills = ratio == null ? null : ratio >= 0.02;

    return {
      avgOrderSize,
      avgMarketVolume,
      orderToVolumeRatio: ratio,
      unrealisticFills,
      liquidityRisk,
    };
  }
}
