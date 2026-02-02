import { 
  StructuralIntegrityReport, 
  DataContinuityCheck, 
  LookAheadBiasCheck, 
  LogicFeasibilityCheck 
} from "./types";
import fs from "fs/promises";
import path from "path";

export class Phase1Structural {
  async analyze(backtestData: any, strategyContent: string, context?: { backtestId?: string | number }): Promise<StructuralIntegrityReport> {
    const dataContinuity = await this.checkDataContinuity(backtestData, context?.backtestId);
    const lookAheadBias = this.checkLookAheadBias(strategyContent);
    const logicFeasibility = this.checkLogicFeasibility(strategyContent);

    const verdict: 'PASS' | 'WARN' | 'FAIL' = (() => {
      if (dataContinuity.verdict === 'FAIL') return 'FAIL';
      if (lookAheadBias.verdict === 'FAIL') return 'FAIL';
      if (logicFeasibility.verdict === 'FAIL') return 'FAIL';
      if (dataContinuity.verdict === 'WARN') return 'WARN';
      return 'PASS';
    })();

    return {
      verdict,
      dataContinuity,
      lookAheadBias,
      logicFeasibility
    };
  }

  private timeframeToMs(timeframe: string): number | null {
    const tf = String(timeframe || '').trim();
    const map: Record<string, number> = {
      '1m': 60_000,
      '5m': 5 * 60_000,
      '15m': 15 * 60_000,
      '1h': 60 * 60_000,
      '4h': 4 * 60 * 60_000,
      '1d': 24 * 60 * 60_000,
    };
    return map[tf] ?? null;
  }

  private parseTimerange(timerange: string): { startMs?: number; endMs?: number } {
    const tr = String(timerange || '').trim();
    const m = tr.match(/^(\d{8})-(\d{8})?$/);
    if (!m) return {};
    const start = m[1];
    const end = m[2];

    const toUtcMs = (yyyymmdd: string, endOfDay: boolean) => {
      const yyyy = Number(yyyymmdd.slice(0, 4));
      const mm = Number(yyyymmdd.slice(4, 6));
      const dd = Number(yyyymmdd.slice(6, 8));
      if (![yyyy, mm, dd].every(Number.isFinite)) return NaN;
      const d = endOfDay
        ? Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999)
        : Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0);
      return d;
    };

    const startMs = toUtcMs(start, false);
    const endMs = end ? toUtcMs(end, true) : NaN;
    return {
      startMs: Number.isFinite(startMs) ? startMs : undefined,
      endMs: Number.isFinite(endMs) ? endMs : undefined,
    };
  }

  private async checkOhlcvContinuity(opts: {
    backtestId?: string | number;
    timerange?: string;
  }): Promise<{
    verified: boolean;
    gapCount: number;
    largestGapMinutes: number;
    missingFiles: Array<{ pair: string; timeframe: string; path: string }>;
    unverifiedFiles: Array<{ pair: string; timeframe: string; path: string }>;
  }> {
    const verifiedDefault = {
      verified: false,
      gapCount: 0,
      largestGapMinutes: 0,
      missingFiles: [] as Array<{ pair: string; timeframe: string; path: string }>,
      unverifiedFiles: [] as Array<{ pair: string; timeframe: string; path: string }>,
    };

    const idRaw = opts.backtestId === undefined || opts.backtestId === null ? '' : String(opts.backtestId);
    if (!/^\d+$/.test(idRaw)) {
      return verifiedDefault;
    }

    const projectRoot = process.cwd();
    const runDir = path.join(projectRoot, 'user_data', 'backtest_results', 'runs', idRaw);
    const runConfigPath = path.join(runDir, 'run-config.json');

    let runConfig: any;
    try {
      const raw = await fs.readFile(runConfigPath, 'utf-8');
      runConfig = JSON.parse(raw);
    } catch {
      return verifiedDefault;
    }

    const exchange = String(runConfig?.exchange?.name || '').trim();
    const timeframe = String(runConfig?.timeframe || '').trim();
    const dataformat = String(runConfig?.dataformat_ohlcv || '').trim() || 'json';

    const pairs = Array.isArray(runConfig?.exchange?.pair_whitelist)
      ? (runConfig.exchange.pair_whitelist as any[]).map((p) => String(p)).filter((p) => p.trim().length > 0)
      : [];

    if (!exchange || !timeframe || pairs.length === 0) {
      return verifiedDefault;
    }

    const stepMs = this.timeframeToMs(timeframe);
    if (!stepMs) {
      return {
        ...verifiedDefault,
        unverifiedFiles: pairs.map((pair) => ({
          pair,
          timeframe,
          path: path.join(projectRoot, 'user_data', 'data', exchange, `${pair.replace(/\//g, '_')}-${timeframe}.${dataformat}`),
        })),
      };
    }

    const { startMs, endMs } = this.parseTimerange(String(opts.timerange || ''));

    const dataDir = path.join(projectRoot, 'user_data', 'data', exchange);

    let verified = dataformat === 'json';
    let gapCount = 0;
    let largestGapMinutes = 0;
    const missingFiles: Array<{ pair: string; timeframe: string; path: string }> = [];
    const unverifiedFiles: Array<{ pair: string; timeframe: string; path: string }> = [];

    for (const pair of pairs) {
      const pairFileBase = String(pair).replace(/\//g, '_');
      const jsonPath = path.join(dataDir, `${pairFileBase}-${timeframe}.json`);
      const featherPath = path.join(dataDir, `${pairFileBase}-${timeframe}.feather`);

      const expected = dataformat === 'feather' ? featherPath : jsonPath;

      try {
        await fs.access(expected);
      } catch {
        const alt = expected === jsonPath ? featherPath : jsonPath;
        try {
          await fs.access(alt);
        } catch {
          missingFiles.push({ pair, timeframe, path: expected });
          continue;
        }
      }

      if (dataformat !== 'json') {
        verified = false;
        unverifiedFiles.push({ pair, timeframe, path: expected });
        continue;
      }

      try {
        const raw = await fs.readFile(jsonPath, 'utf-8');
        const candles = JSON.parse(raw) as any;
        if (!Array.isArray(candles) || candles.length < 2) {
          gapCount += 1;
          if (largestGapMinutes < 0) largestGapMinutes = 0;
          continue;
        }

        let prevTs: number | null = null;
        for (const row of candles) {
          if (!Array.isArray(row) || row.length < 1) continue;
          const ts = Number(row[0]);
          if (!Number.isFinite(ts)) continue;
          if (startMs !== undefined && ts < startMs) continue;
          if (endMs !== undefined && ts > endMs) continue;

          if (prevTs !== null) {
            const diff = ts - prevTs;
            if (diff > stepMs) {
              gapCount += 1;
              const gapMin = diff / 60000;
              if (gapMin > largestGapMinutes) largestGapMinutes = gapMin;
            } else if (diff < 0) {
              gapCount += 1;
              const gapMin = Math.abs(diff) / 60000;
              if (gapMin > largestGapMinutes) largestGapMinutes = gapMin;
            }
          }
          prevTs = ts;
        }
      } catch {
        verified = false;
        unverifiedFiles.push({ pair, timeframe, path: jsonPath });
      }
    }

    return {
      verified,
      gapCount,
      largestGapMinutes,
      missingFiles,
      unverifiedFiles,
    };
  }

  private async checkDataContinuity(data: any, backtestId?: string | number): Promise<DataContinuityCheck> {
    const trades = Array.isArray(data?.trades) ? data.trades : [];
    if (trades.length === 0) {
      return {
        hasMissingBars: true,
        gapCount: 0,
        largestGapMinutes: 0,
        ohlcvVerified: false,
        ohlcvGapCount: 0,
        ohlcvLargestGapMinutes: 0,
        missingDataFiles: [],
        unverifiedDataFiles: [],
        timestampSequenceValid: false,
        verdict: 'FAIL',
        details: 'No trades found in backtest results. Cannot validate timestamp continuity.'
      };
    }

    const toMs = (v: any) => {
      const d = v ? new Date(v) : null;
      const ms = d ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : NaN;
    };

    const times = trades
      .map((t: any, idx: number) => {
        const msClose = toMs(t?.close_date ?? t?.closeDate ?? t?.close_time);
        const msOpen = toMs(t?.open_date ?? t?.openDate ?? t?.open_time);
        const ms = Number.isFinite(msClose) ? msClose : msOpen;
        return { idx, ms };
      })
      .filter((x: any) => Number.isFinite(x.ms));

    const timestampSequenceValid = times.length === trades.length && (() => {
      for (let i = 1; i < times.length; i++) {
        if (times[i].ms < times[i - 1].ms) return false;
      }
      return true;
    })();

    const sorted = times.slice().sort((a: any, b: any) => a.ms - b.ms);
    const diffsMin: number[] = [];
    let largestGapMinutes = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gapMin = Math.max(0, (sorted[i].ms - sorted[i - 1].ms) / 60000);
      diffsMin.push(gapMin);
      if (gapMin > largestGapMinutes) largestGapMinutes = gapMin;
    }

    const median = (() => {
      const arr = diffsMin.filter((v) => v > 0).sort((a, b) => a - b);
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    })();

    const gapThresholdMinutes = median > 0 ? Math.max(60, median * 10) : 24 * 60;
    const gapCount = diffsMin.filter((g) => g > gapThresholdMinutes).length;

    const timerange = (() => {
      const direct = String((data as any)?.timerange ?? '').trim();
      if (direct) return direct;
      const stratObj = (data as any)?.strategy;
      if (stratObj && typeof stratObj === 'object') {
        const keys = Object.keys(stratObj);
        const k = keys.length ? keys[0] : '';
        const v = k ? String(stratObj?.[k]?.timerange ?? '').trim() : '';
        if (v) return v;
      }
      return '';
    })();

    const ohlcv = await this.checkOhlcvContinuity({ backtestId, timerange });

    const hasOhlcvFail = ohlcv.missingFiles.length > 0 || ohlcv.gapCount > 0;
    const hasTradeGapWarn = timestampSequenceValid && gapCount > 0;

    const hasMissingBars = !timestampSequenceValid || hasOhlcvFail;
    const verdict: 'PASS' | 'WARN' | 'FAIL' = !timestampSequenceValid
      ? 'FAIL'
      : hasOhlcvFail
        ? 'FAIL'
        : hasTradeGapWarn
          ? 'WARN'
          : 'PASS';

    const details = !timestampSequenceValid
      ? 'Trade timestamps are missing/invalid or not monotonic in the results. This can invalidate analysis.'
      : hasOhlcvFail
        ? ohlcv.missingFiles.length
          ? `Missing OHLCV data files for selected pairs/timeframe (missing: ${ohlcv.missingFiles.length}).`
          : `Detected OHLCV candle timestamp gap(s) (count: ${ohlcv.gapCount}, largest: ${ohlcv.largestGapMinutes.toFixed(0)} min).`
        : hasTradeGapWarn
          ? `Detected ${gapCount} unusually large gap(s) between trade timestamps (largest: ${largestGapMinutes.toFixed(0)} min). This may simply be strategy inactivity. OHLCV continuity ${ohlcv.verified ? 'verified' : 'not fully verified'}.`
          : `Trade timestamps appear consistent with no unusually large gaps. OHLCV continuity ${ohlcv.verified ? 'verified' : 'not fully verified'}.`;

    return {
      hasMissingBars,
      gapCount,
      largestGapMinutes,
      ohlcvVerified: ohlcv.verified,
      ohlcvGapCount: ohlcv.gapCount,
      ohlcvLargestGapMinutes: ohlcv.largestGapMinutes,
      missingDataFiles: ohlcv.missingFiles,
      unverifiedDataFiles: ohlcv.unverifiedFiles,
      timestampSequenceValid,
      verdict,
      details,
    };
  }

  private checkLookAheadBias(content: string): LookAheadBiasCheck {
    const suspicious = [];
    if (content.includes('shift(-')) suspicious.push('Negative shift (future data reference)');
    
    return {
      hasLookAheadBias: suspicious.length > 0,
      detectedIndicators: [],
      suspiciousConditions: suspicious,
      verdict: suspicious.length === 0 ? 'PASS' : 'FAIL',
      details: suspicious.length === 0 ? 'No obvious look-ahead bias detected.' : `Suspicious patterns found: ${suspicious.join(', ')}`
    };
  }

  private checkLogicFeasibility(content: string): LogicFeasibilityCheck {
    const src = String(content || "");
    const conflictingRules: string[] = [];
    const mutuallyExclusiveConditions: string[] = [];

    if (!src.trim()) {
      return {
        hasImpossibleConditions: true,
        conflictingRules: ["Strategy source is empty or could not be loaded."],
        mutuallyExclusiveConditions: [],
        verdict: 'FAIL',
        details: 'No strategy content to analyze.'
      };
    }

    const hasIStrategy = /\bIStrategy\b/.test(src) || /\bclass\s+\w+\s*\(.*\)\s*:/.test(src);
    if (!hasIStrategy) {
      conflictingRules.push('No obvious strategy class detected (expected a class inheriting IStrategy).');
    }

    const hasEntryFn = /\bdef\s+populate_entry_trend\b/.test(src) || /\bdef\s+populate_buy_trend\b/.test(src);
    const hasExitFn = /\bdef\s+populate_exit_trend\b/.test(src) || /\bdef\s+populate_sell_trend\b/.test(src);

    if (!hasEntryFn) {
      conflictingRules.push('Missing entry function (populate_entry_trend or populate_buy_trend).');
    }

    const hasEnterSignals = /\benter_long\b/.test(src) || /\bbuy\b/.test(src) || /\benter_short\b/.test(src);
    if (hasEntryFn && !hasEnterSignals) {
      conflictingRules.push('Entry function exists but no entry signal columns detected (enter_long/buy/enter_short).');
    }

    const hasMinimalRoi = /\bminimal_roi\s*=\s*\{/.test(src);
    const stoplossMatch = src.match(/\bstoploss\s*=\s*(-?\d+(?:\.\d+)?)/);
    const stoplossVal = stoplossMatch ? Number(stoplossMatch[1]) : NaN;
    const hasStoploss = stoplossMatch !== null;

    if (hasStoploss && Number.isFinite(stoplossVal) && stoplossVal >= 0) {
      conflictingRules.push(`stoploss is set to ${stoplossVal}, but in Freqtrade it is typically negative (e.g., -0.10).`);
    }

    if (!hasExitFn && !hasMinimalRoi && !hasStoploss) {
      conflictingRules.push('No exit mechanism detected (missing populate_exit_trend/sell + minimal_roi + stoploss). Trades may not close reliably.');
    }

    const canShortMatch = src.match(/\bcan_short\s*=\s*(True|False)/);
    const canShort = canShortMatch ? canShortMatch[1] === 'True' : null;
    if (canShort === false && /\benter_short\b/.test(src)) {
      conflictingRules.push('can_short is False but enter_short signals are present.');
    }

    for (const line of src.split(/\r?\n/)) {
      if (!/(\&|\band\b)/.test(line)) continue;
      const colMatch = line.match(/dataframe\[['\"]([^'\"]+)['\"]\]/g);
      if (!colMatch || colMatch.length === 0) continue;

      const colNames = colMatch.map((m) => {
        const mm = m.match(/dataframe\[['\"]([^'\"]+)['\"]\]/);
        return mm ? mm[1] : '';
      }).filter(Boolean);

      for (const col of Array.from(new Set(colNames))) {
        const lt = new RegExp(`dataframe\\[['\"]${col}['\"]\\]\\s*<\\s*([0-9]+(?:\\.[0-9]+)?)`);
        const gt = new RegExp(`dataframe\\[['\"]${col}['\"]\\]\\s*>\\s*([0-9]+(?:\\.[0-9]+)?)`);
        const ltM = line.match(lt);
        const gtM = line.match(gt);
        if (ltM && gtM) {
          const a = Number(ltM[1]);
          const b = Number(gtM[1]);
          if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
            mutuallyExclusiveConditions.push(`Potentially impossible condition on '${col}' in one rule: '${col} < ${a}' AND '${col} > ${b}'.`);
          }
        }
      }
    }

    const hasImpossibleConditions = mutuallyExclusiveConditions.length > 0;
    const verdict: 'PASS' | 'FAIL' = (hasImpossibleConditions || (!hasEntryFn) || conflictingRules.length > 0) ? 'FAIL' : 'PASS';
    const details = verdict === 'PASS'
      ? 'No obvious feasibility issues detected.'
      : [
          conflictingRules.length ? `Conflicts: ${conflictingRules.join(' | ')}` : '',
          mutuallyExclusiveConditions.length ? `Mutually exclusive: ${mutuallyExclusiveConditions.join(' | ')}` : ''
        ].filter(Boolean).join(' ');

    return {
      hasImpossibleConditions,
      conflictingRules,
      mutuallyExclusiveConditions,
      verdict,
      details,
    };
  }
}
