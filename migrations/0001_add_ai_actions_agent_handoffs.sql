-- Add AI actions audit table
CREATE TABLE IF NOT EXISTS ai_actions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES ai_chat_sessions(id),
  message_id INTEGER REFERENCES ai_chat_messages(id),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  diff JSONB,
  backtest_id INTEGER REFERENCES backtests(id),
  diagnostic_report_id INTEGER REFERENCES diagnostic_reports(id),
  results JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add agent handoff envelopes
CREATE TABLE IF NOT EXISTS agent_handoffs (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_actions_session ON ai_actions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_actions_backtest ON ai_actions(backtest_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_run ON agent_handoffs(run_id);
