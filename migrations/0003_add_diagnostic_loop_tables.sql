CREATE TABLE IF NOT EXISTS diagnostic_loop_runs (
  id TEXT PRIMARY KEY,
  strategy_path TEXT NOT NULL,
  base_config JSONB NOT NULL,
  status TEXT NOT NULL,
  progress JSONB,
  stop_reason TEXT,
  report JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_loop_runs_created_at
  ON diagnostic_loop_runs(created_at);

CREATE INDEX IF NOT EXISTS idx_diagnostic_loop_runs_status
  ON diagnostic_loop_runs(status);

CREATE TABLE IF NOT EXISTS diagnostic_loop_iterations (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES diagnostic_loop_runs(id),
  iteration INTEGER NOT NULL,
  stage TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  backtest_id INTEGER REFERENCES backtests(id),
  features JSONB,
  failure TEXT,
  confidence REAL,
  proposed_changes JSONB,
  validation JSONB,
  applied_diff TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_loop_iterations_run_id
  ON diagnostic_loop_iterations(run_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_loop_iterations_backtest_id
  ON diagnostic_loop_iterations(backtest_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_loop_iterations_run_iteration
  ON diagnostic_loop_iterations(run_id, iteration, stage, timeframe);
