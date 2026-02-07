/**
 * AI Response Test Fixtures
 * 
 * These fixtures provide sample AI responses for regression testing.
 * They cover both valid and invalid cases to ensure validation works correctly.
 */

export const validAnalysisResponse = {
  summary: [
    'Strategy shows positive expectancy with adequate sample size',
    'Win rate is below optimal threshold suggesting entry refinement needed',
    'Drawdown is within acceptable limits for the timeframe tested',
  ],
  metrics_used: ['profit_total_pct', 'win_rate_pct', 'max_drawdown_pct', 'total_trades'],
  metrics_to_recommendation_mapping: [
    'profit_total_pct -> Current edge is positive but small; focus on improving entry timing',
    'win_rate_pct -> Below 40%; consider adding trend confirmation filters',
    'max_drawdown_pct -> Acceptable risk level; maintain current stoploss settings',
  ],
  next_experiments: [
    'Add RSI filter to reduce entries against trend',
    'Test tighter stoploss on high volatility pairs',
    'Increase minimum profit target to 2%',
  ],
  questions: [
    'Do you want to prioritize win rate improvement or profit factor?',
  ],
  actions: [
    {
      action: 'run_backtest',
      payload: { strategyName: 'TestStrategy', config: { timeframe: '5m' } },
      label: 'Run with RSI Filter',
    },
  ],
};

export const invalidWithHallucinatedPercentages = {
  summary: [
    'Profit increased by 25% compared to previous run',
    'Win rate improved to 45% which is good',
  ],
  metrics_to_recommendation_mapping: ['metric -> do something'],
  next_experiments: ['Test'],
};

export const invalidWithUnknownMetrics = {
  summary: ['Test summary'],
  metrics_used: ['hallucinated_metric', 'another_fake_metric'],
  metrics_to_recommendation_mapping: [
    'hallucinated_metric -> this references a non-existent metric',
  ],
  next_experiments: ['Test'],
};

export const invalidWithUnknownAction = {
  summary: ['Test summary'],
  metrics_to_recommendation_mapping: ['a -> b'],
  next_experiments: ['Test'],
  actions: [
    {
      action: 'delete_database',
      payload: {},
      label: 'Delete everything',
    },
  ],
};

export const invalidWithTooManySummaries = {
  summary: [
    'Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5',
    'Item 6', 'Item 7', 'Item 8', 'Item 9', 'Item 10',
  ],
  metrics_to_recommendation_mapping: ['a -> b'],
  next_experiments: ['Test'],
};

export const malformedJson = `{"summary": ["test", "unclosed array"}`;

export const validWithBatchAction = {
  summary: ['Batch testing recommended for robustness'],
  metrics_to_recommendation_mapping: [
    'profit_total_pct -> Consistent across timeframes suggests stable edge',
  ],
  next_experiments: [
    'Run 30-day rolling window batch test',
    'Test on different market regimes',
  ],
  actions: [
    {
      action: 'run_batch_backtest',
      payload: {
        strategyName: 'TestStrategy',
        rolling: { windowDays: 30, count: 6 },
      },
      label: 'Run 6-Month Rolling Batch',
    },
  ],
};

export const validWithDiagnosticAction = {
  summary: ['Diagnostic analysis needed for failure investigation'],
  metrics_to_recommendation_mapping: [
    'win_rate_pct -> Below threshold requires diagnostic investigation',
  ],
  next_experiments: [
    'Run full diagnostic on recent backtest',
    'Analyze entry quality metrics',
  ],
  actions: [
    {
      action: 'run_diagnostic',
      payload: { backtestId: 123, strategyPath: 'user_data/strategies/Test.py' },
      label: 'Run Diagnostic',
    },
  ],
};
