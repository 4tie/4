export interface SampleAdequacyAnalysis {
  tradeCount: number;
  minRequiredTrades: number;
  expectancy: number;
  expectancyStdDev: number;
  confidenceInterval95: [number, number];
  variance: number;
  verdict: "PASS" | "FAIL";
  justification: string;
}

export interface StatisticalRobustnessReport {
  sampleAdequacy: SampleAdequacyAnalysis;
  redFlags: string[];
}

function toNum(v: any) {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], m: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) {
    const d = v - m;
    s += d * d;
  }
  return s / (values.length - 1);
}

export class Phase9Statistics {
  analyze(backtestData: any): StatisticalRobustnessReport {
    const trades: any[] = Array.isArray(backtestData?.trades) ? backtestData.trades : [];

    const returns: number[] = [];
    for (const t of trades) {
      const pr = toNum(t?.profit_ratio ?? t?.profitRatio ?? t?.profit);
      if (pr != null) {
        returns.push(pr);
        continue;
      }
      const abs = toNum(t?.profit_abs ?? t?.profitAbs);
      const stake = toNum(t?.stake_amount ?? t?.stakeAmount);
      if (abs != null && stake != null && stake !== 0) returns.push(abs / stake);
    }

    const n = returns.length;
    const minRequiredTrades = 30;

    const m = mean(returns);
    const varS = variance(returns, m);
    const std = Math.sqrt(Math.max(0, varS));

    const z = 1.96;
    const se = n > 0 ? std / Math.sqrt(n) : 0;
    const ci: [number, number] = [m - z * se, m + z * se];

    const redFlags: string[] = [];

    let verdict: "PASS" | "FAIL" = "PASS";
    let justification = "";

    if (n === 0) {
      verdict = "FAIL";
      justification = "No trades available for statistical analysis.";
      redFlags.push("No trades executed");
    } else if (n < minRequiredTrades) {
      verdict = "FAIL";
      justification = `Sample size is too small (N=${n}). Statistical conclusions are unreliable.`;
      redFlags.push("Low sample size (< 30 trades)");
    } else if (ci[0] <= 0 && ci[1] >= 0) {
      verdict = "FAIL";
      justification = `95% confidence interval crosses 0 (${ci[0].toFixed(4)} .. ${ci[1].toFixed(4)}). The edge is not statistically significant.`;
      redFlags.push("Confidence interval crosses zero (edge not significant)");
    } else if (ci[1] <= 0) {
      verdict = "FAIL";
      justification = `95% confidence interval is below 0 (${ci[0].toFixed(4)} .. ${ci[1].toFixed(4)}). The strategy is likely unprofitable.`;
      redFlags.push("Expectancy CI below zero");
    } else {
      verdict = "PASS";
      justification = `Sample size is adequate (N=${n}) and the 95% confidence interval is above 0 (${ci[0].toFixed(4)} .. ${ci[1].toFixed(4)}).`;
    }

    if (n > 0 && std > 0.02) {
      redFlags.push("High per-trade variance (unstable edge)");
    }

    return {
      sampleAdequacy: {
        tradeCount: n,
        minRequiredTrades,
        expectancy: m,
        expectancyStdDev: std,
        confidenceInterval95: ci,
        variance: varS,
        verdict,
        justification,
      },
      redFlags,
    };
  }
}
