import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === FILESYSTEM ===
export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  path: text("path").notNull().unique(), // e.g., "strategies/MyStrategy.py"
  content: text("content").notNull(),
  type: text("type").notNull(), // "python", "json", "text"
  lastModified: timestamp("last_modified").defaultNow(),
});

// === BACKTESTS ===
export const backtests = pgTable("backtests", {
  id: serial("id").primaryKey(),
  strategyName: text("strategy_name").notNull(),
  config: jsonb("config").notNull(), // Timeframe, pairs, etc.
  status: text("status").notNull(), // "running", "completed", "failed"
  logs: text("logs").array(), // Console output
  results: jsonb("results"), // Structured results
  createdAt: timestamp("created_at").defaultNow(),
});

// === USER PREFERENCES ===
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
});

// === DIAGNOSTICS ===
export const diagnosticReports = pgTable("diagnostic_reports", {
  id: serial("id").primaryKey(),
  reportId: text("report_id").notNull().unique(),
  backtestId: integer("backtest_id").references(() => backtests.id),
  strategy: text("strategy"),
  timeframe: text("timeframe"),
  timerange: text("timerange"),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const diagnosticChangeTargets = pgTable("diagnostic_change_targets", {
  id: serial("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => diagnosticReports.reportId),
  backtestId: integer("backtest_id").references(() => backtests.id),
  strategy: text("strategy"),
  targets: jsonb("targets").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const diagnosticJobs = pgTable("diagnostic_jobs", {
  id: text("id").primaryKey(),
  backtestId: integer("backtest_id").references(() => backtests.id).notNull(),
  strategyPath: text("strategy_path"),
  status: text("status").notNull(),
  progress: jsonb("progress"),
  error: text("error"),
  reportId: text("report_id"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const diagnosticLoopRuns = pgTable("diagnostic_loop_runs", {
  id: text("id").primaryKey(),
  strategyPath: text("strategy_path").notNull(),
  baseConfig: jsonb("base_config").notNull(),
  status: text("status").notNull(),
  progress: jsonb("progress"),
  stopReason: text("stop_reason"),
  report: jsonb("report"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const diagnosticLoopIterations = pgTable("diagnostic_loop_iterations", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().references(() => diagnosticLoopRuns.id),
  iteration: integer("iteration").notNull(),
  stage: text("stage").notNull(),
  timeframe: text("timeframe").notNull(),
  backtestId: integer("backtest_id").references(() => backtests.id),
  features: jsonb("features"),
  failure: text("failure"),
  confidence: real("confidence"),
  proposedChanges: jsonb("proposed_changes"),
  validation: jsonb("validation"),
  appliedDiff: text("applied_diff"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: serial("id").primaryKey(),
  sessionKey: text("session_key").notNull().unique(),
  strategyPath: text("strategy_path"),
  backtestId: integer("backtest_id").references(() => backtests.id),
  clearedAt: timestamp("cleared_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => aiChatSessions.id).notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  request: jsonb("request"),
  response: jsonb("response"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiAuditEvents = pgTable("ai_audit_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => aiChatSessions.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiActions = pgTable("ai_actions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => aiChatSessions.id),
  messageId: integer("message_id").references(() => aiChatMessages.id),
  actionType: text("action_type").notNull(),
  description: text("description").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  diff: jsonb("diff"),
  backtestId: integer("backtest_id").references(() => backtests.id),
  diagnosticReportId: integer("diagnostic_report_id").references(() => diagnosticReports.id),
  results: jsonb("results"),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Strategy Validation Changes
export const aiStrategyValidations = pgTable("ai_strategy_validations", {
  id: serial("id").primaryKey(),
  validationId: text("validation_id").notNull().unique(),
  strategyName: text("strategy_name").notNull(),
  originalCode: text("original_code").notNull(),
  modifiedCode: text("modified_code").notNull(),
  changes: jsonb("changes").notNull(),
  errors: text("errors").array(),
  warnings: text("warnings").array(),
  valid: boolean("valid").notNull(),
  applied: boolean("applied").default(false),
  saved: boolean("saved").default(false),
  sessionId: integer("session_id").references(() => aiChatSessions.id),
  createdAt: timestamp("created_at").defaultNow(),
  appliedAt: timestamp("applied_at"),
  savedAt: timestamp("saved_at"),
});

export const agentHandoffs = pgTable("agent_handoffs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  agentId: text("agent_id").notNull(),
  envelope: jsonb("envelope").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiRefinementRuns = pgTable("ai_refinement_runs", {
  id: text("id").primaryKey(),
  strategyPath: text("strategy_path").notNull(),
  baseConfig: jsonb("base_config").notNull(),
  rolling: jsonb("rolling"),
  model: text("model"),
  status: text("status").notNull(),
  objectiveMode: text("objective_mode"),
  progress: jsonb("progress"),
  report: jsonb("report"),
  stopReason: text("stop_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiRefinementIterations = pgTable("ai_refinement_iterations", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().references(() => aiRefinementRuns.id),
  iteration: integer("iteration").notNull(),
  stage: text("stage").notNull(),
  decision: text("decision"),
  proposed: jsonb("proposed"),
  validation: jsonb("validation"),
  applied: jsonb("applied"),
  suite: jsonb("suite"),
  metrics: jsonb("metrics"),
  failure: text("failure"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDiagnosticReportSchema = createInsertSchema(diagnosticReports).omit({ id: true, createdAt: true });
export type DiagnosticReport = typeof diagnosticReports.$inferSelect;
export type InsertDiagnosticReport = z.infer<typeof insertDiagnosticReportSchema>;

export const insertDiagnosticChangeTargetSchema = createInsertSchema(diagnosticChangeTargets).omit({ id: true, createdAt: true });
export type DiagnosticChangeTarget = typeof diagnosticChangeTargets.$inferSelect;
export type InsertDiagnosticChangeTarget = z.infer<typeof insertDiagnosticChangeTargetSchema>;

export const insertDiagnosticJobSchema = createInsertSchema(diagnosticJobs).omit({ createdAt: true, startedAt: true, finishedAt: true, updatedAt: true });
export type DiagnosticJob = typeof diagnosticJobs.$inferSelect;
export type InsertDiagnosticJob = z.infer<typeof insertDiagnosticJobSchema>;

export const insertDiagnosticLoopRunSchema = createInsertSchema(diagnosticLoopRuns).omit({ createdAt: true, startedAt: true, finishedAt: true, updatedAt: true });
export type DiagnosticLoopRun = typeof diagnosticLoopRuns.$inferSelect;
export type InsertDiagnosticLoopRun = z.infer<typeof insertDiagnosticLoopRunSchema>;

export const insertDiagnosticLoopIterationSchema = createInsertSchema(diagnosticLoopIterations).omit({ id: true, createdAt: true });
export type DiagnosticLoopIteration = typeof diagnosticLoopIterations.$inferSelect;
export type InsertDiagnosticLoopIteration = z.infer<typeof insertDiagnosticLoopIterationSchema>;

export const insertAiChatSessionSchema = createInsertSchema(aiChatSessions).omit({ id: true, createdAt: true, updatedAt: true });
export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type InsertAiChatSession = z.infer<typeof insertAiChatSessionSchema>;

export const insertAiChatMessageSchema = createInsertSchema(aiChatMessages).omit({ id: true, createdAt: true });
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type InsertAiChatMessage = z.infer<typeof insertAiChatMessageSchema>;

export const insertAiAuditEventSchema = createInsertSchema(aiAuditEvents).omit({ id: true, createdAt: true });
export type AiAuditEvent = typeof aiAuditEvents.$inferSelect;
export type InsertAiAuditEvent = z.infer<typeof insertAiAuditEventSchema>;

export const insertAiActionSchema = createInsertSchema(aiActions).omit({ id: true, createdAt: true });
export type AiAction = typeof aiActions.$inferSelect;
export type InsertAiAction = z.infer<typeof insertAiActionSchema>;

export const insertAiStrategyValidationSchema = createInsertSchema(aiStrategyValidations).omit({ id: true, createdAt: true, appliedAt: true, savedAt: true });
export type AiStrategyValidation = typeof aiStrategyValidations.$inferSelect;
export type InsertAiStrategyValidation = z.infer<typeof insertAiStrategyValidationSchema>;

export const insertAgentHandoffSchema = createInsertSchema(agentHandoffs).omit({ id: true, createdAt: true });
export type AgentHandoff = typeof agentHandoffs.$inferSelect;
export type InsertAgentHandoff = z.infer<typeof insertAgentHandoffSchema>;

export const insertAiRefinementRunSchema = createInsertSchema(aiRefinementRuns).omit({ createdAt: true, startedAt: true, finishedAt: true, updatedAt: true });
export type AiRefinementRun = typeof aiRefinementRuns.$inferSelect;
export type InsertAiRefinementRun = z.infer<typeof insertAiRefinementRunSchema>;

export const insertAiRefinementIterationSchema = createInsertSchema(aiRefinementIterations).omit({ id: true, createdAt: true });
export type AiRefinementIteration = typeof aiRefinementIterations.$inferSelect;
export type InsertAiRefinementIteration = z.infer<typeof insertAiRefinementIterationSchema>;

// === SCHEMAS ===
export const insertFileSchema = createInsertSchema(files).omit({ id: true, lastModified: true });
export const insertBacktestSchema = createInsertSchema(backtests).omit({ id: true, createdAt: true, logs: true, results: true, status: true });
export const insertUserPreferenceSchema = createInsertSchema(userPreferences).omit({ id: true });

// === TYPES ===
export type File = typeof files.$inferSelect;
export type InsertFile = z.infer<typeof insertFileSchema>;

export type Backtest = typeof backtests.$inferSelect;
export type InsertBacktest = z.infer<typeof insertBacktestSchema>;

export interface AgentHandoffEnvelope {
  runId: string;
  agentId: "diagnostic" | "fix_design" | "implementation" | "validation";
  createdAt: string;
  inputs: {
    backtestId: number;
    strategyPath: string;
    configSnapshotPath?: string;
    chatSessionId?: number;
  };
  artifacts: {
    diagnosticReportId?: number;
    diagnosticSummary: string;
    evidenceIndex: Array<{ phase: string; keyMetric: string; value: string; sourcePath?: string }>;
    recommendedChangeTypes: string[];
  };
  aiActions: Array<{ actionId: string; type: string; description: string; result: "success" | "failure" }>;
  constraints: {
    productionSafe: boolean;
    maxLeverage: number;
    allowLookAhead: boolean;
  };
  next: {
    recommendedNextAgent: string;
    questionsForNextAgent: string[];
    stopReason?: string;
  };
}

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = z.infer<typeof insertUserPreferenceSchema>;

// === WIDGET TYPES ===
export type WidgetId = "profit" | "winrate" | "drawdown" | "sharpe" | "chart";
export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  order: number;
}

// === API CONTRACT TYPES ===
export type CreateFileRequest = InsertFile;
export type UpdateFileRequest = { content: string };
export type RunBacktestRequest = z.infer<typeof runBacktestRequestSchema>;
export type BacktestResponse = Backtest;

// === FREQTRADE SPECIFIC TYPES ===
export const Timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = typeof Timeframes[number];

export const backtestRunConfigSchema = z
  .object({
    timeframe: z.enum(Timeframes),
    timerange: z.string().optional(),
    backtest_date_from: z.string().optional(),
    backtest_date_to: z.string().optional(),
    stake_amount: z.number(),
    stoploss: z.number().optional(),
    trailing_stop: z.boolean().optional(),
    trailing_stop_positive: z.number().optional(),
    trailing_stop_positive_offset: z.number().optional(),
    trailing_only_offset_is_reached: z.boolean().optional(),
    minimal_roi: z.record(z.string(), z.number()).optional(),
    pairs: z.array(z.string()).optional(),
    max_open_trades: z.number().int().min(0).optional(),
    tradable_balance_ratio: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const runBacktestRequestSchema = insertBacktestSchema.extend({
  config: backtestRunConfigSchema,
});

export interface FreqtradeConfig {
  timeframe: Timeframe;
  timerange: string; // e.g., "20230101-"
  stake_amount: number;
  stoploss: number;
  pairs: string[];
}
