import { 
  StructuralIntegrityReport, 
  DataContinuityCheck, 
  LookAheadBiasCheck, 
  LogicFeasibilityCheck 
} from "./types";

export class Phase1Structural {
  async analyze(backtestData: any, strategyContent: string): Promise<StructuralIntegrityReport> {
    const dataContinuity = this.checkDataContinuity(backtestData);
    const lookAheadBias = this.checkLookAheadBias(strategyContent);
    const logicFeasibility = this.checkLogicFeasibility(strategyContent);

    const verdict = (
      dataContinuity.verdict === 'PASS' && 
      lookAheadBias.verdict === 'PASS' && 
      logicFeasibility.verdict === 'PASS'
    ) ? 'PASS' : 'FAIL';

    return {
      verdict,
      dataContinuity,
      lookAheadBias,
      logicFeasibility
    };
  }

  private checkDataContinuity(data: any): DataContinuityCheck {
    const trades = Array.isArray(data?.trades) ? data.trades : [];
    if (trades.length === 0) {
      return {
        hasMissingBars: true,
        gapCount: 0,
        largestGapMinutes: 0,
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

    const hasMissingBars = !timestampSequenceValid || gapCount > 0;
    const verdict = hasMissingBars ? 'FAIL' : 'PASS';
    const details = !timestampSequenceValid
      ? 'Trade timestamps are missing/invalid or not monotonic in the results. This can invalidate analysis.'
      : gapCount > 0
        ? `Detected ${gapCount} unusually large gap(s) between trade timestamps (largest: ${largestGapMinutes.toFixed(0)} min). This may indicate data discontinuity or timerange gaps.`
        : 'Trade timestamps appear consistent with no unusually large gaps.';

    return {
      hasMissingBars,
      gapCount,
      largestGapMinutes,
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
