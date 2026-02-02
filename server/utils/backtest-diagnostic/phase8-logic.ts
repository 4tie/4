export interface SignalConflictAnalysis {
  conflictingIndicators: string[];
  briefSignalInstability: boolean;
  impossibleCycles: string[];
  logicErrors: string[];
}

export type OverfittingRisk = "low" | "medium" | "high";

export interface OverfittingAnalysis {
  indicatorCount: number;
  highlyCorrelatedIndicators: string[];
  magicParameters: string[];
  complexityScore: number;
  overfittingRisk: OverfittingRisk;
}

export interface LogicIntegrityReport {
  signalConflicts: SignalConflictAnalysis;
  overfitting: OverfittingAnalysis;
  redFlags: string[];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function countMatches(src: string, re: RegExp): number {
  const m = src.match(re);
  return m ? m.length : 0;
}

function extractIndicatorNames(src: string): string[] {
  const indicators: string[] = [];

  const dfCols = src.match(/dataframe\[['\"]([^'\"]+)['\"]\]/g) ?? [];
  for (const m of dfCols) {
    const mm = m.match(/dataframe\[['\"]([^'\"]+)['\"]\]/);
    if (!mm) continue;
    const col = mm[1];
    const low = col.toLowerCase();

    if (/(rsi|stoch|cci|mfi|adx|atr|macd|ema|sma|tema|wma|vwma|bb_|bollinger|obv|roc)/.test(low)) {
      indicators.push(col);
    }
  }

  const taCalls = src.match(/\bta\.[A-Za-z_][A-Za-z0-9_]*\s*\(/g) ?? [];
  for (const m of taCalls) {
    const mm = m.match(/\bta\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (mm) indicators.push(mm[1]);
  }

  const qtpylibCalls = src.match(/qtpylib\.indicators\.[A-Za-z_][A-Za-z0-9_]*\s*\(/g) ?? [];
  for (const m of qtpylibCalls) {
    const mm = m.match(/qtpylib\.indicators\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (mm) indicators.push(mm[1]);
  }

  return uniq(indicators.map((s) => String(s).trim()).filter(Boolean));
}

function extractMagicParams(src: string): string[] {
  const params: string[] = [];

  const periodAssign = src.match(/\b([A-Za-z_][A-Za-z0-9_]*(?:period|window|length))\s*=\s*(\d{1,3})\b/g) ?? [];
  for (const m of periodAssign) {
    const mm = m.match(/\b([A-Za-z_][A-Za-z0-9_]*(?:period|window|length))\s*=\s*(\d{1,3})\b/);
    if (!mm) continue;
    const name = mm[1];
    const n = Number(mm[2]);
    if (!Number.isFinite(n)) continue;
    if (n <= 1 || n >= 500) continue;

    const common = new Set([2, 3, 5, 7, 9, 10, 12, 14, 20, 21, 25, 26, 30, 50, 100, 200]);
    if (!common.has(n)) params.push(`${name}=${n}`);
  }

  const timeperiodCalls = src.match(/timeperiod\s*=\s*(\d{1,3})/g) ?? [];
  for (const m of timeperiodCalls) {
    const mm = m.match(/timeperiod\s*=\s*(\d{1,3})/);
    if (!mm) continue;
    const n = Number(mm[1]);
    const common = new Set([7, 9, 10, 12, 14, 20, 21, 26, 30, 50]);
    if (Number.isFinite(n) && n > 1 && n < 500 && !common.has(n)) params.push(`timeperiod=${n}`);
  }

  return uniq(params);
}

function extractMAPeriods(src: string): Array<{ kind: string; period: number }> {
  const out: Array<{ kind: string; period: number }> = [];

  const re = /\b(EMA|SMA|WMA|TEMA)\b\s*\(.*?(?:timeperiod|period|length)\s*=\s*(\d{1,3})/gi;
  re.lastIndex = 0;
  let m1: RegExpExecArray | null;
  while ((m1 = re.exec(src)) !== null) {
    const kind = String(m1[1] || "").toUpperCase();
    const n = Number(m1[2]);
    if (kind && Number.isFinite(n)) out.push({ kind, period: n });
  }

  const assignRe = /\b(ema|sma|wma|tema)_?(\d{1,3})\b/gi;
  assignRe.lastIndex = 0;
  let m2: RegExpExecArray | null;
  while ((m2 = assignRe.exec(src)) !== null) {
    const kind = String(m2[1] || "").toUpperCase();
    const n = Number(m2[2]);
    if (kind && Number.isFinite(n)) out.push({ kind, period: n });
  }

  return out;
}

function extractPythonFunctionBody(src: string, fnName: string): string | null {
  const re = new RegExp(`\\bdef\\s+${fnName}\\b[\\s\\S]*?:\\s*\\n`, "m");
  const m = src.match(re);
  if (!m || m.index == null) return null;

  const start = m.index + m[0].length;
  const rest = src.slice(start);
  const nextDef = rest.search(/^\s*def\s+/m);
  if (nextDef === -1) return rest;
  return rest.slice(0, nextDef);
}

export class Phase8Logic {
  analyze(strategyContent: string): LogicIntegrityReport {
    const src = String(strategyContent || "");

    const redFlags: string[] = [];
    const logicErrors: string[] = [];

    if (!src.trim()) {
      logicErrors.push("Strategy source is empty or missing.");
    }

    if (src.includes("shift(-")) {
      redFlags.push("Look-ahead risk detected (negative shift / future data reference).");
    }

    const indicators = extractIndicatorNames(src);

    const conflictingIndicators: string[] = [];

    const hasRsiLt = /\brsi\b[^\n]{0,80}</i.test(src);
    const hasRsiGt = /\brsi\b[^\n]{0,80}>/i.test(src);
    if (hasRsiLt && hasRsiGt) {
      conflictingIndicators.push("RSI thresholds include both '<' and '>' checks (could be contradictory depending on rule wiring).");
    }

    const hasCrossAbove = /cross(ed)?_above/i.test(src);
    const hasCrossBelow = /cross(ed)?_below/i.test(src);
    if (hasCrossAbove && hasCrossBelow) {
      conflictingIndicators.push("Both crossed_above and crossed_below are used (potentially unstable/choppy signals).");
    }

    const entryFns = countMatches(src, /\bdef\s+populate_(entry|buy)_trend\b/g);
    const exitFns = countMatches(src, /\bdef\s+populate_(exit|sell)_trend\b/g);
    const hasMinimalRoi = /\bminimal_roi\s*=\s*\{/i.test(src);
    const hasStoploss = /\bstoploss\s*=\s*(-?\d+(?:\.\d+)?)/i.test(src);

    if (entryFns === 0) {
      logicErrors.push("Missing populate_entry_trend / populate_buy_trend.");
    }

    if (exitFns === 0 && !hasMinimalRoi && !hasStoploss) {
      logicErrors.push("No clear exit mechanism detected (missing populate_exit_trend/sell, minimal_roi, and stoploss).");
    }

    const impossibleCycles: string[] = [];

    const entryBody =
      extractPythonFunctionBody(src, "populate_entry_trend") ||
      extractPythonFunctionBody(src, "populate_buy_trend") ||
      "";
    const exitBody =
      extractPythonFunctionBody(src, "populate_exit_trend") ||
      extractPythonFunctionBody(src, "populate_sell_trend") ||
      "";

    const entrySetsExit = /['\"]exit_long['\"]|\bexit_long\b|['\"]sell['\"]|\bsell\b/i.test(entryBody);
    const exitSetsEntry = /['\"]enter_long['\"]|\benter_long\b|['\"]buy['\"]|\bbuy\b/i.test(exitBody);

    if (entrySetsExit) {
      impossibleCycles.push(
        "Entry function appears to set exit signals (exit_long/sell). Verify entries and exits cannot trigger on the same candle (churn risk).",
      );
    }
    if (exitSetsEntry) {
      impossibleCycles.push(
        "Exit function appears to set entry signals (enter_long/buy). Verify entries and exits cannot trigger on the same candle (churn risk).",
      );
    }

    for (const line of src.split(/\r?\n/)) {
      const hasEnterAssign = /['\"]enter_long['\"]|\benter_long\b|['\"]buy['\"]|\bbuy\b/i.test(line) && /\bloc\[/.test(line);
      const hasExitAssign = /['\"]exit_long['\"]|\bexit_long\b|['\"]sell['\"]|\bsell\b/i.test(line) && /\bloc\[/.test(line);
      if (hasEnterAssign && hasExitAssign) {
        impossibleCycles.push(
          "Entry and exit signals appear to be set within the same assignment block/line. Ensure they are mutually exclusive per candle.",
        );
        break;
      }
    }

    const shortPeriods = (() => {
      const m = extractMagicParams(src);
      const tooShort = m.filter((x) => {
        const mm = x.match(/=(\d+)/);
        const n = mm ? Number(mm[1]) : NaN;
        return Number.isFinite(n) && n > 1 && n < 5;
      });
      return tooShort;
    })();

    const briefSignalInstability =
      hasCrossAbove && hasCrossBelow &&
      (src.toLowerCase().includes("5m") || src.toLowerCase().includes("1m") || src.toLowerCase().includes("3m"));

    if (briefSignalInstability) {
      redFlags.push("Signals may be unstable on low timeframes (both crossed_above and crossed_below used).");
    }

    if (shortPeriods.length) {
      redFlags.push(`Very short indicator periods detected (${shortPeriods.slice(0, 5).join(", ")}). This can increase noise sensitivity.`);
    }

    const maPeriods = extractMAPeriods(src);
    const highlyCorrelatedIndicators: string[] = [];
    for (let i = 0; i < maPeriods.length; i++) {
      for (let j = i + 1; j < maPeriods.length; j++) {
        const a = maPeriods[i];
        const b = maPeriods[j];
        if (Math.abs(a.period - b.period) <= 2) {
          highlyCorrelatedIndicators.push(`${a.kind}${a.period} ~ ${b.kind}${b.period}`);
        }
      }
    }

    const magicParameters = extractMagicParams(src);

    const conditionCount = countMatches(src, /\&\s*\(|\band\b|\bor\b|\|\s*\(/gi);
    const indicatorCount = indicators.length;

    const complexityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(indicatorCount * 8 + magicParameters.length * 4 + conditionCount * 2 + highlyCorrelatedIndicators.length * 2),
      ),
    );

    const overfittingRisk: OverfittingRisk = (() => {
      if (complexityScore >= 70 || indicatorCount >= 10 || magicParameters.length >= 8) return "high";
      if (complexityScore >= 45 || indicatorCount >= 6 || magicParameters.length >= 4) return "medium";
      return "low";
    })();

    if (indicatorCount > 8) {
      redFlags.push(`High indicator count (${indicatorCount}). This can cause overfitting and redundant logic.`);
    }

    if (highlyCorrelatedIndicators.length) {
      redFlags.push("Potentially redundant moving-average indicators (high correlation).");
    }

    if (magicParameters.length >= 4) {
      redFlags.push("Many non-standard indicator parameters detected (possible curve-fitting / magic numbers).");
    }

    if (overfittingRisk === "high") {
      redFlags.push(`Overfitting risk is HIGH (complexity score ${complexityScore}/100).`);
    } else if (overfittingRisk === "medium") {
      redFlags.push(`Overfitting risk is MEDIUM (complexity score ${complexityScore}/100).`);
    }

    for (const s of conflictingIndicators) {
      const txt = String(s || "").trim();
      if (txt) redFlags.push(txt);
    }

    for (const e of logicErrors) {
      const txt = String(e || "").trim();
      if (txt) redFlags.push(txt);
    }

    return {
      signalConflicts: {
        conflictingIndicators: uniq(conflictingIndicators).filter(Boolean),
        briefSignalInstability,
        impossibleCycles: uniq(impossibleCycles).filter(Boolean),
        logicErrors: uniq(logicErrors).filter(Boolean),
      },
      overfitting: {
        indicatorCount,
        highlyCorrelatedIndicators: uniq(highlyCorrelatedIndicators).slice(0, 20),
        magicParameters: magicParameters.slice(0, 30),
        complexityScore,
        overfittingRisk,
      },
      redFlags: uniq(redFlags.map((s) => String(s || "").trim()).filter(Boolean)),
    };
  }
}
