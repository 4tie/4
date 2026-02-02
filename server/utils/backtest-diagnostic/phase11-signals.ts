export interface FailureSignalsReport {
  primaryFailureReason: string;
  mainKillerMetric: string;
  secondaryIssues: string[];
  recommendedChangeTypes: string[];
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

export class Phase11Signals {
  analyze(input: {
    phase1?: any;
    phase2?: any;
    phase3?: any;
    phase6?: any;
    phase7?: any;
    phase8?: any;
    phase9?: any;
  }): FailureSignalsReport {
    const structural = input.phase1?.structuralIntegrity;
    const perf = input.phase2?.performance;
    const drawdown = input.phase3?.drawdownRisk;
    const regime = input.phase6?.regimeAnalysis;
    const costs = input.phase7?.costAnalysis;
    const logic = input.phase8?.logicIntegrity;
    const stats = input.phase9?.statistics;

    const tradeCount = Number(perf?.expectancy?.totals?.totalTrades ?? perf?.distribution?.totalTrades ?? 0);
    const tradesPerDay = Number(perf?.distribution?.tradesPerDay ?? 0);
    const expectancy = Number(perf?.expectancy?.expectancy ?? NaN);
    const winRate = Number(perf?.expectancy?.winRate ?? NaN);

    const maxDrawdown = Number(drawdown?.drawdownStructure?.maxDrawdown ?? NaN);

    const originalProfit = Number(costs?.costSensitivity?.originalProfit ?? NaN);
    const edgeViable = Boolean(costs?.costSensitivity?.edgeViable);
    const liquidityRisk = String(costs?.liquidity?.liquidityRisk ?? "unknown");

    const overfittingRisk = String(logic?.overfitting?.overfittingRisk ?? "unknown");

    const topPairShare = Number(regime?.assetAnalysis?.concentration?.topPairPnlShareAbs ?? NaN);
    const top3PairShare = Number(regime?.assetAnalysis?.concentration?.top3PnlShareAbs ?? NaN);

    const structuralFail = String(structural?.verdict || "").toUpperCase() === "FAIL";

    const hasLookAhead = (() => {
      const lb = structural?.lookAheadBias;
      return String(lb?.verdict || "").toUpperCase() === "FAIL" || Boolean(lb?.hasLookAheadBias);
    })();

    const statisticallyBadEdge = (() => {
      const ci = stats?.sampleAdequacy?.confidenceInterval95;
      const lo = Array.isArray(ci) ? Number(ci[0]) : NaN;
      return Number.isFinite(lo) ? lo < 0 : false;
    })();

    const signals: Array<{
      key: string;
      severity: number;
      label: string;
      killerMetric: string;
      recommended: string[];
    }> = [];

    if (hasLookAhead) {
      signals.push({
        key: "integrity_lookahead",
        severity: 100,
        label: "Look-ahead bias detected (future data leak).",
        killerMetric: "integrity",
        recommended: ["remove_lookahead", "use_startup_candles", "fix_signal_computation"],
      });
    }

    if (structuralFail) {
      signals.push({
        key: "structural_fail",
        severity: 95,
        label: "Structural integrity checks failed (data continuity/feasibility).",
        killerMetric: "integrity",
        recommended: ["fix_data_continuity", "simplify_logic", "verify_timerange_data"],
      });
    }

    if (tradeCount === 0) {
      signals.push({
        key: "no_trades",
        severity: 90,
        label: "No trades executed (over-filtered or conditions never trigger).",
        killerMetric: "trade_count",
        recommended: ["loosen_entry_filters", "extend_timerange", "add_pairs"],
      });
    } else if (tradeCount > 0 && (tradeCount < 30 || tradesPerDay < 0.25)) {
      signals.push({
        key: "low_trades",
        severity: 70,
        label: "Trade sample is low (results may be unreliable / over-filtered).",
        killerMetric: "trade_count",
        recommended: ["loosen_entry_filters", "extend_timerange", "add_pairs"],
      });
    }

    if (Number.isFinite(expectancy) && expectancy < 0) {
      signals.push({
        key: "negative_expectancy",
        severity: statisticallyBadEdge ? 85 : 75,
        label: statisticallyBadEdge
          ? "Expectancy is statistically negative (CI below 0)."
          : "Expectancy is negative (edge not proven).",
        killerMetric: "expectancy",
        recommended: ["improve_entry_edge", "improve_exit_payoff", "reduce_noise_trades"],
      });
    }

    if (Number.isFinite(maxDrawdown) && maxDrawdown > 0.2) {
      signals.push({
        key: "high_drawdown",
        severity: maxDrawdown > 0.35 ? 80 : 65,
        label: "Max drawdown is high (risk controls/exposure likely too aggressive).",
        killerMetric: "max_drawdown",
        recommended: ["tighten_stoploss", "reduce_exposure", "reduce_max_open_trades", "add_invalidation_exits"],
      });
    }

    if (Number.isFinite(originalProfit) && originalProfit > 0 && !edgeViable) {
      signals.push({
        key: "cost_sensitive",
        severity: 60,
        label: "Profitability disappears under conservative fees/slippage stress.",
        killerMetric: "cost_sensitivity",
        recommended: ["reduce_trade_frequency", "avoid_thin_edge_exits", "prefer_high_liquidity_pairs"],
      });
    }

    if (liquidityRisk === "high") {
      signals.push({
        key: "liquidity_risk",
        severity: 55,
        label: "Liquidity risk is high (fills may be unrealistic / slippage underestimated).",
        killerMetric: "liquidity",
        recommended: ["prefer_high_liquidity_pairs", "reduce_stake_size", "reduce_trade_frequency"],
      });
    }

    if (Number.isFinite(topPairShare) && topPairShare > 0.6) {
      signals.push({
        key: "concentration",
        severity: 50,
        label: "Profit is highly concentrated in a single pair (fragile edge).",
        killerMetric: "concentration",
        recommended: ["diversify_pairs", "limit_per_pair_exposure", "validate_across_pairs"],
      });
    } else if (Number.isFinite(top3PairShare) && top3PairShare > 0.85) {
      signals.push({
        key: "concentration_top3",
        severity: 45,
        label: "Profit is concentrated in top 3 pairs (fragile edge).",
        killerMetric: "concentration",
        recommended: ["diversify_pairs", "limit_per_pair_exposure", "validate_across_pairs"],
      });
    }

    if (overfittingRisk === "high") {
      signals.push({
        key: "overfitting_risk",
        severity: 40,
        label: "Overfitting risk is high (too much complexity / magic parameters).",
        killerMetric: "overfitting",
        recommended: ["simplify_parameters", "reduce_complexity", "validate_out_of_sample"],
      });
    }

    if (Number.isFinite(winRate) && winRate > 0.55 && Number.isFinite(expectancy) && expectancy < 0) {
      signals.push({
        key: "rr_imbalance",
        severity: 52,
        label: "Win rate is decent but expectancy is negative (payoff ratio problem).",
        killerMetric: "payoff_ratio",
        recommended: ["improve_exit_payoff", "cut_losses_faster", "let_winners_run"],
      });
    }

    const sorted = signals.slice().sort((a, b) => b.severity - a.severity);

    const primary = sorted[0];
    const secondary = sorted.slice(1);

    const primaryFailureReason = primary ? primary.label : "No dominant failure signal detected.";
    const mainKillerMetric = primary ? primary.killerMetric : "unknown";

    const secondaryIssues = secondary.map((s) => s.label);

    const recommendedChangeTypes = uniqStrings(sorted.flatMap((s) => s.recommended));

    return {
      primaryFailureReason,
      mainKillerMetric,
      secondaryIssues,
      recommendedChangeTypes,
    };
  }
}
