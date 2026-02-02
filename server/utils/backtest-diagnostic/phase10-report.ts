export interface FinalSummaryReport {
  primaryLossDriver: string;
  secondaryIssue: string;
  regimeFailure: string;
  assetRisk: string;
  statisticalVerdict: "PASS" | "FAIL";
  suggestedFixes: string[];
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const s = String(it || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function firstString(arr: any): string | null {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    const s = String(x || "").trim();
    if (s) return s;
  }
  return null;
}

export class Phase10Report {
  analyze(input: {
    phase1?: any;
    phase2?: any;
    phase3?: any;
    phase4?: any;
    phase5?: any;
    phase6?: any;
    phase7?: any;
    phase8?: any;
    phase9?: any;
  }): FinalSummaryReport {
    const structural = input.phase1?.structuralIntegrity;
    const perf = input.phase2?.performance;
    const drawdown = input.phase3?.drawdownRisk;
    const entry = input.phase4?.entryQuality;
    const exit = input.phase5?.exitLogic;
    const regime = input.phase6?.regimeAnalysis;
    const costs = input.phase7?.costAnalysis;
    const logic = input.phase8?.logicIntegrity;
    const stats = input.phase9?.statistics;

    const suggestedFixes: string[] = [];

    const statVerdict: "PASS" | "FAIL" =
      stats?.sampleAdequacy?.verdict === "PASS" || stats?.sampleAdequacy?.verdict === "FAIL"
        ? stats.sampleAdequacy.verdict
        : structural?.verdict === "FAIL" || (perf?.expectancy?.expectancy ?? -1) < 0
          ? "FAIL"
          : "PASS";

    const primaryLossDriver = (() => {
      const just = String(stats?.sampleAdequacy?.justification || "").toLowerCase();
      if (just.includes("below 0")) {
        suggestedFixes.push(
          "Improve expectancy: increase win rate (signal quality) or improve payoff ratio (cut losses / let winners run)",
        );
        return "Edge is statistically negative (expectancy CI below 0).";
      }
      if (just.includes("crosses 0")) {
        suggestedFixes.push("Validate the strategy on different timeranges and regimes");
        suggestedFixes.push("Extend the timerange");
        return "Edge is not statistically significant (CI crosses 0).";
      }
      if (String(structural?.verdict) === "FAIL") {
        suggestedFixes.push("Fix structural integrity issues identified in Phase 1");
        return "Structural integrity issues (data/look-ahead/feasibility).";
      }
      const ex = Number(perf?.expectancy?.expectancy);
      if (Number.isFinite(ex) && ex < 0) {
        suggestedFixes.push(
          "Improve expectancy: increase win rate (signal quality) or improve payoff ratio (cut losses / let winners run)",
        );
        return String(perf?.expectancy?.diagnosis || "Negative expectancy.");
      }
      const edgeViable = Boolean(costs?.costSensitivity?.edgeViable);
      const origProfit = Number(costs?.costSensitivity?.originalProfit);
      if (Number.isFinite(origProfit) && origProfit > 0 && !edgeViable) {
        suggestedFixes.push("Avoid overly tight targets that are sensitive to execution costs");
        suggestedFixes.push("Reduce trade frequency (cooldown / stronger filters)");
        return "Edge disappears under realistic fees/slippage assumptions.";
      }
      return "No single dominant loss driver detected.";
    })();

    const secondaryIssue = (() => {
      const exitConc = firstString(exit?.exitReasons?.conclusions);
      if (exitConc) {
        if (exitConc.toLowerCase().includes("stop loss")) {
          suggestedFixes.push("Tighten stoploss and ensure it is actually applied");
          suggestedFixes.push("Improve exits (ROI/trailing/invalidations) to stop bleeding");
          return "Exit behavior suggests stoploss/exit handling issues.";
        }
        if (exitConc.toLowerCase().includes("trailing")) {
          suggestedFixes.push("Avoid overly tight targets that are sensitive to execution costs");
          return "Exit behavior suggests trailing/ROI tuning issues.";
        }
      }

      const ddFlags = Array.isArray(drawdown?.drawdownStructure?.failurePatterns) ? drawdown.drawdownStructure.failurePatterns : [];
      if (ddFlags.length) {
        suggestedFixes.push("Reduce position sizing and limit concurrent trades");
        suggestedFixes.push("Improve risk controls and exits");
        return "Drawdown/risk structure shows risk-control issues.";
      }

      const logicFlags = Array.isArray(logic?.redFlags) ? logic.redFlags : [];
      if (logicFlags.some((f: string) => String(f).toLowerCase().includes("look-ahead"))) {
        suggestedFixes.push("Remove any usage of future candles (e.g., shift(-1), negative shifts, or indexing that peeks ahead)");
        return "Potential look-ahead / integrity issue in strategy logic.";
      }

      const entryFlags = Array.isArray(entry?.redFlags) ? entry.redFlags : [];
      if (entryFlags.length) {
        suggestedFixes.push("Rework entries: focus on fewer, higher-quality signals");
        return "Entry quality issues detected.";
      }

      return "-";
    })();

    const regimeFailure = (() => {
      const rfs: string[] = Array.isArray(regime?.regimeSegmentation?.redFlags) ? regime.regimeSegmentation.redFlags : [];
      if (rfs.length) {
        suggestedFixes.push("Add regime filters to avoid conditions where the strategy underperforms");
        return rfs[0];
      }
      return "-";
    })();

    const assetRisk = (() => {
      const afs: string[] = Array.isArray(regime?.assetAnalysis?.concentration?.redFlags)
        ? regime.assetAnalysis.concentration.redFlags
        : [];
      if (afs.length) {
        suggestedFixes.push("Limit per-pair exposure and enforce diversification");
        return afs[0];
      }
      return "Low concentration risk.";
    })();

    if (statVerdict === "FAIL" && !String(stats?.sampleAdequacy?.justification || "").toLowerCase().includes("sample size")) {
      suggestedFixes.push("Validate the strategy on different timeranges and regimes");
    }

    if (costs?.liquidity?.liquidityRisk === "high") {
      suggestedFixes.push("Prefer high-liquidity pairs");
      suggestedFixes.push("Reduce stake size per trade");
    }

    return {
      primaryLossDriver,
      secondaryIssue,
      regimeFailure,
      assetRisk,
      statisticalVerdict: statVerdict,
      suggestedFixes: uniqStrings(suggestedFixes).slice(0, 10),
    };
  }
}
