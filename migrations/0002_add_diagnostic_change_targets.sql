-- Add diagnostic change targets table
CREATE TABLE IF NOT EXISTS diagnostic_change_targets (
  id SERIAL PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES diagnostic_reports(report_id),
  backtest_id INTEGER REFERENCES backtests(id),
  strategy TEXT,
  targets JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_change_targets_report_id
  ON diagnostic_change_targets(report_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_change_targets_backtest_id
  ON diagnostic_change_targets(backtest_id);
