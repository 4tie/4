import { Candle, timeframeToMinutes } from "./ohlcv";

export type TrendLabel = "trend_up" | "trend_down" | "range" | "unknown";
export type VolLabel = "high" | "low" | "unknown";

export type RegimePoint = {
  ts: number;
  trend: TrendLabel;
  vol: VolLabel;
};

function sma(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (window <= 1) {
    for (let i = 0; i < values.length; i++) out[i] = values[i];
    return out;
  }

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function rollingStd(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (window < 2) return out;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += v;
    sumSq += v * v;

    if (i >= window) {
      const old = values[i - window];
      sum -= old;
      sumSq -= old * old;
    }

    if (i >= window - 1) {
      const mean = sum / window;
      const variance = Math.max(0, sumSq / window - mean * mean);
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

export function detectRegimesFromCandles(candles: Candle[], timeframe: string): {
  points: RegimePoint[];
  meta: { maFast: number; maSlow: number; volWindow: number; volMedian: number | null };
} {
  const closes = candles.map((c) => c.close);
  const tfMin = timeframeToMinutes(timeframe) ?? 60;
  const candlesPerDay = Math.max(1, Math.round((60 * 24) / tfMin));

  const maFast = Math.max(10, Math.round(candlesPerDay * 2));
  const maSlow = Math.max(maFast + 10, Math.round(candlesPerDay * 10));
  const volWindow = Math.max(10, Math.round(candlesPerDay * 3));

  const maF = sma(closes, maFast);
  const maS = sma(closes, maSlow);

  const rets: number[] = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    rets[i] = a > 0 && b > 0 ? Math.log(b / a) : 0;
  }

  const vol = rollingStd(rets, volWindow);
  const volValues = vol.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const volMedian = median(volValues);

  const points: RegimePoint[] = candles.map((c, i) => {
    const fast = maF[i];
    const slow = maS[i];
    let trend: TrendLabel = "unknown";

    if (typeof fast === "number" && typeof slow === "number") {
      if (c.close > slow && fast > slow) trend = "trend_up";
      else if (c.close < slow && fast < slow) trend = "trend_down";
      else trend = "range";
    }

    const v = vol[i];
    let volLabel: VolLabel = "unknown";
    if (typeof v === "number" && volMedian != null && volMedian > 0) {
      volLabel = v > volMedian * 1.25 ? "high" : "low";
    }

    return { ts: c.ts, trend, vol: volLabel };
  });

  return { points, meta: { maFast, maSlow, volWindow, volMedian } };
}
