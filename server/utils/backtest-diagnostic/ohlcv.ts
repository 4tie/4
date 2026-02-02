import fs from "fs/promises";
import path from "path";

export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function timeframeToMinutes(timeframe: string): number | null {
  const tf = String(timeframe || "").trim().toLowerCase();
  const m = tf.match(/^([0-9]+)([mhd])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  if (unit === "m") return n;
  if (unit === "h") return n * 60;
  if (unit === "d") return n * 60 * 24;
  return null;
}

function normalizePairToFilename(pair: string): string {
  return String(pair || "")
    .trim()
    .replace("/", "_")
    .replace(":", "_");
}

function lowerBoundTs(candles: Candle[], ts: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundTs(candles: Candle[], ts: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function loadCandles(options: {
  exchange: string;
  pair: string;
  timeframe: string;
  startMs?: number;
  endMs?: number;
}): Promise<{ candles: Candle[]; sourcePath: string } | null> {
  const exchange = String(options.exchange || "").trim();
  const pair = String(options.pair || "").trim();
  const timeframe = String(options.timeframe || "").trim();

  if (!exchange || !pair || !timeframe) return null;

  const base = path.join(process.cwd(), "user_data", "data", exchange);
  const filename = `${normalizePairToFilename(pair)}-${timeframe}.json`;
  const p = path.join(base, filename);

  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const candles: Candle[] = [];
    for (const row of parsed) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const ts = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
      candles.push({ ts, open, high, low, close, volume });
    }

    if (!candles.length) return null;

    const startMs = options.startMs;
    const endMs = options.endMs;
    if (Number.isFinite(startMs) || Number.isFinite(endMs)) {
      const s = Number.isFinite(startMs) ? Number(startMs) : candles[0].ts;
      const e = Number.isFinite(endMs) ? Number(endMs) : candles[candles.length - 1].ts;
      const i0 = lowerBoundTs(candles, s);
      const i1 = upperBoundTs(candles, e);
      return { candles: candles.slice(Math.max(0, i0 - 2), Math.min(candles.length, i1 + 2)), sourcePath: p };
    }

    return { candles, sourcePath: p };
  } catch {
    return null;
  }
}

export function findCandleIndexAtOrBefore(candles: Candle[], ts: number): number {
  if (!candles.length) return -1;
  const i = upperBoundTs(candles, ts) - 1;
  if (i < 0) return -1;
  return i;
}
