import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { Phase1Structural } from "./utils/backtest-diagnostic/phase1-structural";
import { Phase2Performance } from "./utils/backtest-diagnostic/phase2-performance";
import { Phase3Drawdown } from "./utils/backtest-diagnostic/phase3-drawdown";
import { Phase4EntryQuality } from "./utils/backtest-diagnostic/phase4-entry";
import { Phase5Exit } from "./utils/backtest-diagnostic/phase5-exit";
import { Phase6Regime } from "./utils/backtest-diagnostic/phase6-regime";
import { Phase7Costs } from "./utils/backtest-diagnostic/phase7-costs";
import { Phase8Logic } from "./utils/backtest-diagnostic/phase8-logic";
import { Phase9Statistics } from "./utils/backtest-diagnostic/phase9-statistics";
import { Phase10Report } from "./utils/backtest-diagnostic/phase10-report";
import { Phase11Signals } from "./utils/backtest-diagnostic/phase11-signals";
import { BacktestParser } from "./utils/backtest-diagnostic/parser";
import { v4 as uuidv4 } from "uuid";

type DiagnosticProgress = {
  percent: number;
  currentPhase: string;
  phasesCompleted: string[];
};

type DiagnosticLoopProgress = {
  percent: number;
  iteration: number;
  stage: string;
  timeframe: string;
  step: string;
};

const diagnosticQueue: string[] = [];
let diagnosticWorkerRunning = false;

const diagnosticLoopQueue: string[] = [];
let diagnosticLoopWorkerRunning = false;
const diagnosticLoopStopRequests = new Set<string>();

let cachedBinance24hTickers: any[] | null = null;
let cachedBinance24hTickersAt = 0;

async function enqueueDiagnosticJob(jobId: string) {
  diagnosticQueue.push(jobId);
  if (!diagnosticWorkerRunning) {
    processDiagnosticQueue().catch((err) => {
      console.error("Diagnostic queue error:", err);
    });
  }
}

function clampNum(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPythonTool(scriptPath: string, args: string[], stdinObj?: any): Promise<{ code: number; out: string; err: string }> {
  const projectRoot = process.cwd();
  const venvBin = path.join(projectRoot, ".venv", "bin");
  const pythonBin = path.join(venvBin, "python");

  const env = {
    ...process.env,
    VIRTUAL_ENV: path.join(projectRoot, ".venv"),
    PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
  };

  const proc = spawn(pythonBin, [scriptPath, ...args], { cwd: projectRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.stderr.on("data", (d) => (err += d.toString()));
  if (stdinObj !== undefined) {
    proc.stdin.write(JSON.stringify(stdinObj));
  }
  proc.stdin.end();

  const code = await new Promise<number>((resolve) => {
    proc.on("close", (c) => resolve(typeof c === "number" ? c : 1));
  });

  return { code, out, err };
}

async function chooseDiagnosticLoopFixWithAi(input: {
  model: string;
  features: any;
  failure: string;
  confidence: number;
  evidence: any[];
  allowedFixes: Array<{ id: string; scope: string; paramChanges: any[]; attrChanges: any[] }>;
}): Promise<{ selectedFixId: string; rationale?: string } | null> {
  const apiKey = getOpenRouterApiKey();
  const baseUrl = getOpenRouterBaseUrl();
  if (!apiKey) return null;

  const system =
    "You are a rule-driven strategy diagnostic assistant. You must only select from the provided allowedFixes. " +
    "Return STRICT JSON only.";

  const user = JSON.stringify(
    {
      task: "Select the single best fix to try next.",
      constraints: {
        must_select_from_allowedFixes: true,
        max_changes: 3,
        max_numeric_delta_pct: 30,
        no_entry_and_exit_together: true,
      },
      context: {
        failure: input.failure,
        confidence: input.confidence,
        evidence: input.evidence,
        features: input.features,
      },
      allowedFixes: input.allowedFixes.map((f) => ({
        id: f.id,
        scope: f.scope,
        paramChanges: f.paramChanges?.map((c: any) => ({ name: c.name, from: c.from, to: c.to })) ?? [],
        attrChanges: f.attrChanges?.map((c: any) => ({ name: c.name, from: c.from, to: c.to })) ?? [],
      })),
      response_schema: {
        selectedFixId: "<one of allowedFixes[].id>",
        rationale: "short explanation",
      },
    },
    null,
    2,
  );

  const upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://replit.com",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 256,
    }),
  });

  if (!upstreamRes.ok) {
    return null;
  }

  const data = await upstreamRes.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    const selectedFixId = typeof parsed?.selectedFixId === "string" ? parsed.selectedFixId : "";
    if (!selectedFixId) return null;
    const rationale = typeof parsed?.rationale === "string" ? parsed.rationale : undefined;
    return { selectedFixId, rationale };
  } catch {
    return null;
  }
}

async function extractStrategyParams(strategyPath: string): Promise<any[]> {
  const projectRoot = process.cwd();
  const absStrategy = resolvePathWithinProject(strategyPath);
  const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "param_tools.py");
  const res = await runPythonTool(scriptPath, ["extract", absStrategy]);
  if (res.code !== 0) throw new Error(res.err || res.out || "param extract failed");
  const parsed = JSON.parse(res.out);
  return Array.isArray(parsed?.params) ? parsed.params : [];
}

async function applyStrategyParamChanges(strategyPath: string, changes: Array<{ name: string; before: string; after: string }>): Promise<void> {
  const projectRoot = process.cwd();
  const absStrategy = resolvePathWithinProject(strategyPath);
  const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "param_tools.py");
  const res = await runPythonTool(scriptPath, ["apply", absStrategy], { changes });
  if (res.code !== 0) throw new Error(res.err || res.out || "param apply failed");
}

async function extractStrategyAttrs(strategyPath: string): Promise<any[]> {
  const projectRoot = process.cwd();
  const absStrategy = resolvePathWithinProject(strategyPath);
  const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "attr_tools.py");
  const res = await runPythonTool(scriptPath, ["extract", absStrategy]);
  if (res.code !== 0) throw new Error(res.err || res.out || "attr extract failed");
  const parsed = JSON.parse(res.out);
  return Array.isArray(parsed?.attrs) ? parsed.attrs : [];
}

async function applyStrategyAttrChanges(strategyPath: string, changes: Array<{ name: string; before: string; after: string }>): Promise<void> {
  const projectRoot = process.cwd();
  const absStrategy = resolvePathWithinProject(strategyPath);
  const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "attr_tools.py");
  const res = await runPythonTool(scriptPath, ["apply", absStrategy], { changes });
  if (res.code !== 0) throw new Error(res.err || res.out || "attr apply failed");
}

function simpleDiffText(before: string, after: string): string {
  if (before === after) return "";
  const b = clampText(before, 4000);
  const a = clampText(after, 4000);
  return `--- before\n${b}\n\n+++ after\n${a}\n`;
}

function backtestFailureInfo(bt: any): { status: string; message: string; logsTail: string[] } {
  const status = String(bt?.status || "unknown");
  const logs = Array.isArray(bt?.logs) ? bt.logs.map((l: any) => String(l)) : [];
  const tail = logs.slice(-25);
  const msg = (() => {
    const joined = tail.join("\n");
    const m1 = joined.match(/No data found\.[\s\S]*?Terminating\./i);
    if (m1) return "No data found for requested timeframe/timerange. Download data or adjust timerange.";
    const m2 = joined.match(/\bERROR\b[\s\S]{0,200}/i);
    if (m2) return m2[0];
    return `Backtest status: ${status}`;
  })();
  return { status, message: msg, logsTail: tail };
}

function classifyLoopFailure(input: {
  perf: any;
  entry: any;
  exit: any;
  drawdown: any;
  stats: any;
}): { failure: string; confidence: number; evidence: any[] } {
  const evidence: any[] = [];
  const trades = Number(input.perf?.expectancy?.totals?.totalTrades ?? input.perf?.distribution?.totalTrades ?? 0);
  const quickLoserPct = input.entry?.timing?.quickLoserPct;
  const durationRatio = input.exit?.duration?.durationRatio;
  const stopLossCount = Number(input.exit?.exitReasons?.exitTypes?.stopLoss?.count ?? 0);
  const totalExits = Object.values(input.exit?.exitReasons?.exitTypes ?? {}).reduce((s: number, v: any) => s + Number(v?.count ?? 0), 0);
  const stopLossPct = totalExits > 0 ? stopLossCount / totalExits : 0;
  const maxDd = Number(input.drawdown?.drawdownStructure?.maxDrawdown ?? NaN);
  const verdict = String(input.stats?.sampleAdequacy?.verdict ?? "FAIL");
  const ci = input.stats?.sampleAdequacy?.confidenceInterval95;
  const ciLo = Array.isArray(ci) ? Number(ci[0]) : NaN;

  if (!Number.isFinite(trades) || trades <= 0 || trades < 10) {
    evidence.push({ metric: "trade_count", value: trades, ruleId: "OVERFILTERED_1" });
    return { failure: "OVERFILTERED", confidence: 0.85, evidence };
  }

  if (verdict === "FAIL" && Number.isFinite(ciLo) && ciLo < 0) {
    evidence.push({ metric: "expectancy_ci_lo", value: ciLo, ruleId: "NO_EDGE_1" });
    return { failure: "NO_EDGE", confidence: 0.85, evidence };
  }

  if (typeof quickLoserPct === "number" && Number.isFinite(quickLoserPct) && quickLoserPct >= 0.5) {
    evidence.push({ metric: "quick_loser_pct", value: quickLoserPct, ruleId: "ENTRY_LAG_1" });
    return { failure: "ENTRY_LAG", confidence: 0.75, evidence };
  }

  if (typeof durationRatio === "number" && Number.isFinite(durationRatio)) {
    if (durationRatio > 1.25) {
      evidence.push({ metric: "duration_ratio", value: durationRatio, ruleId: "EXIT_TOO_LATE_1" });
      return { failure: "EXIT_TOO_LATE", confidence: 0.7, evidence };
    }
    if (durationRatio < 0.8) {
      evidence.push({ metric: "duration_ratio", value: durationRatio, ruleId: "EXIT_TOO_EARLY_1" });
      return { failure: "EXIT_TOO_EARLY", confidence: 0.65, evidence };
    }
  }

  if (stopLossPct >= 0.5) {
    evidence.push({ metric: "pct_stoploss_exits", value: stopLossPct, ruleId: "STOP_1" });
    if (Number.isFinite(maxDd) && maxDd > 0.3) return { failure: "STOP_TOO_WIDE", confidence: 0.65, evidence };
    return { failure: "STOP_TOO_TIGHT", confidence: 0.65, evidence };
  }

  return { failure: "NO_EDGE", confidence: 0.6, evidence: [{ metric: "default", value: "no_strong_signal", ruleId: "NO_EDGE_FALLBACK" }] };
}

function buildAllowedFixes(input: {
  failure: string;
  params: any[];
  attrs: any[];
}): Array<{ id: string; scope: "entry" | "exit" | "risk"; paramChanges: any[]; attrChanges: any[] }> {
  const out: Array<{ id: string; scope: "entry" | "exit" | "risk"; paramChanges: any[]; attrChanges: any[] }> = [];
  const buyParams = input.params.filter((p) => String(p?.space ?? "").toLowerCase() === "buy");
  const sellParams = input.params.filter((p) => String(p?.space ?? "").toLowerCase() === "sell");
  const attrByName = new Map<string, any>();
  for (const a of input.attrs) attrByName.set(String(a?.name ?? ""), a);

  const pickNumericParams = (arr: any[]) =>
    arr.filter((p) => typeof p?.default === "number" && Number.isFinite(p.default)).slice(0, 6);

  const paramDelta = (p: any, factor: number) => {
    const from = Number(p.default);
    let to = from * factor;
    if (from !== 0) {
      const delta = Math.abs((to - from) / from);
      if (delta > 0.3) to = from + Math.sign(to - from) * Math.abs(from) * 0.3;
    }
    const lo = Array.isArray(p.args) ? p.args[0] : null;
    const hi = Array.isArray(p.args) ? p.args[1] : null;
    if (typeof lo === "number" && typeof hi === "number") to = clampNum(to, lo, hi);
    if (!Number.isFinite(to) || to === from) return null;

    const before = String(p.before ?? "");
    if (!before.includes("default")) return null;
    const after = before.replace(/default\s*=\s*([^,\)]*)/m, `default=${Number.isInteger(to) ? String(Math.trunc(to)) : String(to)}`);
    return { name: String(p.name), from, to, before, after };
  };

  const attrDelta = (name: string, factor: number) => {
    const meta = attrByName.get(name);
    if (!meta) return null;
    const from = meta.value;
    if (typeof from !== "number" || !Number.isFinite(from)) return null;
    let to = from * factor;
    if (from !== 0) {
      const delta = Math.abs((to - from) / from);
      if (delta > 0.3) to = from + Math.sign(to - from) * Math.abs(from) * 0.3;
    }
    if (!Number.isFinite(to) || to === from) return null;
    const before = String(meta.before ?? "");
    const after = before.replace(/=\s*([^\n#]+)/, `= ${String(to)}`);
    return { name, from, to, before, after };
  };

  if (input.failure === "OVERFILTERED" || input.failure === "ENTRY_LAG") {
    const changes: any[] = [];
    for (const p of pickNumericParams(buyParams)) {
      const lname = String(p.name).toLowerCase();
      const factor = lname.includes("max") ? 1.1 : lname.includes("min") ? 0.9 : lname.includes("period") || lname.includes("length") ? 0.8 : 0.9;
      const ch = paramDelta(p, factor);
      if (ch) changes.push(ch);
      if (changes.length >= 2) break;
    }
    if (changes.length) out.push({ id: `fix_entry_${input.failure.toLowerCase()}`, scope: "entry", paramChanges: changes, attrChanges: [] });
  }

  if (input.failure === "EXIT_TOO_LATE" || input.failure === "EXIT_TOO_EARLY") {
    const changes: any[] = [];
    for (const p of pickNumericParams(sellParams)) {
      const lname = String(p.name).toLowerCase();
      const factor = input.failure === "EXIT_TOO_LATE" ? (lname.includes("max") ? 0.9 : 0.9) : 1.1;
      const ch = paramDelta(p, factor);
      if (ch) changes.push(ch);
      if (changes.length >= 2) break;
    }
    if (changes.length) out.push({ id: `fix_exit_${input.failure.toLowerCase()}`, scope: "exit", paramChanges: changes, attrChanges: [] });
  }

  if (input.failure === "STOP_TOO_TIGHT" || input.failure === "STOP_TOO_WIDE") {
    const factor = input.failure === "STOP_TOO_TIGHT" ? 1.2 : 0.8;
    const ch = attrDelta("stoploss", factor);
    if (ch) out.push({ id: `fix_risk_${input.failure.toLowerCase()}`, scope: "risk", paramChanges: [], attrChanges: [ch] });
  }

  return out.slice(0, 5);
}

async function runDiagnosticLoopRun(runId: string) {
  const run = await storage.getDiagnosticLoopRun(runId);
  if (!run) return;

  if (diagnosticLoopStopRequests.has(runId)) {
    diagnosticLoopStopRequests.delete(runId);
    await storage.updateDiagnosticLoopRun(runId, { status: "stopped", stopReason: "stop_requested", finishedAt: new Date() } as any);
    return;
  }

  const baseConfig = run.baseConfig && typeof run.baseConfig === "object" ? run.baseConfig : {};
  const maxIterations = clampNum((baseConfig as any)?.maxIterations ?? 3, 1, 3);
  const drawdownCap = clampNum((baseConfig as any)?.drawdownCap ?? 0.2, 0, 1);
  const model = String((baseConfig as any)?.model ?? "meta-llama/llama-3-8b-instruct:free");

  await storage.updateDiagnosticLoopRun(runId, {
    status: "running",
    startedAt: new Date(),
    progress: { percent: 0, iteration: 0, stage: "start", timeframe: "", step: "start" } as DiagnosticLoopProgress,
  } as any);

  const projectRoot = process.cwd();
  const strategyPath = String(run.strategyPath);

  const versionsDir = path.join(projectRoot, "user_data", "strategies", "versions");
  await fs.mkdir(versionsDir, { recursive: true });

  const readStrategy = async () => {
    const abs = resolvePathWithinProject(strategyPath);
    return await fs.readFile(abs, "utf-8");
  };

  const snapshotPathForIter = async (iteration: number) => {
    const base = path.basename(strategyPath);
    const content = await readStrategy();
    const p = path.join(versionsDir, `${base}.${runId}.iter${iteration}.py`);
    await fs.writeFile(p, content, "utf-8");
    return p;
  };

  const restoreSnapshot = async (p: string) => {
    const abs = resolvePathWithinProject(strategyPath);
    const content = await fs.readFile(p, "utf-8");
    await fs.writeFile(abs, content, "utf-8");
    await storage.syncWithFilesystem();
  };

  const makeBacktestInput = (timeframe: string) => {
    const cfg = (baseConfig as any)?.config && typeof (baseConfig as any).config === "object" ? (baseConfig as any).config : baseConfig;
    const next = cfg && typeof cfg === "object" ? JSON.parse(JSON.stringify(cfg)) : {};
    next.timeframe = timeframe;
    if (typeof (baseConfig as any)?.timerange === "string" && String((baseConfig as any).timerange).trim()) {
      next.timerange = String((baseConfig as any).timerange);
    }
    if (Array.isArray((baseConfig as any)?.pairs) && (baseConfig as any).pairs.length) {
      next.pairs = (baseConfig as any).pairs;
    }
    if (typeof next.timerange !== "string" || !next.timerange.trim()) {
      next.timerange = buildTimerange(next.backtest_date_from, next.backtest_date_to);
    }
    return { strategyName: strategyPath, config: next };
  };

  const startBacktest = async (timeframe: string) => {
    const input = makeBacktestInput(timeframe);
    const backtest = await storage.createBacktest(input as any);

    try {
      const runDir = path.join(projectRoot, "user_data", "backtest_results", "runs", String(backtest.id));
      await fs.mkdir(runDir, { recursive: true });
      const strategyAbs = resolvePathWithinProject(String(input.strategyName || ""));
      const configAbs = path.join(projectRoot, "user_data", "config.json");
      const [strategyContent, configContent] = await Promise.all([
        fs.readFile(strategyAbs, "utf-8"),
        fs.readFile(configAbs, "utf-8"),
      ]);
      const snapshot = {
        version: 1,
        createdAt: new Date().toISOString(),
        backtestId: backtest.id,
        strategyPath: String(input.strategyName || ""),
        strategyContent,
        configPath: "user_data/config.json",
        configContent,
        runInput: input,
      };
      await fs.writeFile(path.join(runDir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
    } catch {
    }

    runActualBacktest(backtest.id, input);
    return backtest.id;
  };

  const waitBacktest = async (backtestId: number, timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const bt = await storage.getBacktest(backtestId);
      if (bt?.status === "completed" || bt?.status === "failed") return bt;
      if (diagnosticLoopStopRequests.has(runId)) return bt;
      await sleep(1000);
    }
    return await storage.getBacktest(backtestId);
  };

  const extractFeaturesAndPhases = async (backtestId: number, strategyContent: string) => {
    const parser = new BacktestParser();
    const summaryPath = path.join(projectRoot, "user_data", "backtest_results", `backtest-result-${backtestId}.json`);
    let btData: any = null;
    try {
      const raw = await fs.readFile(summaryPath, "utf-8");
      btData = JSON.parse(raw);
    } catch {
      btData = null;
    }
    if (!btData) {
      btData = parser.parse(String(backtestId));
    }
    if (!btData) throw new Error("Backtest results not found");

    const phase1 = new Phase1Structural();
    const structural = await phase1.analyze(btData, strategyContent, { backtestId });

    const phase2 = new Phase2Performance();
    const perf = phase2.analyze(btData);
    const phase3 = new Phase3Drawdown();
    const dd = phase3.analyze(btData);
    const phase4 = new Phase4EntryQuality();
    const entry = phase4.analyze(btData);
    const phase5 = new Phase5Exit();
    const exit = phase5.analyze(btData);
    const phase6 = new Phase6Regime();
    const regime = await phase6.analyze(btData);
    const phase7 = new Phase7Costs();
    const costs = await phase7.analyze(btData);
    const phase8 = new Phase8Logic();
    const logic = phase8.analyze(strategyContent);
    const phase9 = new Phase9Statistics();
    const stats = phase9.analyze(btData);

    const stratKey = btData?.strategy && typeof btData.strategy === "object" ? Object.keys(btData.strategy)[0] : null;
    const strat = stratKey ? btData.strategy[stratKey] : null;
    const profitTotal = Number((btData as any)?.profit_total ?? strat?.profit_total ?? (btData as any)?.profitTotal ?? 0);
    const maxDrawdown = Number((btData as any)?.max_drawdown ?? (btData as any)?.maxDrawdown ?? strat?.max_drawdown_account ?? strat?.max_drawdown ?? 0);
    const phase9Verdict = String(stats?.sampleAdequacy?.verdict ?? "FAIL");

    const edgeReasons: string[] = [];
    if (!(profitTotal > 0)) edgeReasons.push("profit_total_not_positive");
    if (phase9Verdict !== "PASS") edgeReasons.push("phase9_not_pass");
    if (!(maxDrawdown <= drawdownCap)) edgeReasons.push("drawdown_above_cap");
    if (profitTotal > 0 && costs?.costSensitivity && costs.costSensitivity.edgeViable === false) edgeReasons.push("edge_not_viable_after_cost_stress");

    const features = {
      global: {
        net_profit: profitTotal,
        max_drawdown: maxDrawdown,
        sharpe: null,
        expectancy: Number(perf?.expectancy?.expectancy ?? 0),
        trade_count: Number(perf?.expectancy?.totals?.totalTrades ?? 0),
      },
      trade_behavior: {
        avg_trade_duration_min: null,
        pct_stoploss_exits: null,
        pct_roi_exits: null,
        avg_ma_distance_at_entry: null,
        mae_mfe: null,
      },
      market_context: {
        volatility_bucket: "unknown",
        trend_direction: "unknown",
        volume_percentile: null,
      },
      cost_stress: {
        profit_after_stress: Number(costs?.costSensitivity?.combinedStress ?? profitTotal),
        edge_viable_after_stress: Boolean(costs?.costSensitivity?.edgeViable),
      },
    };

    const edgeOk = edgeReasons.length === 0;

    return {
      features,
      phases: { structural, perf, dd, entry, exit, regime, costs, logic, stats },
      edge: { ok: edgeOk, reasons: edgeReasons, profitTotal, maxDrawdown, phase9Verdict },
    };
  };

  const runReport: any = {
    runId,
    strategyPath,
    maxIterations,
    drawdownCap,
    model,
    iterations: [],
    outcome: "",
    stopReason: "",
  };

  let lastPhases: any = null;
  const buildSummary = (phases: any) => {
    try {
      if (!phases) return null;
      const phase10 = new Phase10Report();
      const phase11 = new Phase11Signals();
      const input = {
        phase1: { structuralIntegrity: phases.structural },
        phase2: { performance: phases.perf },
        phase3: { drawdownRisk: phases.dd },
        phase4: { entryQuality: phases.entry },
        phase5: { exitLogic: phases.exit },
        phase6: { regimeAnalysis: phases.regime },
        phase7: { costAnalysis: phases.costs },
        phase8: { logicIntegrity: phases.logic },
        phase9: { statistics: phases.stats },
      };
      return {
        summary: phase10.analyze(input),
        signals: phase11.analyze(input),
      };
    } catch {
      return null;
    }
  };

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (diagnosticLoopStopRequests.has(runId)) {
        diagnosticLoopStopRequests.delete(runId);
        await storage.updateDiagnosticLoopRun(runId, { status: "stopped", stopReason: "stop_requested", finishedAt: new Date(), report: runReport } as any);
        return;
      }

      await storage.updateDiagnosticLoopRun(runId, {
        progress: { percent: Math.round(((iteration - 1) / maxIterations) * 100), iteration, stage: "baseline", timeframe: "", step: "start" } as DiagnosticLoopProgress,
      } as any);

      const snapshotPath = await snapshotPathForIter(iteration);
      const strategyContent = await readStrategy();

      const baseline: any = {};
      for (const timeframe of ["5m", "15m"]) {
        await storage.updateDiagnosticLoopRun(runId, {
          progress: { percent: 0, iteration, stage: "baseline", timeframe, step: "backtest" } as DiagnosticLoopProgress,
        } as any);

        const backtestId = await startBacktest(timeframe);
        const bt = await waitBacktest(backtestId, 1000 * 60 * 30);
        if (!bt) {
          runReport.outcome = "FAIL";
          runReport.stopReason = "backtest_missing";
          runReport.backtestError = { iteration, timeframe, backtestId, message: "Backtest record missing" };
          await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
          return;
        }
        if (bt.status !== "completed") {
          const info = backtestFailureInfo(bt);
          const stopReason = bt.status === "running" ? "backtest_timeout" : "backtest_failed";
          runReport.outcome = "FAIL";
          runReport.stopReason = stopReason;
          runReport.backtestError = { iteration, timeframe, backtestId, ...info };

          await storage.createDiagnosticLoopIteration({
            runId,
            iteration,
            stage: "baseline",
            timeframe,
            backtestId,
            failure: "BACKTEST_FAILED",
            confidence: 1,
            validation: { ok: false, stopReason, error: info },
          } as any);

          await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
          return;
        }

        const extracted = await extractFeaturesAndPhases(backtestId, strategyContent);

        if (String(extracted?.phases?.structural?.verdict || "").toUpperCase() === "FAIL") {
          runReport.outcome = "FAIL";
          runReport.stopReason = "structural_fail";
          runReport.summary = buildSummary(extracted.phases);
          await storage.createDiagnosticLoopIteration({
            runId,
            iteration,
            stage: "baseline",
            timeframe,
            backtestId,
            features: extracted.features,
            failure: "STRUCTURAL_FAIL",
            confidence: 1,
            validation: { structural: extracted.phases.structural },
          } as any);
          await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
          return;
        }
        const row = await storage.createDiagnosticLoopIteration({
          runId,
          iteration,
          stage: "baseline",
          timeframe,
          backtestId,
          features: extracted.features,
          validation: { edge: extracted.edge },
        } as any);

        baseline[timeframe] = { row, extracted };

        if (extracted.edge.ok) {
          runReport.outcome = "SUCCESS";
          runReport.stopReason = `edge_detected_${timeframe}`;
          runReport.iterations.push({ iteration, success: true, timeframe, edge: extracted.edge });
          await storage.updateDiagnosticLoopRun(runId, { status: "completed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
          return;
        }
      }

      const primaryTf = "5m";
      const primary = baseline[primaryTf]?.extracted;
      if (!primary) throw new Error("Missing baseline features");

      const classification = classifyLoopFailure({
        perf: primary.phases.perf,
        entry: primary.phases.entry,
        exit: primary.phases.exit,
        drawdown: primary.phases.dd,
        stats: primary.phases.stats,
      });

      lastPhases = primary.phases;

      const baselineRowId = Number(baseline[primaryTf].row.id);
      await storage.updateDiagnosticLoopIteration(baselineRowId, {
        failure: classification.failure,
        confidence: classification.confidence,
      } as any);

      runReport.iterations.push({
        iteration,
        primaryTimeframe: primaryTf,
        failure: classification.failure,
        confidence: classification.confidence,
        evidence: classification.evidence,
        baselineEdge: primary.edge,
      });

      if (classification.confidence < 0.6 || classification.failure === "NO_EDGE") {
        runReport.outcome = "FAIL";
        runReport.stopReason = classification.failure === "NO_EDGE" ? "no_edge_detected" : "low_confidence";
        runReport.summary = buildSummary(lastPhases);
        await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
        return;
      }

      await storage.updateDiagnosticLoopRun(runId, {
        progress: { percent: 0, iteration, stage: "propose", timeframe: primaryTf, step: "extract_params" } as DiagnosticLoopProgress,
      } as any);

      const params = await extractStrategyParams(strategyPath);
      const attrs = await extractStrategyAttrs(strategyPath);
      const fixes = buildAllowedFixes({ failure: classification.failure, params, attrs });
      if (!fixes.length) {
        runReport.outcome = "FAIL";
        runReport.stopReason = "no_allowed_fixes";
        runReport.summary = buildSummary(lastPhases);
        await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
        return;
      }

      const aiChoice = await chooseDiagnosticLoopFixWithAi({
        model,
        features: primary.features,
        failure: classification.failure,
        confidence: classification.confidence,
        evidence: classification.evidence,
        allowedFixes: fixes,
      });

      const selected = aiChoice?.selectedFixId ? (fixes.find((f) => f.id === aiChoice.selectedFixId) ?? fixes[0]) : fixes[0];
      const proposedChanges = {
        selectedFixId: selected.id,
        ai: aiChoice,
        scope: selected.scope,
        paramChanges: selected.paramChanges,
        attrChanges: selected.attrChanges,
      };

      await storage.updateDiagnosticLoopIteration(baselineRowId, { proposedChanges } as any);

      await storage.updateDiagnosticLoopRun(runId, {
        progress: { percent: 0, iteration, stage: "apply", timeframe: primaryTf, step: "apply_changes" } as DiagnosticLoopProgress,
      } as any);

      const beforeStrategy = await readStrategy();

      if (Array.isArray(selected.paramChanges) && selected.paramChanges.length) {
        const changes = selected.paramChanges.slice(0, 3).map((c: any) => ({ name: c.name, before: c.before, after: c.after }));
        await applyStrategyParamChanges(strategyPath, changes);
      }
      if (Array.isArray(selected.attrChanges) && selected.attrChanges.length) {
        const changes = selected.attrChanges.slice(0, 3).map((c: any) => ({ name: c.name, before: c.before, after: c.after }));
        await applyStrategyAttrChanges(strategyPath, changes);
      }

      await storage.syncWithFilesystem();
      const afterStrategy = await readStrategy();
      const appliedDiff = simpleDiffText(beforeStrategy, afterStrategy);
      await storage.updateDiagnosticLoopIteration(baselineRowId, { appliedDiff } as any);

      await storage.updateDiagnosticLoopRun(runId, {
        progress: { percent: 0, iteration, stage: "validation", timeframe: "", step: "backtest" } as DiagnosticLoopProgress,
      } as any);

      let validationOk = true;
      let edgeDetected: any = null;

      for (const timeframe of ["5m", "15m"]) {
        const backtestId = await startBacktest(timeframe);
        const bt = await waitBacktest(backtestId, 1000 * 60 * 30);
        if (!bt || bt.status !== "completed") {
          validationOk = false;
          const info = backtestFailureInfo(bt);
          await storage.createDiagnosticLoopIteration({
            runId,
            iteration,
            stage: "validation",
            timeframe,
            backtestId,
            failure: "BACKTEST_FAILED",
            confidence: 1,
            validation: { ok: false, stopReason: "backtest_failed", error: info },
          } as any);
          break;
        }
        const extracted = await extractFeaturesAndPhases(backtestId, afterStrategy);

        await storage.createDiagnosticLoopIteration({
          runId,
          iteration,
          stage: "validation",
          timeframe,
          backtestId,
          features: extracted.features,
          validation: { edge: extracted.edge },
        } as any);

        const baselineDd = Number(baseline[timeframe]?.extracted?.edge?.maxDrawdown ?? NaN);
        if (Number.isFinite(baselineDd) && extracted.edge.maxDrawdown > baselineDd + 1e-6) {
          validationOk = false;
        }
        if (extracted.edge.ok) edgeDetected = { timeframe, edge: extracted.edge };
      }

      if (!validationOk) {
        await restoreSnapshot(snapshotPath);
        await storage.updateDiagnosticLoopIteration(baselineRowId, { validation: { ok: false, reason: "validation_failed_or_drawdown_increased" } } as any);
        runReport.outcome = "FAIL";
        runReport.stopReason = "validation_failed";
        runReport.summary = buildSummary(lastPhases);
        await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
        return;
      }

      await storage.updateDiagnosticLoopIteration(baselineRowId, { validation: { ok: true } } as any);

      if (edgeDetected) {
        runReport.outcome = "SUCCESS";
        runReport.stopReason = `edge_detected_${edgeDetected.timeframe}`;
        await storage.updateDiagnosticLoopRun(runId, { status: "completed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
        return;
      }
    }

    runReport.outcome = "FAIL";
    runReport.stopReason = "max_iterations_reached";
    runReport.summary = buildSummary(lastPhases);
    await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
  } catch (err: any) {
    runReport.outcome = "FAIL";
    runReport.stopReason = "internal_error";
    runReport.error = String(err?.message || err);
    await storage.updateDiagnosticLoopRun(runId, { status: "failed", stopReason: runReport.stopReason, finishedAt: new Date(), report: runReport } as any);
  }
}

async function processDiagnosticQueue() {
  if (diagnosticWorkerRunning) return;
  diagnosticWorkerRunning = true;
  try {
    while (diagnosticQueue.length > 0) {
      const jobId = diagnosticQueue.shift();
      if (!jobId) continue;
      await runDiagnosticJob(jobId);
    }
  } finally {
    diagnosticWorkerRunning = false;
  }
}

async function enqueueDiagnosticLoopRun(runId: string) {
  diagnosticLoopQueue.push(runId);
  if (!diagnosticLoopWorkerRunning) {
    processDiagnosticLoopQueue().catch((err) => {
      console.error("Diagnostic loop queue error:", err);
    });
  }
}

async function processDiagnosticLoopQueue() {
  if (diagnosticLoopWorkerRunning) return;
  diagnosticLoopWorkerRunning = true;
  try {
    while (diagnosticLoopQueue.length > 0) {
      const runId = diagnosticLoopQueue.shift();
      if (!runId) continue;
      await runDiagnosticLoopRun(runId);
    }
  } finally {
    diagnosticLoopWorkerRunning = false;
  }
}

async function updateDiagnosticProgress(jobId: string, progress: DiagnosticProgress) {
  await storage.updateDiagnosticJob(jobId, { progress });
}

async function runDiagnosticJob(jobId: string) {
  const job = await storage.getDiagnosticJob(jobId);
  if (!job) return;

  await storage.updateDiagnosticJob(jobId, {
    status: "running",
    startedAt: new Date(),
    progress: { percent: 0, currentPhase: "phase1", phasesCompleted: [] } as DiagnosticProgress,
  });

  try {
    const parser = new BacktestParser();
    const backtestData = parser.parse(String(job.backtestId));
    if (!backtestData) {
      await storage.updateDiagnosticJob(jobId, {
        status: "failed",
        error: "Backtest results not found",
        finishedAt: new Date(),
        progress: { percent: 100, currentPhase: "failed", phasesCompleted: [] } as DiagnosticProgress,
      });
      return;
    }

    let strategyContent = "";
    if (job.strategyPath) {
      const file = await storage.getFileByPath(job.strategyPath);
      strategyContent = file?.content || "";
    }

    const backtest = await storage.getBacktest(job.backtestId);
    const cfg = (backtest as any)?.config;
    const timerange = String(cfg?.timerange || "") || buildTimerange(cfg?.backtest_date_from, cfg?.backtest_date_to) || "unknown";
    const timeframe =
      backtestData.strategy?.[Object.keys(backtestData.strategy)[0]]?.timeframe ||
      cfg?.timeframe ||
      "unknown";

    const progress = (percent: number, currentPhase: string, phasesCompleted: string[]) =>
      updateDiagnosticProgress(jobId, { percent, currentPhase, phasesCompleted });

    const phase1 = new Phase1Structural();
    const structuralReport = await phase1.analyze(backtestData, strategyContent, { backtestId: job.backtestId });
    await progress(10, "phase2", ["phase1"]);

    const reportId = uuidv4();

    const shouldFailFast = String(structuralReport?.verdict || "").toUpperCase() === "FAIL";
    let fullReport: any = null;
    let failureSignalsReport: any = null;
    let changeTargets: Array<{ kind: "insert"; anchor: { kind: "heuristic_indicators" }; changeType: string }> = [];

    let finalPhasesCompleted: string[] = [];

    const buildChangeTargets = (report: any) => {
      const recommended = report?.recommendedChangeTypes ?? [];
      const targets = recommended.map((changeType: string) => ({
        kind: "insert" as const,
        anchor: { kind: "heuristic_indicators" as const },
        changeType,
      }));
      return targets.length ? targets : [];
    };

    if (shouldFailFast) {
      const phase11 = new Phase11Signals();
      failureSignalsReport = phase11.analyze({
        phase1: { structuralIntegrity: structuralReport },
      });
      changeTargets = buildChangeTargets(failureSignalsReport);
      const phase10 = new Phase10Report();
      const finalSummary = phase10.analyze({
        phase1: { structuralIntegrity: structuralReport },
      });

      fullReport = {
        metadata: {
          reportId,
          timestamp: new Date().toISOString(),
          backtestId: String(job.backtestId),
          strategy: job.strategyPath || "unknown",
          timeframe,
          timerange,
          stopReason: "Phase 1 structural integrity failed",
        },
        phase1: { structuralIntegrity: structuralReport },
        phase11: { failureSignals: failureSignalsReport },
        summary: finalSummary,
        changeTargets,
      };

      finalPhasesCompleted = ["phase1", "phase10", "phase11"];
      await progress(100, "completed", finalPhasesCompleted);
    } else {
      const phase2 = new Phase2Performance();
      const performanceReport = phase2.analyze(backtestData);
      await progress(20, "phase3", ["phase1", "phase2"]);

      const phase3 = new Phase3Drawdown();
      const drawdownRiskReport = phase3.analyze(backtestData);
      await progress(30, "phase4", ["phase1", "phase2", "phase3"]);

      const phase4 = new Phase4EntryQuality();
      const entryQualityReport = phase4.analyze(backtestData);
      await progress(40, "phase5", ["phase1", "phase2", "phase3", "phase4"]);

      const phase5 = new Phase5Exit();
      const exitLogicReport = phase5.analyze(backtestData);
      await progress(50, "phase6", ["phase1", "phase2", "phase3", "phase4", "phase5"]);

      const phase6 = new Phase6Regime();
      const regimeAnalysisReport = await phase6.analyze(backtestData);
      await progress(60, "phase7", ["phase1", "phase2", "phase3", "phase4", "phase5", "phase6"]);

      const phase7 = new Phase7Costs();
      const costAnalysisReport = await phase7.analyze(backtestData);
      await progress(70, "phase8", ["phase1", "phase2", "phase3", "phase4", "phase5", "phase6", "phase7"]);

      const phase8 = new Phase8Logic();
      const logicIntegrityReport = phase8.analyze(strategyContent);
      await progress(80, "phase9", ["phase1", "phase2", "phase3", "phase4", "phase5", "phase6", "phase7", "phase8"]);

      const phase9 = new Phase9Statistics();
      const statisticsReport = phase9.analyze(backtestData);
      await progress(90, "phase10", ["phase1", "phase2", "phase3", "phase4", "phase5", "phase6", "phase7", "phase8", "phase9"]);

      const phase11 = new Phase11Signals();
      failureSignalsReport = phase11.analyze({
        phase1: { structuralIntegrity: structuralReport },
        phase2: { performance: performanceReport },
        phase3: { drawdownRisk: drawdownRiskReport },
        phase6: { regimeAnalysis: regimeAnalysisReport },
        phase7: { costAnalysis: costAnalysisReport },
        phase8: { logicIntegrity: logicIntegrityReport },
        phase9: { statistics: statisticsReport },
      });
      changeTargets = buildChangeTargets(failureSignalsReport);

      const phase10 = new Phase10Report();
      const finalSummary = phase10.analyze({
        phase1: { structuralIntegrity: structuralReport },
        phase2: { performance: performanceReport },
        phase3: { drawdownRisk: drawdownRiskReport },
        phase4: { entryQuality: entryQualityReport },
        phase5: { exitLogic: exitLogicReport },
        phase6: { regimeAnalysis: regimeAnalysisReport },
        phase7: { costAnalysis: costAnalysisReport },
        phase8: { logicIntegrity: logicIntegrityReport },
        phase9: { statistics: statisticsReport },
      });

      fullReport = {
        metadata: {
          reportId,
          timestamp: new Date().toISOString(),
          backtestId: String(job.backtestId),
          strategy: job.strategyPath || "unknown",
          timeframe,
          timerange,
        },
        phase1: { structuralIntegrity: structuralReport },
        phase2: { performance: performanceReport },
        phase3: { drawdownRisk: drawdownRiskReport },
        phase4: { entryQuality: entryQualityReport },
        phase5: { exitLogic: exitLogicReport },
        phase6: { regimeAnalysis: regimeAnalysisReport },
        phase7: { costAnalysis: costAnalysisReport },
        phase8: { logicIntegrity: logicIntegrityReport },
        phase9: { statistics: statisticsReport },
        phase11: { failureSignals: failureSignalsReport },
        summary: finalSummary,
        changeTargets,
      };

      finalPhasesCompleted = ["phase1", "phase2", "phase3", "phase4", "phase5", "phase6", "phase7", "phase8", "phase9", "phase10"];
      await progress(100, "completed", finalPhasesCompleted);
    }

    await storage.createDiagnosticReport({
      reportId,
      backtestId: Number(job.backtestId),
      strategy: job.strategyPath || "unknown",
      timeframe,
      timerange,
      report: fullReport,
    });

    if (changeTargets.length) {
      await storage.createDiagnosticChangeTargets({
        reportId,
        backtestId: Number(job.backtestId),
        strategy: job.strategyPath || "unknown",
        targets: changeTargets,
      });
    }

    await storage.updateDiagnosticJob(jobId, {
      status: "completed",
      reportId,
      finishedAt: new Date(),
      progress: { percent: 100, currentPhase: "completed", phasesCompleted: finalPhasesCompleted } as DiagnosticProgress,
    });
  } catch (error: any) {
    await storage.updateDiagnosticJob(jobId, {
      status: "failed",
      error: error?.message || "Diagnostic failed",
      finishedAt: new Date(),
      progress: { percent: 100, currentPhase: "failed", phasesCompleted: [] } as DiagnosticProgress,
    });
  }
}

let cachedFreeModels:
  | Array<{ id: string; name: string; description?: string }>
  | null = null;
let cachedFreeModelsAt = 0;

function getOpenRouterApiKey() {
  return process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
}

function getOpenRouterBaseUrl() {
  return process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
}

function normalizeChildProcessLine(line: string) {
  return line.replace(/^\[(ERROR|WARN|WARNING|INFO)\]\s*/i, "");
}

function toTimerangePart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value.replace(/-/g, "");
}

function buildTimerange(from?: string, to?: string) {
  const fromPart = from ? toTimerangePart(String(from)) : "";
  const toPart = to ? toTimerangePart(String(to)) : "";
  return (fromPart || toPart) ? `${fromPart}-${toPart}` : "";
}

function clampText(value: unknown, maxChars: number): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[...truncated ${s.length - maxChars} chars...]`;
}

function fileWindowByLine(content: string, lineNumber: number | undefined, radiusLines: number): string {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.length === 0) return "";
  const target = Math.min(Math.max(1, Number(lineNumber || 1)), lines.length);
  const start = Math.max(1, target - radiusLines);
  const end = Math.min(lines.length, target + radiusLines);
  const snippet = lines.slice(start - 1, end).join("\n");
  return `# File window: lines ${start}-${end} (cursor at ${target})\n${snippet}`;
}

type DerivedTradeMetrics = {
  totalTrades: number;
  winners: number;
  losers: number;
  expectancy?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  profitFactor?: number | null;
  winLossRatio?: number | null;
  avgTradeDurationMin?: number | null;
  tradesPerDay?: number | null;
  units: "ratio" | "abs";
  coverageRatio: number; // percent of trades with usable profit metric
};

function computeDerivedTradeMetrics(tradesRaw: any[]): DerivedTradeMetrics | null {
  if (!Array.isArray(tradesRaw) || tradesRaw.length === 0) return null;

  const trades = tradesRaw.filter((t) => t && typeof t === "object");
  if (!trades.length) return null;

  const ratios = trades
    .map((t) => (Number.isFinite(Number(t.profit_ratio)) ? Number(t.profit_ratio) : NaN))
    .filter((v) => Number.isFinite(v));

  const abs = trades
    .map((t) => (Number.isFinite(Number(t.profit_abs)) ? Number(t.profit_abs) : NaN))
    .filter((v) => Number.isFinite(v));

  const useRatios = ratios.length >= Math.max(3, Math.floor(trades.length * 0.5));
  const profits = useRatios ? ratios : abs;

  if (profits.length === 0) {
    return {
      totalTrades: trades.length,
      winners: 0,
      losers: 0,
      units: "ratio",
      coverageRatio: 0,
    };
  }

  const winners = profits.filter((v) => v > 0);
  const losers = profits.filter((v) => v < 0);
  const sum = profits.reduce((a, b) => a + b, 0);
  const sumWins = winners.reduce((a, b) => a + b, 0);
  const sumLoss = losers.reduce((a, b) => a + b, 0);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const expectancy = profits.length ? sum / profits.length : null;
  const avgWin = avg(winners);
  const avgLoss = avg(losers);
  const profitFactor = sumLoss < 0 ? sumWins / Math.abs(sumLoss) : null;
  const winLossRatio =
    avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null;

  const durationsMin: number[] = [];
  for (const t of trades) {
    const open = Date.parse(String(t.open_date ?? t.open_date_utc ?? ""));
    const close = Date.parse(String(t.close_date ?? t.close_date_utc ?? ""));
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const mins = (close - open) / 60000;
    if (Number.isFinite(mins) && mins >= 0) durationsMin.push(mins);
  }

  let tradesPerDay: number | null = null;
  if (durationsMin.length > 0) {
    const opens = trades
      .map((t) => Date.parse(String(t.open_date ?? t.open_date_utc ?? "")))
      .filter((v) => Number.isFinite(v));
    const closes = trades
      .map((t) => Date.parse(String(t.close_date ?? t.close_date_utc ?? "")))
      .filter((v) => Number.isFinite(v));
    const minTs = Math.min(...opens, ...closes);
    const maxTs = Math.max(...opens, ...closes);
    const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(spanDays) && spanDays > 0) {
      tradesPerDay = trades.length / spanDays;
    }
  }

  return {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    expectancy,
    avgWin,
    avgLoss,
    profitFactor,
    winLossRatio,
    avgTradeDurationMin: durationsMin.length ? avg(durationsMin) : null,
    tradesPerDay,
    units: useRatios ? "ratio" : "abs",
    coverageRatio: profits.length / trades.length,
  };
}

function fmtMetric(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

function applyBacktestOverridesToConfig(baseConfig: any, runInput: any) {
  const next = baseConfig && typeof baseConfig === "object" ? JSON.parse(JSON.stringify(baseConfig)) : {};
  const cfg = runInput?.config && typeof runInput.config === "object" ? runInput.config : {};

  const strategyPath = typeof runInput?.strategyName === "string" ? String(runInput.strategyName) : "";
  if (strategyPath.trim()) {
    next.strategy = path.basename(strategyPath).replace(/\.py$/i, "");
  }

  if (typeof cfg.timeframe === "string" && cfg.timeframe.trim()) {
    next.timeframe = cfg.timeframe;
  }

  if (typeof cfg.stake_amount === "number" && Number.isFinite(cfg.stake_amount) && cfg.stake_amount > 0) {
    next.dry_run_wallet = cfg.stake_amount;
    if (typeof next.stake_amount === "number" || next.stake_amount !== "unlimited") {
      next.stake_amount = cfg.stake_amount;
    }
  }

  if (typeof cfg.stoploss === "number" && Number.isFinite(cfg.stoploss)) {
    next.stoploss = cfg.stoploss;
  } else {
    delete (next as any).stoploss;
  }

  if (typeof cfg.max_open_trades === "number" && Number.isFinite(cfg.max_open_trades) && cfg.max_open_trades >= 0) {
    next.max_open_trades = Math.floor(cfg.max_open_trades);
  }

  if (typeof cfg.tradable_balance_ratio === "number" && Number.isFinite(cfg.tradable_balance_ratio)) {
    next.tradable_balance_ratio = cfg.tradable_balance_ratio;
  }

  if (typeof cfg.trailing_stop === "boolean") {
    next.trailing_stop = cfg.trailing_stop;
  }
  if (typeof cfg.trailing_stop_positive === "number" && Number.isFinite(cfg.trailing_stop_positive)) {
    next.trailing_stop_positive = cfg.trailing_stop_positive;
  }
  if (typeof cfg.trailing_stop_positive_offset === "number" && Number.isFinite(cfg.trailing_stop_positive_offset)) {
    next.trailing_stop_positive_offset = cfg.trailing_stop_positive_offset;
  }
  if (typeof cfg.trailing_only_offset_is_reached === "boolean") {
    next.trailing_only_offset_is_reached = cfg.trailing_only_offset_is_reached;
  }
  if (cfg.minimal_roi && typeof cfg.minimal_roi === "object" && !Array.isArray(cfg.minimal_roi)) {
    next.minimal_roi = cfg.minimal_roi;
  }

  if (Array.isArray(cfg.pairs) && cfg.pairs.length > 0) {
    if (!next.exchange || typeof next.exchange !== "object") {
      next.exchange = {};
    }
    next.exchange.pair_whitelist = cfg.pairs;

    next.pairlists = [
      {
        method: "StaticPairList",
        pair_whitelist: cfg.pairs,
        pair_blacklist: Array.isArray(next.exchange.pair_blacklist) ? next.exchange.pair_blacklist : [],
      },
    ];
  }

  return next;
}

const boxDrawingCharsRe = /[┏┓┗┛┳┻┡┠┨┼┃│─┌┐└┘]/;

function filterFreqtradeStderrChunk(chunk: string) {
  const text = String(chunk ?? "");
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeChildProcessLine(rawLine).trimEnd();
    if (!line) continue;

    if (boxDrawingCharsRe.test(line)) continue;

    if (
      line.includes("PerformanceWarning") ||
      line.includes("DataFrame is highly fragmented") ||
      line.includes("frame.insert` many times") ||
      line.includes("To get a de-fragmented frame") ||
      line.includes("Consider joining all columns at once")
    ) {
      continue;
    }

    const isInfo = line.includes(" - INFO - ");
    const isWarning = line.includes(" - WARNING - ") || line.includes(" - WARN - ");
    const isTrace =
      line.includes("Traceback") ||
      line.includes("During handling of the above exception") ||
      line.startsWith("  File ") ||
      line.startsWith("File ");
    const isError =
      line.includes(" - ERROR - ") ||
      line.includes("Exception") ||
      line.includes("No data found") ||
      line.includes("Terminating.") ||
      line.includes("Error:") ||
      isTrace;

    if (isInfo) continue;
    if (!isWarning && !isError) continue;

    kept.push(line);
  }

  return kept.length ? `${kept.join("\n")}\n` : "";
}

function resolvePathWithinProject(candidate: string): string {
  const projectRoot = process.cwd();
  const abs = path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path is outside project root: ${candidate}`);
  }
  return abs;
}

function filterFreqtradeStdoutChunk(chunk: string) {
  const text = String(chunk ?? "");
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeChildProcessLine(rawLine).trimEnd();
    if (!line) continue;

    if (boxDrawingCharsRe.test(line)) continue;

    if (
      line.includes("STRATEGY SUMMARY") ||
      line.includes("BACKTESTING REPORT") ||
      line.includes("LEFT OPEN TRADES REPORT") ||
      line.includes("ENTER TAG STATS") ||
      line.includes("EXIT REASON STATS") ||
      line.includes("MIXED TAG STATS") ||
      line.includes("SUMMARY METRICS")
    ) {
      continue;
    }

    kept.push(line);
  }

  return kept.length ? `${kept.join("\n")}\n` : "";
}

async function fetchOpenRouterFreeModels() {
  const baseUrl = getOpenRouterBaseUrl();
  const apiKey = getOpenRouterApiKey();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://replit.com",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed (${response.status})`);
  }

  const data = await response.json() as {
    data?: Array<{
      id?: string;
      name?: string;
      description?: string;
      pricing?: { prompt?: string | number; completion?: string | number };
    }>;
  };

  const raw = Array.isArray(data?.data) ? data.data : [];
  const isZero = (value: unknown) => {
    if (value === 0) return true;
    if (typeof value === "string" && value.trim() === "0") return true;
    const num = Number(value);
    return Number.isFinite(num) && num === 0;
  };

  return raw
    .map((m) => {
      const id = String(m?.id ?? "");
      const name = String(m?.name ?? m?.id ?? "");
      const description = m?.description ? String(m.description) : undefined;
      const pricing = m?.pricing;
      const isFreeBySuffix = id.endsWith(":free");
      const isFreeByPricing = pricing ? isZero(pricing.prompt) && isZero(pricing.completion) : false;
      return { id, name, description, _isFree: isFreeBySuffix || isFreeByPricing };
    })
    .filter((m) => m.id && m._isFree)
    .map(({ _isFree, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === Files Endpoints ===
  app.get(api.files.list.path, async (req, res) => {
    const files = await storage.getFiles();
    res.json(files);
  });

  app.get(api.files.getByPath.path, async (req, res) => {
    const p = typeof req.query.path === "string" ? String(req.query.path) : "";
    if (!p) return res.status(400).json({ message: "Missing path" });
    const file = await storage.getFileByPath(p);
    if (!file) return res.status(404).json({ message: "File not found" });
    res.json(file);
  });

  // Sync files from filesystem
  app.post("/api/files/sync", async (req, res) => {
    try {
      await storage.syncWithFilesystem();
      const files = await storage.getFiles();
      res.json({ success: true, message: "Files synced from filesystem", files });
    } catch (err) {
      console.error("Sync error:", err);
      res.status(500).json({ message: "Failed to sync files" });
    }
  });

  app.post(api.strategies.edit.path, async (req, res) => {
    try {
      const { strategyPath, edits, dryRun } = api.strategies.edit.input.parse(req.body);

      const projectRoot = process.cwd();
      const venvBin = path.join(projectRoot, ".venv", "bin");
      const pythonBin = path.join(venvBin, "python");
      const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "edit_tools.py");

      if (!strategyPath.startsWith("user_data/strategies/")) {
        return res.status(400).json({ message: "strategyPath must be under user_data/strategies/" });
      }

      const absStrategy = resolvePathWithinProject(strategyPath);

      await fs.access(pythonBin);
      await fs.access(scriptPath);

      const env = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectRoot, ".venv"),
        PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
      };

      const proc = spawn(pythonBin, [scriptPath, "apply", absStrategy], {
        cwd: projectRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));

      proc.stdin.write(JSON.stringify({ edits, dryRun }));
      proc.stdin.end();

      proc.on("close", async (code) => {
        if (code !== 0) {
          return res.status(400).json({ message: "Rejected change(s)", details: err || out });
        }

        if (!dryRun) {
          try {
            await storage.syncWithFilesystem();
          } catch (e: any) {
            return res.status(500).json({ message: "Applied but failed to sync filesystem", details: e?.message || String(e) });
          }
        }

        try {
          const parsed = JSON.parse(out);
          return res.json(parsed);
        } catch {
          return res.json({ success: true, dryRun: Boolean(dryRun) });
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(api.files.get.path, async (req, res) => {
    const file = await storage.getFile(Number(req.params.id));
    if (!file) return res.status(404).json({ message: "File not found" });
    res.json(file);
  });

  app.post(api.files.create.path, async (req, res) => {
    try {
      const input = api.files.create.input.parse(req.body);
      const file = await storage.createFile(input);
      res.status(201).json(file);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.files.update.path, async (req, res) => {
    try {
      const { content } = api.files.update.input.parse(req.body);
      const file = await storage.updateFile(Number(req.params.id), content);
      res.json(file);
    } catch (err) {
      res.status(404).json({ message: "File not found" });
    }
  });

  app.delete(api.files.delete.path, async (req, res) => {
    await storage.deleteFile(Number(req.params.id));
    res.status(204).send();
  });

  app.post(api.strategies.params.path, async (req, res) => {
    try {
      const { strategyPath } = api.strategies.params.input.parse(req.body);
      const projectRoot = process.cwd();
      const venvBin = path.join(projectRoot, ".venv", "bin");
      const pythonBin = path.join(venvBin, "python");
      const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "param_tools.py");

      if (!strategyPath.startsWith("user_data/strategies/")) {
        return res.status(400).json({ message: "strategyPath must be under user_data/strategies/" });
      }

      const absStrategy = resolvePathWithinProject(strategyPath);

      await fs.access(pythonBin);
      await fs.access(scriptPath);

      const env = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectRoot, ".venv"),
        PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
      };

      const proc = spawn(pythonBin, [scriptPath, "extract", absStrategy], { cwd: projectRoot, env });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          return res.status(500).json({ message: "Failed to extract parameters", details: err || out });
        }
        try {
          const parsed = JSON.parse(out);
          return res.json(parsed);
        } catch {
          return res.status(500).json({ message: "Invalid parser output", details: err || out });
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post(api.strategies.applyParams.path, async (req, res) => {
    try {
      const { strategyPath, changes } = api.strategies.applyParams.input.parse(req.body);

      const projectRoot = process.cwd();
      const venvBin = path.join(projectRoot, ".venv", "bin");
      const pythonBin = path.join(venvBin, "python");
      const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "param_tools.py");

      if (!strategyPath.startsWith("user_data/strategies/")) {
        return res.status(400).json({ message: "strategyPath must be under user_data/strategies/" });
      }

      const absStrategy = resolvePathWithinProject(strategyPath);

      await fs.access(pythonBin);
      await fs.access(scriptPath);

      const env = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectRoot, ".venv"),
        PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
      };

      const proc = spawn(pythonBin, [scriptPath, "apply", absStrategy], {
        cwd: projectRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (err += d.toString()));

      proc.stdin.write(JSON.stringify({ changes }));
      proc.stdin.end();

      proc.on("close", async (code) => {
        if (code !== 0) {
          return res.status(400).json({ message: "Rejected change(s)", details: err || out });
        }

        try {
          await storage.syncWithFilesystem();
        } catch (e: any) {
          return res.status(500).json({ message: "Applied but failed to sync filesystem", details: e?.message || String(e) });
        }

        try {
          const parsed = JSON.parse(out);
          return res.json(parsed);
        } catch {
          return res.json({ success: true });
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // === Backtests Endpoints ===
  app.get(api.backtests.list.path, async (req, res) => {
    const backtests = await storage.getBacktests();
    res.json(backtests);
  });

  app.post(api.backtests.run.path, async (req, res) => {
    try {
      const input = api.backtests.run.input.parse(req.body);

      if (input?.config && typeof (input as any).config === "object") {
        const cfg = (input as any).config;
        if (typeof cfg.timerange !== "string" || !cfg.timerange.trim()) {
          const timerange = buildTimerange(cfg.backtest_date_from, cfg.backtest_date_to);
          (input as any).config = { ...cfg, timerange };
        }
      }
      
      // 1. Create Backtest Record
      const backtest = await storage.createBacktest(input);

      try {
        const projectRoot = process.cwd();
        const runDir = path.join(projectRoot, "user_data", "backtest_results", "runs", String(backtest.id));
        await fs.mkdir(runDir, { recursive: true });

        const strategyAbs = resolvePathWithinProject(String(input.strategyName || ""));
        const configAbs = path.join(projectRoot, "user_data", "config.json");

        const [strategyContent, configContent] = await Promise.all([
          fs.readFile(strategyAbs, "utf-8"),
          fs.readFile(configAbs, "utf-8"),
        ]);

        const snapshot = {
          version: 1,
          createdAt: new Date().toISOString(),
          backtestId: backtest.id,
          strategyPath: String(input.strategyName || ""),
          strategyContent,
          configPath: "user_data/config.json",
          configContent,
          runInput: input,
        };

        await fs.writeFile(path.join(runDir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
      } catch (e: any) {
        await storage.appendBacktestLog(backtest.id, `\nWARNING: Failed to write rollback snapshot: ${e?.message || e}\n`);
      }

      // 2. Run Actual Backtest (Async)
      runActualBacktest(backtest.id, input);

      res.status(201).json(backtest);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.backtests.get.path, async (req, res) => {
    const backtest = await storage.getBacktest(Number(req.params.id));
    if (!backtest) return res.status(404).json({ message: "Backtest not found" });
    res.json(backtest);
  });

  app.post(api.backtests.batchRun.path, async (req, res) => {
    try {
      const input = api.backtests.batchRun.input.parse(req.body);
      const batchId = String(input.batchId || uuidv4());

      const toIsoDate = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      const parseIsoDate = (s: string) => {
        const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        return Number.isFinite(dt.getTime()) ? dt : null;
      };

      let ranges: Array<{ from: string; to: string }> = [];

      if (Array.isArray(input.ranges) && input.ranges.length > 0) {
        ranges = input.ranges.map((r) => ({ from: String(r.from), to: String(r.to) }));
      } else if (input.rolling) {
        const windowDays = Number(input.rolling.windowDays);
        const stepDays = Number(input.rolling.stepDays ?? input.rolling.windowDays);
        const count = Number(input.rolling.count ?? 4);
        const end = input.rolling.end ? parseIsoDate(String(input.rolling.end)) : null;
        const endDate = end ?? new Date();

        if (!Number.isFinite(windowDays) || windowDays <= 0) {
          return res.status(400).json({ message: "rolling.windowDays must be > 0" });
        }
        if (!Number.isFinite(stepDays) || stepDays <= 0) {
          return res.status(400).json({ message: "rolling.stepDays must be > 0" });
        }
        if (!Number.isFinite(count) || count <= 0) {
          return res.status(400).json({ message: "rolling.count must be > 0" });
        }

        for (let i = 0; i < count; i++) {
          const endDt = new Date(endDate.getTime());
          endDt.setUTCDate(endDt.getUTCDate() - i * stepDays);
          const startDt = new Date(endDt.getTime());
          startDt.setUTCDate(startDt.getUTCDate() - windowDays);
          ranges.push({ from: toIsoDate(startDt), to: toIsoDate(endDt) });
        }

        ranges = ranges.reverse();
      } else {
        return res.status(400).json({ message: "Provide either ranges[] or rolling{}" });
      }

      const created = [] as any[];

      for (let idx = 0; idx < ranges.length; idx++) {
        const r = ranges[idx];
        const timerange = buildTimerange(r.from, r.to);
        const runInput = {
          strategyName: input.strategyName,
          config: {
            ...(input.baseConfig || {}),
            backtest_date_from: r.from,
            backtest_date_to: r.to,
            timerange,
            batchId,
            batchIndex: idx,
            batchRange: `${r.from}→${r.to}`,
          },
        };

        const backtest = await storage.createBacktest(runInput as any);

        try {
          const projectRoot = process.cwd();
          const runDir = path.join(projectRoot, "user_data", "backtest_results", "runs", String(backtest.id));
          await fs.mkdir(runDir, { recursive: true });

          const strategyAbs = resolvePathWithinProject(String(runInput.strategyName || ""));
          const configAbs = path.join(projectRoot, "user_data", "config.json");

          const [strategyContent, configContent] = await Promise.all([
            fs.readFile(strategyAbs, "utf-8"),
            fs.readFile(configAbs, "utf-8"),
          ]);

          const snapshot = {
            version: 1,
            createdAt: new Date().toISOString(),
            backtestId: backtest.id,
            batchId,
            strategyPath: String(runInput.strategyName || ""),
            strategyContent,
            configPath: "user_data/config.json",
            configContent,
            runInput,
          };

          await fs.writeFile(path.join(runDir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
        } catch (e: any) {
          await storage.appendBacktestLog(backtest.id, `\nWARNING: Failed to write rollback snapshot: ${e?.message || e}\n`);
        }

        runActualBacktest(backtest.id, runInput);
        created.push(backtest);
      }

      return res.status(201).json({ batchId, backtests: created });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/backtests/:id/rollback", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid backtest id" });
    }

    try {
      const projectRoot = process.cwd();
      const runDir = path.join(projectRoot, "user_data", "backtest_results", "runs", String(id));
      const snapshotPath = path.join(runDir, "snapshot.json");
      const raw = await fs.readFile(snapshotPath, "utf-8");
      const snapshot = JSON.parse(raw) as {
        strategyPath?: string;
        strategyContent?: string;
        configContent?: string;
      };

      const strategyPath = String(snapshot?.strategyPath || "");
      if (!strategyPath || typeof snapshot?.strategyContent !== "string") {
        return res.status(404).json({ message: "Rollback snapshot is missing strategy data" });
      }
      if (typeof snapshot?.configContent !== "string") {
        return res.status(404).json({ message: "Rollback snapshot is missing config data" });
      }

      const strategyAbs = resolvePathWithinProject(strategyPath);
      const configAbs = path.join(projectRoot, "user_data", "config.json");

      await fs.writeFile(strategyAbs, snapshot.strategyContent, "utf-8");
      await fs.writeFile(configAbs, snapshot.configContent, "utf-8");

      await storage.syncWithFilesystem();

      return res.json({
        success: true,
        backtestId: id,
        strategyPath,
        configPath: "user_data/config.json",
      });
    } catch (e: any) {
      if (e && typeof e === "object" && (e as any).code === "ENOENT") {
        return res.status(404).json({ message: "Rollback snapshot not found for this backtest. Run a new backtest first." });
      }
      return res.status(500).json({ message: e?.message || String(e) });
    }
  });

  // === AI Endpoints ===
  app.get(api.ai.models.path, async (req, res) => {
    try {
      const now = Date.now();
      const cacheMs = 10 * 60 * 1000;

      if (cachedFreeModels && now - cachedFreeModelsAt < cacheMs) {
        return res.json(cachedFreeModels);
      }

      const models = await fetchOpenRouterFreeModels();
      cachedFreeModels = models;
      cachedFreeModelsAt = now;
      return res.json(models);
    } catch (err) {
      if (cachedFreeModels) {
        return res.json(cachedFreeModels);
      }

      const fallback = [
        { id: "google/gemma-2-9b-it:free", name: "Gemma 2 9B (Free)", description: "Google's Gemma 2 model" },
        { id: "mistralai/mistral-7b-instruct:free", name: "Mistral 7B (Free)", description: "Mistral 7B Instruct" },
        { id: "microsoft/phi-3-mini-128k-instruct:free", name: "Phi-3 Mini (Free)", description: "Microsoft Phi-3" },
        { id: "meta-llama/llama-3-8b-instruct:free", name: "Llama 3 8B (Free)", description: "Meta Llama 3" },
      ];
      return res.json(fallback);
    }
  });

  app.post(api.ai.test.path, async (req, res) => {
    try {
      const { model } = api.ai.test.input.parse(req.body);

      const apiKey = getOpenRouterApiKey();
      const baseUrl = getOpenRouterBaseUrl();

      if (!apiKey) {
        return res.status(500).json({ message: "OpenRouter API key not configured" });
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://replit.com",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Reply with: OK" },
          ],
          max_tokens: 16,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("OpenRouter test error:", error);
        return res.status(500).json({ message: "Failed to test model" });
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data?.choices?.[0]?.message?.content;
      return res.json({ success: true, model, response: content ? String(content) : "" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("AI test error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // AI Chat endpoint
  app.post(api.ai.chat.path, async (req, res) => {
    try {
      const input = api.ai.chat.input.parse(req.body);
      const { message, model, context } = input;

      const apiKey = getOpenRouterApiKey();
      const baseUrl = getOpenRouterBaseUrl();

      if (!apiKey) {
        return res.status(500).json({ message: "OpenRouter API key not configured" });
      }

      // Build system prompt with context
      let systemPrompt = `You are an elite FreqTrade strategy developer and technical analyst.
Your expertise covers the entire FreqTrade ecosystem, including strategy development, backtesting, hyperopt, and live trading.

CRITICAL INSTRUCTIONS:
1. Python/FreqTrade Excellence: Write clean, idiomatic Python. Use IStrategy standards. Suggest efficient use of talib, qtpylib, and pandas.
2. Logic & Edge: Focus on finding trading edges. Suggest improvements to populate_indicators, populate_entry_trend, and populate_exit_trend.
3. Risk Management: Always consider stoploss, trailing stoploss, and ROI. Warn about look-ahead bias and overfitting.
4. Backtest Analysis: Help users interpret backtest results (Profit, Drawdown, Win Rate, Sharpe Ratio).
5. Precision: Use the provided context (line numbers, selection) to give highly specific answers. If you see a bug, explain WHY it's a bug in a trading context.
6. Documentation: Provide clear, educational comments within code blocks.

Grounding Rules (Non-Negotiable):
- Do NOT invent facts (pairs traded, timeframe, trade duration, win/loss counts, profit factor, etc.). If a value is not explicitly present in the provided context, label it as unknown and ask for it.
- If you reference a file/function/parameter, it MUST exist in the provided file content. If it does not exist, ask the user to open the correct strategy file and do not guess.
- When you make recommendations based on metrics, tie each recommendation to the specific metric(s) provided (e.g., win_rate, max_drawdown, profit_total, total_trades).

Default Behavior:
- If the user request is vague (e.g. "improve", "what's missing", "why is this bad") and backtest results are provided, you MUST proactively analyze the metrics and explain what is missing / likely wrong (expectancy, drawdown control, trade quality, exit logic, costs/slippage, overfitting).
- If appropriate, propose concrete next steps (parameter changes, additional filters, risk controls) and explain why.

When Providing Code:
- ALWAYS wrap code in markdown blocks with the language identifier (e.g., \`\`\`python).
- Ensure generated code is ready for the "Apply" feature.
- Include necessary imports if they are missing from the context.`;

      systemPrompt += `\n\nConfig Updates:\n- If the user asks to change backtest configuration (strategy name, timeframe, stake, dates, pairs, limits), output a single \`\`\`json code block containing ONLY the keys to change from: strategy, timeframe, stake_amount, max_open_trades, tradable_balance_ratio, stoploss, trailing_stop, trailing_stop_positive, trailing_stop_positive_offset, trailing_only_offset_is_reached, minimal_roi, backtest_date_from, backtest_date_to, pairs. Example:\n\`\`\`json\n{\n  "strategy": "AIStrategy",\n  "timeframe": "5m",\n  "max_open_trades": 2,\n  "stoploss": -0.1,\n  "trailing_stop": true,\n  "trailing_stop_positive": 0.01,\n  "trailing_stop_positive_offset": 0.02,\n  "trailing_only_offset_is_reached": false,\n  "minimal_roi": {}\n}\n\`\`\``;

      systemPrompt += `\n\nExecutable Actions (Optional):\n- If the user asks you to RUN a backtest, validate over different time ranges, or do a multi-range check, you MAY output a single \`\`\`action code block containing JSON with this shape:\n\`\`\`action\n{\n  \"action\": \"run_backtest\" | \"run_batch_backtest\" | \"run_diagnostic\",\n  \"payload\": { ... }\n}\n\`\`\`\n- For action \"run_backtest\", payload may include:\n  - strategyName (optional)\n  - config: { timeframe, stake_amount, backtest_date_from, backtest_date_to, timerange, pairs, max_open_trades, tradable_balance_ratio, ... }\n- For action \"run_batch_backtest\", payload may include:\n  - strategyName (optional)\n  - baseConfig: { timeframe, stake_amount, pairs, max_open_trades, tradable_balance_ratio, ... }\n  - ranges: [{\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\"}, ...] OR rolling: {\"windowDays\":90,\"stepDays\":90,\"count\":4,\"end\":\"YYYY-MM-DD\"}\n- For action \"run_diagnostic\", payload must include:\n  - backtestId (required)\n  - strategyPath (optional)\n- If the user asks for \"validate across time ranges\" but does NOT specify the ranges, default to a rolling plan of 4 windows of 90 days ending today.`;

      systemPrompt += `\n\nTargeted Edits:\n- If the user has selected code, assume they want a targeted replacement. Return a single \`\`\`python code block containing ONLY the updated replacement snippet for the selected block (typically one function), and keep the same function name unless the user explicitly asks to rename it.\n- If the user has NOT selected code but the cursor is inside a function (cursorFunctionName is provided), prefer modifying that function and return ONLY that function definition as a single \`\`\`python code block.`;
      systemPrompt += `\n\nValidation Requirement:\n- Before you propose a code change, confirm that the function/class/attribute you are changing EXISTS in the provided file content.\n- If it does NOT exist, ask the user to open the correct strategy file and do NOT guess.\n- Prefer returning a single existing function (by name) rather than introducing new ones unless explicitly requested.`;

      systemPrompt += `\n\nResponse Quality Bar:\n- Start with a 3–5 line summary grounded in provided metrics.\n- Then provide: (1) what looks good, (2) biggest risk, (3) the top 3 next experiments ordered by expected impact.\n- Every recommendation MUST cite the metric(s) that justify it (e.g., win_rate, profit_factor, expectancy, avg_win/loss, max_drawdown, trades_per_day).\n- If you need missing metrics to be confident (expectancy, avg profit, profit factor, fees/slippage assumptions, timeframe/pairs), ask concise follow-up questions instead of assuming.\n- If metrics are ambiguous or insufficient, present CHOICES with \"Run Diagnostic\" vs \"Continue with current metrics\" vs \"Ask for additional metrics\".\n`;

      systemPrompt += `\n\nMetrics-to-Recommendation Mapping:\n- ALWAYS include a section titled \"Metrics-to-Recommendation Mapping\".\n- Provide 3–6 bullet points in the format:\n  - <metric> → <recommendation> (why)\n- Each recommendation must reference a metric value from the context.\n`;

      systemPrompt += `\n\nFormatting Rules:\n- When you propose a concrete change, you MUST express it as one of these machine-readable blocks:\n  - \`\`\`python (for strategy code)\n  - \`\`\`json (for config patch)\n  - \`\`\`action (for running tools like backtest/diagnostic)\n- Avoid pseudo-code that cannot be applied.\n`;

      systemPrompt += `\n\nUser Choice UI:\n- If you ask the user to choose between options, format them like this so the UI can show buttons:\nCHOICES:\n1) <option one>\n2) <option two>\n3) <option three>\n- Keep each option on a single line.\n`;
      
      if (context) {
        if (context.fileName) {
          systemPrompt += `\n\nUser is working on file: ${context.fileName}`;
        }
        if (context.lineNumber) {
          systemPrompt += `\nCursor is at line: ${context.lineNumber}`;
        }
        if ((context as any).cursorFunctionName) {
          systemPrompt += `\nCursor is inside function: ${(context as any).cursorFunctionName}`;
        }
        if (context.selectedCode) {
          const selected = clampText(context.selectedCode, 6000);
          systemPrompt += `\n\nUser has selected this code (lines starting around ${context.lineNumber || 'unknown'}):\n\`\`\`\n${selected}\n\`\`\``;
        }
        if (context.fileContent) {
          const raw = String(context.fileContent);
          const safe =
            raw.length > 20000
              ? fileWindowByLine(raw, context.lineNumber, 160)
              : raw;
          systemPrompt += `\n\nFile content for reference:\n\`\`\`\n${clampText(safe, 22000)}\n\`\`\``;
        }
        if ((context as any).lastBacktest) {
          const lb = (context as any).lastBacktest as any;
          if (lb?.id || lb?.strategyName) {
            systemPrompt += `\n\nLATEST BACKTEST CONTEXT:\n- Backtest ID: ${lb?.id ?? "N/A"}\n- Strategy: ${lb?.strategyName ?? "N/A"}`;
          }
          if (lb?.config) {
            try {
              systemPrompt += `\n- Backtest Config (raw): ${JSON.stringify(lb.config)}`;
            } catch {
              systemPrompt += `\n- Backtest Config (raw): [unserializable]`;
            }
          }
        }
        if (context.backtestResults) {
          const br = context.backtestResults;
          systemPrompt += `\n\nLATEST BACKTEST METRICS:
- Total Profit: ${br.profit_total}%
- Win Rate: ${br.win_rate}%
- Max Drawdown: ${br.max_drawdown}%
- Total Trades: ${br.total_trades}
- Avg Profit/Trade: ${br.avg_profit || 'N/A'}%
- Sharpe Ratio: ${br.sharpe || 'N/A'}

Reason about these metrics. For example:
- High win rate but negative profit suggests losing expectancy (big losers).
- Very low trade count (< 20-30) suggests statistical insignificance.
- High drawdown (> 20%) with low profit suggests poor risk/reward.
- Perfect backtests on low trade counts often indicate overfitting.`;
        }

        if ((context as any).lastBacktest?.id) {
          const backtestId = Number((context as any).lastBacktest.id);
          if (Number.isFinite(backtestId)) {
            const backtest = await storage.getBacktest(backtestId);
            const trades = (backtest as any)?.results?.trades;
            const derived = computeDerivedTradeMetrics(Array.isArray(trades) ? trades : []);

            if (derived) {
              const expectancyText = derived.units === "ratio" ? fmtPct(derived.expectancy) : fmtMetric(derived.expectancy);
              const avgWinText = derived.units === "ratio" ? fmtPct(derived.avgWin) : fmtMetric(derived.avgWin);
              const avgLossText = derived.units === "ratio" ? fmtPct(derived.avgLoss) : fmtMetric(derived.avgLoss);

              systemPrompt += `\n\nDERIVED METRICS (computed from trade list):`;
              systemPrompt += `\n- Coverage: ${(derived.coverageRatio * 100).toFixed(0)}% of trades have usable profit data`;
              systemPrompt += `\n- Expectancy (avg profit/trade): ${expectancyText}`;
              systemPrompt += `\n- Avg Win: ${avgWinText}`;
              systemPrompt += `\n- Avg Loss: ${avgLossText}`;
              systemPrompt += `\n- Profit Factor: ${fmtMetric(derived.profitFactor, 2)}`;
              systemPrompt += `\n- Win/Loss Ratio: ${fmtMetric(derived.winLossRatio, 2)}`;
              systemPrompt += `\n- Avg Trade Duration: ${fmtMetric(derived.avgTradeDurationMin, 1)} minutes`;
              systemPrompt += `\n- Trades per Day: ${fmtMetric(derived.tradesPerDay, 2)}`;
              systemPrompt += `\n- Winners/Losers: ${derived.winners}/${derived.losers}`;

              if (derived.totalTrades < 30) {
                systemPrompt += `\nNOTE: Trade sample is small (<30). Avoid aggressive tuning and recommend longer timerange or more pairs.`;
              }
            } else {
              systemPrompt += `\n\nDERIVED METRICS: unavailable (no trade list in backtest results).`;
            }
          }
        }
      }

      systemPrompt += `\n\nWhen providing code suggestions, ALWAYS wrap them in markdown code blocks like: \`\`\`python\n# your code\n\`\`\`.
Use the "Apply" button feature to help the user.
If the user asks to "Explain this", "Optimize this", or "Why is this not working", focus your analysis on the provided selection or the full file context.`;

      const upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://replit.com',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 1024,
        }),
      });

      if (!upstreamRes.ok) {
        const errorText = await upstreamRes.text();
        const trimmed = clampText(errorText, 1500);
        console.error("OpenRouter error:", trimmed);
        return res.status(502).json({
          message: "Failed to get AI response",
          upstreamStatus: upstreamRes.status,
          details: trimmed,
        });
      }

      const data = await upstreamRes.json() as { choices: Array<{ message: { content: string } }> };
      const aiResponse = data.choices?.[0]?.message?.content || "No response generated";

      res.json({ response: aiResponse });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("AI chat error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/diagnostic/analyze", async (req, res) => {
    try {
      const input = z.object({
        backtestId: z.number(),
        strategyPath: z.string().optional(),
      }).parse(req.body);

      const jobId = uuidv4();
      await storage.createDiagnosticJob({
        id: jobId,
        backtestId: input.backtestId,
        strategyPath: input.strategyPath || null,
        status: "queued",
        progress: { percent: 0, currentPhase: "queued", phasesCompleted: [] },
      } as any);

      enqueueDiagnosticJob(jobId).catch(() => {});
      res.status(202).json({ jobId, status: "queued" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ error: error.message || "Failed to start diagnostics" });
    }
  });

  app.get("/api/diagnostic/jobs", async (req, res) => {
    const backtestIdRaw = req.query.backtestId ? Number(req.query.backtestId) : undefined;
    const jobs = await storage.getDiagnosticJobs(Number.isFinite(backtestIdRaw as any) ? backtestIdRaw : undefined);
    res.json(jobs);
  });

  app.get("/api/diagnostic/jobs/:jobId", async (req, res) => {
    const job = await storage.getDiagnosticJob(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  app.get("/api/diagnostic/jobs/:jobId/result", async (req, res) => {
    const job = await storage.getDiagnosticJob(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!job.reportId) return res.status(404).json({ error: "Report not ready" });
    const report = await storage.getDiagnosticReportByReportId(job.reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  });

  app.get("/api/diagnostic/reports", async (req, res) => {
    const reports = await storage.getDiagnosticReports();
    res.json(reports);
  });

  app.get("/api/diagnostic/reports/:backtestId", async (req, res) => {
    const reports = await storage.getDiagnosticReports(Number(req.params.backtestId));
    res.json(reports);
  });

  // === Diagnostic Loop Endpoints ===
  app.post(api.diagnosticLoop.start.path, async (req, res) => {
    try {
      const input = api.diagnosticLoop.start.input.parse(req.body);
      const { strategyPath } = input;

      if (!strategyPath.startsWith("user_data/strategies/")) {
        return res.status(400).json({ message: "strategyPath must be under user_data/strategies/" });
      }

      resolvePathWithinProject(strategyPath);

      const runId = uuidv4();
      const baseConfig = {
        ...(input.baseConfig && typeof input.baseConfig === "object" ? input.baseConfig : {}),
        ...(typeof input.timerange === "string" ? { timerange: input.timerange } : {}),
        ...(Array.isArray(input.pairs) ? { pairs: input.pairs } : {}),
        ...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}),
        ...(typeof input.drawdownCap === "number" ? { drawdownCap: input.drawdownCap } : {}),
      };

      await storage.createDiagnosticLoopRun({
        id: runId,
        strategyPath,
        baseConfig,
        status: "queued",
        progress: { percent: 0, iteration: 0, stage: "queued", timeframe: "", step: "queued" } as DiagnosticLoopProgress,
      } as any);

      enqueueDiagnosticLoopRun(runId).catch(() => {});
      res.status(202).json({ runId, status: "queued" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(api.diagnosticLoop.runs.path, async (req, res) => {
    const runs = await storage.getDiagnosticLoopRuns();
    res.json(runs);
  });

  app.get(api.diagnosticLoop.run.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getDiagnosticLoopRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    const iterations = await storage.getDiagnosticLoopIterations(runId);
    res.json({ ...run, iterations });
  });

  app.post(api.diagnosticLoop.stop.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getDiagnosticLoopRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });

    diagnosticLoopStopRequests.add(runId);

    if (run.status === "queued") {
      await storage.updateDiagnosticLoopRun(runId, {
        status: "stopped",
        stopReason: "stop_requested",
        finishedAt: new Date(),
        progress: { percent: 100, iteration: 0, stage: "stopped", timeframe: "", step: "stop_requested" } as DiagnosticLoopProgress,
      } as any);
    } else {
      await storage.updateDiagnosticLoopRun(runId, {
        progress: { ...(run.progress as any), step: "stop_requested" } as any,
      } as any);
    }

    res.json({ success: true });
  });

  app.get(api.diagnosticLoop.report.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getDiagnosticLoopRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    if (!run.report) return res.status(404).json({ message: "Report not ready" });
    res.json(run.report);
  });

  // === Chat Persistence ===
  app.get("/api/chat/sessions", async (req, res) => {
    const sessionKey = typeof req.query.sessionKey === "string" ? req.query.sessionKey : "";
    if (!sessionKey) return res.json([]);
    const session = await storage.getAiChatSessionByKey(sessionKey);
    res.json(session ? [session] : []);
  });

  app.post("/api/chat/sessions", async (req, res) => {
    try {
      const input = z.object({
        sessionKey: z.string(),
        strategyPath: z.string().optional(),
        backtestId: z.number().optional(),
      }).parse(req.body);
      const session = await storage.getOrCreateAiChatSession(
        input.sessionKey,
        input.strategyPath ?? null,
        input.backtestId ?? null,
      );
      res.status(201).json(session);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.get("/api/chat/sessions/:id/messages", async (req, res) => {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ message: "Invalid session id" });
    const sinceRaw = typeof req.query.since === "string" ? req.query.since : null;
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : null;
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const messages = await storage.getAiChatMessages(sessionId, Number.isFinite(since?.getTime()) ? since : null);
    if (Number.isFinite(limitRaw) && limitRaw && limitRaw > 0) {
      return res.json(messages.slice(-limitRaw));
    }
    res.json(messages);
  });

  app.post("/api/chat/sessions/:id/messages", async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      if (!Number.isFinite(sessionId)) return res.status(400).json({ message: "Invalid session id" });
      const input = z.object({
        role: z.string(),
        content: z.string(),
        model: z.string().optional(),
        request: z.any().optional(),
        response: z.any().optional(),
      }).parse(req.body);
      const message = await storage.createAiChatMessage({
        sessionId,
        role: input.role,
        content: input.content,
        model: input.model,
        request: input.request,
        response: input.response,
      } as any);
      res.status(201).json(message);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: "Failed to create message" });
    }
  });

  // === AI Actions ===
  app.get("/api/ai-actions", async (req, res) => {
    const sessionIdRaw = typeof req.query.sessionId === "string" ? Number(req.query.sessionId) : undefined;
    const backtestIdRaw = typeof req.query.backtestId === "string" ? Number(req.query.backtestId) : undefined;
    const sessionId = Number.isFinite(sessionIdRaw as any) ? sessionIdRaw : undefined;
    const backtestId = Number.isFinite(backtestIdRaw as any) ? backtestIdRaw : undefined;
    const actions = await storage.getAiActions(sessionId, backtestId);
    res.json(actions);
  });

  app.get("/api/ai-actions/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const action = await storage.getAiAction(id);
    if (!action) return res.status(404).json({ message: "Not found" });
    res.json(action);
  });

  app.get("/api/backtests/:id/ai-actions", async (req, res) => {
    const backtestId = Number(req.params.id);
    if (!Number.isFinite(backtestId)) return res.status(400).json({ message: "Invalid backtest id" });
    const actions = await storage.getAiActionsForBacktest(backtestId);
    res.json(actions);
  });

  app.post("/api/ai-actions", async (req, res) => {
    try {
      const input = z.object({
        sessionId: z.number().optional(),
        messageId: z.number().optional(),
        actionType: z.string(),
        description: z.string(),
        beforeState: z.any().optional(),
        afterState: z.any().optional(),
        diff: z.any().optional(),
        backtestId: z.number().optional(),
        diagnosticReportId: z.number().optional(),
        results: z.any().optional(),
      }).parse(req.body);
      const action = await storage.createAiAction({
        sessionId: input.sessionId ?? null,
        messageId: input.messageId ?? null,
        actionType: input.actionType,
        description: input.description,
        beforeState: input.beforeState,
        afterState: input.afterState,
        diff: input.diff,
        backtestId: input.backtestId ?? null,
        diagnosticReportId: input.diagnosticReportId ?? null,
        results: input.results,
      } as any);
      res.status(201).json(action);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: "Failed to create AI action" });
    }
  });

  // === Agent Handoff ===
  app.post("/api/agent-handoff", async (req, res) => {
    try {
      const input = z.object({
        runId: z.string(),
        agentId: z.string(),
        envelope: z.any(),
      }).parse(req.body);
      const handoff = await storage.createAgentHandoff({
        runId: input.runId,
        agentId: input.agentId,
        envelope: input.envelope,
      } as any);
      res.status(201).json(handoff);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      res.status(500).json({ message: "Failed to create handoff" });
    }
  });

  app.get("/api/agent-handoff/:runId", async (req, res) => {
    const runId = String(req.params.runId || "");
    const handoff = await storage.getAgentHandoffByRunId(runId);
    if (!handoff) return res.status(404).json({ message: "Not found" });
    res.json(handoff);
  });

  // === Config Endpoints ===
  app.get("/api/config/get", async (req, res) => {
    try {
      const configPath = path.join(process.cwd(), "user_data", "config.json");
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);
      res.json(config);
    } catch (error: any) {
      console.error("Error reading config:", error);
      res.status(500).json({ message: "Failed to read config file" });
    }
  });

  // === Config Update Endpoint ===
  app.post("/api/config/update", async (req, res) => {
    try {
      const input = z.object({
        strategy: z.string().optional(),
        timeframe: z.string().optional(),
        stake_amount: z.number().optional(),
        max_open_trades: z.number().int().min(0).optional(),
        tradable_balance_ratio: z.number().min(0).max(1).optional(),
        trailing_stop: z.boolean().optional(),
        trailing_stop_positive: z.number().optional(),
        trailing_stop_positive_offset: z.number().optional(),
        trailing_only_offset_is_reached: z.boolean().optional(),
        minimal_roi: z.record(z.string(), z.number()).optional(),
        stoploss: z.number().optional(),
        timerange: z.string().optional(),
        backtest_date_from: z.string().optional(),
        backtest_date_to: z.string().optional(),
        pairs: z.array(z.string()).optional(),
      }).parse(req.body);

      const configPath = path.join(process.cwd(), "user_data", "config.json");
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);

      // Update only the fields that were provided
      if (input.strategy) {
        config.strategy = input.strategy;
      }
      if (input.timeframe) {
        config.timeframe = input.timeframe;
      }
      if (input.stake_amount !== undefined) {
        config.dry_run_wallet = input.stake_amount;
        // Also update stake_amount if it's a number
        if (typeof config.stake_amount === "number" || config.stake_amount !== "unlimited") {
          config.stake_amount = input.stake_amount;
        }
      }
      if (input.max_open_trades !== undefined) {
        config.max_open_trades = input.max_open_trades;
      }
      if (input.tradable_balance_ratio !== undefined) {
        config.tradable_balance_ratio = input.tradable_balance_ratio;
      }
      if (input.trailing_stop !== undefined) {
        config.trailing_stop = input.trailing_stop;
      }
      if (input.trailing_stop_positive !== undefined) {
        config.trailing_stop_positive = input.trailing_stop_positive;
      }
      if (input.trailing_stop_positive_offset !== undefined) {
        config.trailing_stop_positive_offset = input.trailing_stop_positive_offset;
      }
      if (input.trailing_only_offset_is_reached !== undefined) {
        config.trailing_only_offset_is_reached = input.trailing_only_offset_is_reached;
      }
      if (input.minimal_roi !== undefined) {
        config.minimal_roi = input.minimal_roi;
      }
      if (input.stoploss !== undefined) {
        config.stoploss = input.stoploss;
      }
      if (input.timerange) {
        config.timerange = input.timerange;
      }
      if (input.backtest_date_from) {
        config.backtest_date_from = input.backtest_date_from;
      }
      if (input.backtest_date_to) {
        config.backtest_date_to = input.backtest_date_to;
      }
      if (input.pairs && input.pairs.length > 0) {
        config.exchange.pair_whitelist = input.pairs;
        if (config.pairlists && config.pairlists[0]) {
          config.pairlists[0].pair_whitelist = input.pairs;
        }
      }

      // Write back to file with proper formatting
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      
      // Sync the updated config back to the database
      await storage.syncWithFilesystem();
      
      res.json({ success: true, message: "Config updated successfully", config });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Config update error:", err);
      res.status(500).json({ message: "Failed to update config" });
    }
  });

  // === Download Data Endpoint ===
  app.get("/api/pairs/top-volume", async (req, res) => {
    try {
      const input = z
        .object({
          limit: z.string().optional(),
          quote: z.string().optional(),
        })
        .parse(req.query);

      const limit = clampNum(input.limit ? Number(input.limit) : 10, 1, 50);
      const quote = (typeof input.quote === "string" && input.quote.trim() ? input.quote.trim().toUpperCase() : "USDT");

      const now = Date.now();
      const cacheMs = 60_000;
      if (!cachedBinance24hTickers || now - cachedBinance24hTickersAt > cacheMs) {
        const upstream = await fetch("https://api.binance.com/api/v3/ticker/24hr", { method: "GET" });
        if (!upstream.ok) {
          throw new Error(`Binance ticker request failed (${upstream.status})`);
        }
        const json = await upstream.json();
        cachedBinance24hTickers = Array.isArray(json) ? json : [];
        cachedBinance24hTickersAt = now;
      }

      const stableBases = new Set([
        "USDT",
        "USDC",
        "BUSD",
        "TUSD",
        "FDUSD",
        "DAI",
        "EUR",
        "GBP",
        "TRY",
        "BRL",
        "RUB",
      ]);

      const badSuffixes = ["UP", "DOWN", "BULL", "BEAR", "3L", "3S", "5L", "5S"];

      const candidates = (cachedBinance24hTickers || [])
        .map((t: any) => {
          const symbol = String(t?.symbol || "").toUpperCase();
          const qv = Number(t?.quoteVolume);
          return { symbol, quoteVolume: Number.isFinite(qv) ? qv : 0 };
        })
        .filter((t: any) => t.symbol.endsWith(quote))
        .map((t: any) => {
          const base = t.symbol.slice(0, Math.max(0, t.symbol.length - quote.length));
          return { base, quote, symbol: t.symbol, quoteVolume: t.quoteVolume };
        })
        .filter((t: any) => t.base && !stableBases.has(t.base))
        .filter((t: any) => !badSuffixes.some((s) => t.base.endsWith(s)))
        .filter((t: any) => t.quoteVolume > 0);

      candidates.sort((a: any, b: any) => b.quoteVolume - a.quoteVolume);

      const top = candidates.slice(0, limit).map((t: any) => ({
        pair: `${t.base}/${t.quote}`,
        quoteVolume: t.quoteVolume,
        symbol: t.symbol,
      }));

      res.json({
        exchange: "binance",
        quote,
        limit,
        pairs: top.map((x: any) => x.pair),
        items: top,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message });
    }
  });

  app.post("/api/data/coverage", async (req, res) => {
    try {
      const input = z
        .object({
          pairs: z.array(z.string()).min(1),
          timeframes: z.array(z.string()).min(1),
          date_from: z.string().optional(),
          date_to: z.string().optional(),
          timerange: z.string().optional(),
        })
        .parse(req.body);

      const projectRoot = process.cwd();

      let exchangeName = "binance";
      try {
        const rawCfg = await fs.readFile(path.join(projectRoot, "user_data", "config.json"), "utf-8");
        const parsed = JSON.parse(rawCfg);
        const ex = parsed?.exchange?.name;
        if (typeof ex === "string" && ex.trim().length > 0) {
          exchangeName = ex.trim();
        }
      } catch {
        // ignore
      }

      const normalizePairToFilename = (pair: string) =>
        String(pair || "")
          .trim()
          .replace("/", "_")
          .replace(":", "_");

      const parseDateToMs = (s: string | undefined) => {
        if (!s) return null;
        const str = String(s).trim();
        if (!str) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          const d = new Date(`${str}T00:00:00Z`);
          return Number.isFinite(d.getTime()) ? d.getTime() : null;
        }
        if (/^\d{8}$/.test(str)) {
          const d = new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T00:00:00Z`);
          return Number.isFinite(d.getTime()) ? d.getTime() : null;
        }
        return null;
      };

      const timerange = typeof input.timerange === "string" && input.timerange.trim() ? input.timerange.trim() : "";
      const timerangeMatch = timerange.match(/^(\d{8})-(\d{8})$/);
      const requestedFromMs = timerangeMatch ? parseDateToMs(timerangeMatch[1]) : parseDateToMs(input.date_from);
      const requestedToMs = timerangeMatch ? parseDateToMs(timerangeMatch[2]) : parseDateToMs(input.date_to);

      const readCandleTsRange = async (filePath: string): Promise<{ firstMs: number; lastMs: number } | null> => {
        try {
          const st = await fs.stat(filePath);
          if (!Number.isFinite(st.size) || st.size <= 0) return null;

          const fh = await fs.open(filePath, "r");
          try {
            const headSize = Math.min(4096, st.size);
            const tailSize = Math.min(16384, st.size);

            const headBuf = Buffer.alloc(headSize);
            await fh.read(headBuf, 0, headSize, 0);
            const headTxt = headBuf.toString("utf-8");
            const headM = headTxt.match(/\[\s*\[\s*([0-9]{9,})\s*,/);
            const firstRaw = headM ? Number(headM[1]) : NaN;

            const tailBuf = Buffer.alloc(tailSize);
            await fh.read(tailBuf, 0, tailSize, Math.max(0, st.size - tailSize));
            const tailTxt = tailBuf.toString("utf-8");
            const re = /\[\s*([0-9]{9,})\s*,/g;
            let lastRaw = NaN;
            let mm: RegExpExecArray | null;
            while ((mm = re.exec(tailTxt)) !== null) {
              const n = Number(mm[1]);
              if (Number.isFinite(n)) lastRaw = n;
            }

            if (!Number.isFinite(firstRaw) || !Number.isFinite(lastRaw)) return null;

            const toMs = (v: number) => (v < 1e11 ? v * 1000 : v);
            return { firstMs: toMs(firstRaw), lastMs: toMs(lastRaw) };
          } finally {
            await fh.close();
          }
        } catch {
          return null;
        }
      };

      const dataDir = path.join(projectRoot, "user_data", "data", exchangeName);

      const items: Array<any> = [];

      for (const pair of input.pairs) {
        const base = normalizePairToFilename(pair);
        for (const tf of input.timeframes) {
          const timeframe = String(tf || "").trim();
          const jsonPath = path.join(dataDir, `${base}-${timeframe}.json`);
          const featherPath = path.join(dataDir, `${base}-${timeframe}.feather`);

          const existsJson = await fs.access(jsonPath).then(() => true).catch(() => false);
          const existsFeather = !existsJson ? await fs.access(featherPath).then(() => true).catch(() => false) : false;
          const exists = existsJson || existsFeather;

          let firstDate: string | null = null;
          let lastDate: string | null = null;
          let coversRequested: boolean | null = null;

          if (existsJson) {
            const range = await readCandleTsRange(jsonPath);
            if (range) {
              firstDate = new Date(range.firstMs).toISOString().slice(0, 10);
              lastDate = new Date(range.lastMs).toISOString().slice(0, 10);

              if (requestedFromMs != null || requestedToMs != null) {
                const okFrom = requestedFromMs == null ? true : range.firstMs <= requestedFromMs;
                const okTo = requestedToMs == null ? true : range.lastMs >= requestedToMs;
                coversRequested = okFrom && okTo;
              }
            }
          }

          items.push({
            pair: String(pair),
            timeframe,
            exists,
            file: existsJson ? path.relative(projectRoot, jsonPath) : existsFeather ? path.relative(projectRoot, featherPath) : null,
            firstDate,
            lastDate,
            coversRequested,
          });
        }
      }

      const summary: any = { byTimeframe: {} as Record<string, any> };
      for (const tf of input.timeframes) {
        const timeframe = String(tf || "").trim();
        const sub = items.filter((x) => String(x.timeframe) === timeframe);
        const exists = sub.filter((x) => Boolean(x.exists));
        const missing = sub.filter((x) => !x.exists);
        const partial = sub.filter((x) => x.exists && x.coversRequested === false);
        summary.byTimeframe[timeframe] = {
          totalPairs: sub.length,
          availablePairs: exists.length,
          missingPairs: missing.length,
          outOfRangePairs: partial.length,
        };
      }

      res.json({
        exchange: exchangeName,
        requested: {
          timerange: timerange || null,
          date_from: input.date_from ?? null,
          date_to: input.date_to ?? null,
        },
        items,
        summary,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message });
    }
  });

  app.post("/api/data/download", async (req, res) => {
    try {
      const input = z.object({
        pairs: z.array(z.string()).min(1),
        timeframes: z.array(z.string()).min(1),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      }).parse(req.body);

      const projectRoot = process.cwd();
      const venvBin = path.join(projectRoot, ".venv", "bin");
      const freqtradeBin = path.join(venvBin, "freqtrade");
      await fs.access(freqtradeBin);

      let exchangeName = "binance";
      try {
        const rawCfg = await fs.readFile(path.join(projectRoot, "user_data", "config.json"), "utf-8");
        const parsed = JSON.parse(rawCfg);
        const ex = parsed?.exchange?.name;
        if (typeof ex === "string" && ex.trim().length > 0) {
          exchangeName = ex.trim();
        }
      } catch {
        // ignore
      }

      const env = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectRoot, ".venv"),
        PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
      };

      const toTimerangePart = (value: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error("Invalid date format (expected YYYY-MM-DD)");
        }
        return value.replace(/-/g, "");
      };

      const timerange = (() => {
        if (!input.date_from && !input.date_to) return undefined;
        const from = input.date_from ? toTimerangePart(input.date_from) : "";
        const to = input.date_to ? toTimerangePart(input.date_to) : "";
        return `${from}-${to}`;
      })();

      const args = [
        "download-data",
        "--config",
        "user_data/config.json",
        "-p",
        ...input.pairs,
        "-t",
        ...input.timeframes,
      ];

      if (typeof input.date_from === "string" && input.date_from.trim()) {
        args.push("--prepend");
      }

      if (timerange) {
        args.push("--timerange", timerange);
      }

      const freqtradeBinRel = `./${path.relative(projectRoot, freqtradeBin)}`;
      const command = `${freqtradeBinRel} ${args.join(" ")}`;

      const proc = spawn(freqtradeBin, args, { cwd: projectRoot, env });
      let output = "";

      let settled = false;
      const finish = (status: number, body: any) => {
        if (settled) return;
        settled = true;
        res.status(status).json(body);
      };

      proc.stdout.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data) => {
        output += data.toString();
      });

      proc.on("error", (error) => {
        console.error("Download data spawn error:", error);
        finish(500, { message: "Failed to start download-data command" });
      });

      proc.on("close", async (code) => {
        let missing: Array<{ pair: string; timeframe: string }> = [];
        if (code === 0) {
          const dataDir = path.join(projectRoot, "user_data", "data", exchangeName);
          const pairs = Array.isArray(input.pairs) ? input.pairs : [];
          const timeframes = Array.isArray(input.timeframes) ? input.timeframes : [];

          const checks: Array<Promise<void>> = [];
          for (const pair of pairs) {
            const pairFileBase = String(pair).replace(/\//g, "_");
            for (const tf of timeframes) {
              const timeframe = String(tf);
              checks.push(
                (async () => {
                  const jsonPath = path.join(dataDir, `${pairFileBase}-${timeframe}.json`);
                  const featherPath = path.join(dataDir, `${pairFileBase}-${timeframe}.feather`);
                  try {
                    await fs.access(jsonPath);
                    return;
                  } catch {
                    // ignore
                  }
                  try {
                    await fs.access(featherPath);
                    return;
                  } catch {
                    // ignore
                  }
                  missing.push({ pair: String(pair), timeframe });
                })()
              );
            }
          }

          try {
            await Promise.all(checks);
          } catch {
            // ignore
          }
        }

        finish(200, {
          success: code === 0,
          code,
          command,
          output,
          exchange: exchangeName,
          missing,
        });
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ message });
    }
  });

  // === Terminal/Command Endpoint ===
  app.post("/api/cmd", async (req, res) => {
    try {
      const { command } = z.object({ command: z.string() }).parse(req.body);
      
      // Basic security check: prevent some dangerous commands
      const forbidden = ["rm -rf", "mkfs", "dd"];
      if (forbidden.some(f => command.includes(f))) {
        return res.status(400).json({ output: "Command forbidden for security reasons." });
      }

      const projectRoot = process.cwd();
      const venvBin = path.join(projectRoot, ".venv", "bin");
      const env = {
        ...process.env,
        VIRTUAL_ENV: path.join(projectRoot, ".venv"),
        PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
      };

      const proc = spawn(command, { shell: true, cwd: projectRoot, env });
      let output = "";
      
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        res.json({ output, code });
      });
    } catch (err) {
      res.status(400).json({ message: "Invalid command request" });
    }
  });

  return httpServer;
}

// Function to run real FreqTrade backtest
async function runActualBacktest(backtestId: number, config: any) {
  try {
    const projectRoot = process.cwd();
    const venvBin = path.join(projectRoot, ".venv", "bin");
    const freqtradeBin = path.join(venvBin, "freqtrade");

    const strategyPath = String(config.strategyName);
    const strategyDir = path.dirname(strategyPath);
    const strategyClass = path.basename(strategyPath).replace(/\.py$/i, "");
    const timeframe = config.config.timeframe;
    const timerange = typeof config?.config?.timerange === "string" ? String(config.config.timerange) : "";

    const runExportDir = path.join(
      projectRoot,
      "user_data",
      "backtest_results",
      "runs",
      String(backtestId)
    );
    await fs.mkdir(runExportDir, { recursive: true });

    const resultsDir = path.join(projectRoot, "user_data", "backtest_results");
    await fs.mkdir(resultsDir, { recursive: true });
    const resultsPath = path.join(resultsDir, `backtest-result-${backtestId}.json`);

    const baseConfigPath = path.join(projectRoot, "user_data", "config.json");
    let baseConfig: any = {};
    try {
      const raw = await fs.readFile(baseConfigPath, "utf-8");
      baseConfig = JSON.parse(raw);
    } catch {
      baseConfig = {};
    }

    const effectiveConfig = applyBacktestOverridesToConfig(baseConfig, config);
    const runConfigPath = path.join(runExportDir, "run-config.json");
    await fs.writeFile(runConfigPath, JSON.stringify(effectiveConfig, null, 2), "utf-8");
    const runConfigRel = path.relative(projectRoot, runConfigPath);

    try {
      const pairs = Array.isArray((effectiveConfig as any)?.exchange?.pair_whitelist)
        ? ((effectiveConfig as any).exchange.pair_whitelist as any[]).map((p) => String(p)).filter((p) => p.trim().length > 0)
        : [];
      if (pairs.length) {
        const head = pairs.slice(0, 12);
        const tail = pairs.length > head.length ? ` ... (+${pairs.length - head.length} more)` : "";
        await storage.appendBacktestLog(backtestId, `\nPairs selected: ${pairs.length}\n${head.join(", ")}${tail}\n`);
      }
    } catch {
      // best-effort
    }

    // Build the freqtrade backtest command
    const cmdParts = [
      freqtradeBin,
      "backtesting",
      "--strategy",
      strategyClass,
      "--strategy-path",
      strategyDir,
      "--timeframe",
      timeframe,
      "--config",
      runConfigRel,
      "--export",
      "trades",
      "--export-directory",
      runExportDir,
    ];

    if (timerange && timerange.trim()) {
      cmdParts.push("--timerange", timerange);
    }

    const freqtradeCmd = cmdParts.join(" ");

    await storage.appendBacktestLog(backtestId, `\n$ ${freqtradeCmd}\n`);

    // Execute via spawn with .venv environment
    const env = {
      ...process.env,
      VIRTUAL_ENV: path.join(projectRoot, ".venv"),
      PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
    };

    const proc = spawn(freqtradeCmd, { shell: true, cwd: projectRoot, env });

    proc.stdout.on("data", (data) => {
      const filtered = filterFreqtradeStdoutChunk(data.toString());
      if (filtered) {
        storage.appendBacktestLog(backtestId, filtered);
      }
    });

    proc.stderr.on("data", (data) => {
      const filtered = filterFreqtradeStderrChunk(data.toString());
      if (filtered) {
        storage.appendBacktestLog(backtestId, filtered);
      }
    });

    proc.on("close", async (code) => {
      if (code === 0) {
        await storage.appendBacktestLog(backtestId, "\n✓ Backtest command completed successfully. Parsing results...\n");

        try {
          const lastResultPath = path.join(runExportDir, ".last_result.json");
          const lastResultRaw = await fs.readFile(lastResultPath, "utf-8");
          const lastResult = JSON.parse(lastResultRaw) as { latest_backtest?: string };
          const zipName = lastResult.latest_backtest;
          if (!zipName) {
            throw new Error(`Missing latest_backtest in ${lastResultPath}`);
          }
          const zipPath = path.join(runExportDir, zipName);

          const pythonBin = path.join(venvBin, "python");
          await fs.access(pythonBin);

          const pyArgs = [
            "-c",
            [
              "import json,sys",
              "from pathlib import Path",
              "from freqtrade.data.btanalysis.bt_fileutils import load_backtest_stats",
              "data = load_backtest_stats(Path(sys.argv[1]))",
              "print(json.dumps(data, default=str))",
            ].join(";"),
            zipPath,
          ];

          const pyProc = spawn(pythonBin, pyArgs, { cwd: projectRoot, env });
          let pyOut = "";
          let pyErr = "";

          pyProc.stdout.on("data", (data) => {
            pyOut += data.toString();
          });
          pyProc.stderr.on("data", (data) => {
            pyErr += data.toString();
          });

          pyProc.on("close", async (pyCode) => {
            if (pyCode !== 0) {
              await storage.appendBacktestLog(backtestId, `\n✗ Failed to parse backtest results. Exit code ${pyCode}\n`);
              if (pyErr) await storage.appendBacktestLog(backtestId, `${pyErr}\n`);
              await storage.updateBacktestStatus(backtestId, "failed");
              return;
            }

            try {
              const raw = JSON.parse(pyOut) as any;

              try {
                const rawStatsPath = path.join(runExportDir, "raw-stats.json");
                await fs.writeFile(rawStatsPath, JSON.stringify(raw, null, 2), "utf-8");
                await storage.appendBacktestLog(
                  backtestId,
                  `\n✓ Raw stats saved to: ${path.relative(projectRoot, rawStatsPath)}\n`
                );
              } catch (e: any) {
                await storage.appendBacktestLog(
                  backtestId,
                  `\n⚠ Failed to write raw stats artifact: ${e?.message || e}\n`
                );
              }

              const strategyKeys = raw?.strategy ? Object.keys(raw.strategy) : [];
              const selectedKey = strategyKeys[0];
              const strat = selectedKey ? raw.strategy[selectedKey] : undefined;
              const tradesRaw = Array.isArray(strat?.trades)
                ? strat.trades
                : Array.isArray(raw?.trades)
                  ? raw.trades
                  : [];

              const trades = tradesRaw
                .map((t: any) => ({
                  pair: String(t?.pair ?? ""),
                  profit_ratio: Number(t?.profit_ratio ?? 0),
                  open_date: String(t?.open_date ?? ""),
                  close_date: String(t?.close_date ?? ""),
                  open_rate: t?.open_rate,
                  close_rate: t?.close_rate,
                  enter_tag: t?.enter_tag,
                  exit_reason: t?.exit_reason,
                  stake_amount: t?.stake_amount,
                  amount: t?.amount,
                  profit_abs: Number(t?.profit_abs ?? 0),
                }))
                .filter((t: any) => t.pair);

              const total_trades = trades.length;
              const winners = trades.filter((t: any) => Number.isFinite(t.profit_ratio) && t.profit_ratio > 0).length;
              const win_rate = total_trades > 0 ? winners / total_trades : 0;

              const stats = strat && typeof strat === "object" ? strat : {};

              const startBalanceRaw = Number(stats?.starting_balance ?? stats?.dry_run_wallet);
              const startBalance = Number.isFinite(startBalanceRaw) && startBalanceRaw > 0 ? startBalanceRaw : 0;

              // Freqtrade already provides per-trade profit_abs. Use it to build a simple equity curve.
              // This avoids incorrectly compounding profit_ratio against the entire wallet.
              let equity = startBalance;
              let peak = startBalance;

              const maxDrawdownRaw = Number(stats?.max_drawdown_account ?? stats?.max_drawdown);
              const max_drawdown = Number.isFinite(maxDrawdownRaw) ? maxDrawdownRaw : 0;

              const equityCurve: Array<{
                idx: number;
                pair: string;
                close_date: string;
                profit_ratio: number;
                profit_abs: number;
                equity_before: number;
                equity_after: number;
                peak: number;
                drawdown: number;
              }> = [];

              for (const tr of trades) {
                const r = Number.isFinite(tr.profit_ratio) ? tr.profit_ratio : 0;
                const profitAbs = Number.isFinite((tr as any).profit_abs) ? Number((tr as any).profit_abs) : 0;
                const equityBefore = equity;
                const equityAfter = equityBefore + profitAbs;

                (tr as any).equity_before = equityBefore;
                (tr as any).equity_after = equityAfter;

                equity = equityAfter;
                if (equity > peak) peak = equity;
                const dd = peak > 0 ? (peak - equity) / peak : 0;

                equityCurve.push({
                  idx: equityCurve.length,
                  pair: tr.pair,
                  close_date: String((tr as any).close_date ?? ""),
                  profit_ratio: r,
                  profit_abs: profitAbs,
                  equity_before: equityBefore,
                  equity_after: equityAfter,
                  peak,
                  drawdown: dd,
                });
              }

              try {
                const equityCurvePath = path.join(runExportDir, "equity-curve.json");
                await fs.writeFile(equityCurvePath, JSON.stringify(equityCurve, null, 2), "utf-8");
                await storage.appendBacktestLog(
                  backtestId,
                  `\n✓ Equity curve saved to: ${path.relative(projectRoot, equityCurvePath)}\n`
                );
              } catch (e: any) {
                await storage.appendBacktestLog(
                  backtestId,
                  `\n⚠ Failed to write equity curve artifact: ${e?.message || e}\n`
                );
              }

              const endBalanceRaw = Number(stats?.final_balance);
              const endBalance = Number.isFinite(endBalanceRaw) ? endBalanceRaw : equity;

              const profitAbsTotalRaw = Number(stats?.profit_total_abs);
              const profit_abs_total = Number.isFinite(profitAbsTotalRaw) ? profitAbsTotalRaw : (endBalance - startBalance);

              const profitTotalRaw = Number(stats?.profit_total);
              const profit_total = Number.isFinite(profitTotalRaw) ? profitTotalRaw : (startBalance > 0 ? profit_abs_total / startBalance : 0);

              const pairsRequested = Array.isArray((effectiveConfig as any)?.exchange?.pair_whitelist)
                ? ((effectiveConfig as any).exchange.pair_whitelist as any[]).map((p) => String(p)).filter((p) => p.trim().length > 0)
                : [];
              const pairsUsed = Array.isArray(stats?.pairlist)
                ? (stats.pairlist as any[]).map((p) => String(p)).filter((p) => p.trim().length > 0)
                : [];
              const excludedPairs = pairsRequested.length && pairsUsed.length
                ? pairsRequested.filter((p) => !pairsUsed.includes(p))
                : [];
              if (excludedPairs.length) {
                await storage.appendBacktestLog(backtestId, `\n⚠ Some selected pairs were not used (missing data or excluded): ${excludedPairs.join(", ")}\n`);
              }

              const results = {
                total_trades,
                win_rate,
                profit_total,
                profit_abs_total,
                max_drawdown,
                start_balance: startBalance,
                end_balance: endBalance,
                trades,
                pairs_requested: pairsRequested,
                pairs_used: pairsUsed,
                pairs_excluded: excludedPairs,
              };

              await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), "utf-8");
              await storage.appendBacktestLog(backtestId, `\n✓ Results saved to: ${path.relative(projectRoot, resultsPath)}\n`);
              await storage.updateBacktestStatus(backtestId, "completed", results);
            } catch (e: any) {
              await storage.appendBacktestLog(backtestId, `\n✗ Error parsing results: ${e?.message || e}\n`);
              await storage.updateBacktestStatus(backtestId, "failed");
            }
          });
        } catch (err) {
          await storage.appendBacktestLog(backtestId, `\n✗ Error: ${err}\n`);
          await storage.updateBacktestStatus(backtestId, "failed");
        }
      } else {
        await storage.appendBacktestLog(backtestId, `\n✗ Backtest failed with exit code ${code}\n`);
        await storage.updateBacktestStatus(backtestId, "failed");
      }
    });
  } catch (err: any) {
    await storage.appendBacktestLog(backtestId, `\n✗ Critical Error: ${err.message}\n`);
    await storage.updateBacktestStatus(backtestId, "failed");
  }
}

storage.syncWithFilesystem().catch(console.error);
storage.watchFilesystem();
