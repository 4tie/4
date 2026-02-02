export interface DataContinuityCheck {
  hasMissingBars: boolean;
  gapCount: number;
  largestGapMinutes: number;
  ohlcvVerified?: boolean;
  ohlcvGapCount?: number;
  ohlcvLargestGapMinutes?: number;
  missingDataFiles?: Array<{ pair: string; timeframe: string; path: string }>;
  unverifiedDataFiles?: Array<{ pair: string; timeframe: string; path: string }>;
  timestampSequenceValid: boolean;
  verdict: 'PASS' | 'WARN' | 'FAIL';
  details: string;
}

export interface LookAheadBiasCheck {
  hasLookAheadBias: boolean;
  detectedIndicators: string[];
  suspiciousConditions: string[];
  verdict: 'PASS' | 'FAIL';
  details: string;
}

export interface LogicFeasibilityCheck {
  hasImpossibleConditions: boolean;
  conflictingRules: string[];
  mutuallyExclusiveConditions: string[];
  verdict: 'PASS' | 'FAIL';
  details: string;
}

export interface StructuralIntegrityReport {
  verdict: 'PASS' | 'WARN' | 'FAIL';
  dataContinuity: DataContinuityCheck;
  lookAheadBias: LookAheadBiasCheck;
  logicFeasibility: LogicFeasibilityCheck;
}

export interface ExpectancyAnalysis {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  lossRate: number;
  expectancy: number;
  diagnosis: string;
  redFlags: string[];
  totals: {
    totalTrades: number;
    winners: number;
    losers: number;
    breakeven: number;
    avgWinAbs: number;
    avgLossAbs: number;
  };
}

export interface TradeDistribution {
  totalTrades: number;
  tradesPerDay: number;
  longCount: number;
  shortCount: number;
  longShortRatio: number;
  capitalDeployedPct: number;
  avgTimeInMarketHours: number;
  redFlags: string[];
}

export interface PerformanceMetricsReport {
  expectancy: ExpectancyAnalysis;
  distribution: TradeDistribution;
}

export interface DrawdownStructure {
  maxDrawdown: number;
  maxDrawdownAbs: number;
  avgDrawdownDurationHours: number;
  maxDrawdownDurationHours: number;
  timeToRecoveryHours: number | null;
  equityCurveSlope: number;
  drawdownCount: number;
  failurePatterns: string[];
}

export interface RiskPerTradeAnalysis {
  actualRiskPct: number;
  worstLossAbs: number;
  expectedStopLoss: number | null;
  stopLossRespectedPct: number | null;
  avgSlippage: number | null;
  positionSizingIssue: boolean;
  redFlags: string[];
}

export interface DrawdownRiskReport {
  drawdownStructure: DrawdownStructure;
  riskPerTrade: RiskPerTradeAnalysis;
}

export interface EntryTagStats {
  tag: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnLAbs: number;
  avgPnLAbs: number;
}

export interface EntryTimingAnalysis {
  medianWinnerDurationHours: number | null;
  medianLoserDurationHours: number | null;
  quickLoserPct: number | null;
  diagnosis: string;
  redFlags: string[];
}

export interface EntryQualityReport {
  byTag: EntryTagStats[];
  timing: EntryTimingAnalysis;
  redFlags: string[];
}

export interface ExitTypeStats {
  count: number;
  totalPnL: number;
  avgPnL: number;
}

export interface ExitReasonAnalysis {
  exitTypes: {
    stopLoss: ExitTypeStats;
    roiTarget: ExitTypeStats;
    trailingStop: ExitTypeStats;
    forceExit: ExitTypeStats;
    timeout: ExitTypeStats;
    exitSignal: ExitTypeStats;
    other: ExitTypeStats;
  };
  conclusions: string[];
}

export interface DurationComparison {
  avgWinnerDurationHours: number | null;
  avgLoserDurationHours: number | null;
  durationRatio: number | null;
  antiPatterns: string[];
}

export interface ExitLogicReport {
  exitReasons: ExitReasonAnalysis;
  duration: DurationComparison;
}

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

export interface SampleAdequacyAnalysis {
  tradeCount: number;
  minRequiredTrades: number;
  expectancy: number;
  expectancyStdDev: number;
  confidenceInterval95: [number, number];
  variance: number;
  verdict: 'PASS' | 'FAIL';
  justification: string;
}

export interface StatisticalRobustnessReport {
  sampleAdequacy: SampleAdequacyAnalysis;
  redFlags: string[];
}

export interface FailureSignalsReport {
  primaryFailureReason: string;
  mainKillerMetric: string;
  secondaryIssues: string[];
  recommendedChangeTypes: string[];
}

export interface DiagnosticReport {
  metadata: {
    reportId: string;
    timestamp: string;
    backtestId: string;
    strategy: string;
    timeframe: string;
    timerange: string;
  };
  phase1: {
    structuralIntegrity: StructuralIntegrityReport;
  };
  phase2?: {
    performance: PerformanceMetricsReport;
  };
  phase3?: {
    drawdownRisk: DrawdownRiskReport;
  };
  phase4?: {
    entryQuality: EntryQualityReport;
  };
  phase5?: {
    exitLogic: ExitLogicReport;
  };
  phase6?: {
    regimeAnalysis: RegimeAnalysisReport;
  };
  phase7?: {
    costAnalysis: CostAnalysisReport;
  };
  phase8?: {
    logicIntegrity: LogicIntegrityReport;
  };
  phase9?: {
    statistics: StatisticalRobustnessReport;
  };
  phase11?: {
    failureSignals: FailureSignalsReport;
  };
  summary: {
    primaryLossDriver: string;
    secondaryIssue: string;
    regimeFailure: string;
    assetRisk: string;
    statisticalVerdict: 'PASS' | 'FAIL';
    suggestedFixes: string[];
  };
}
