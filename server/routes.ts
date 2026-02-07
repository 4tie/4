import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import validationRouter from "./routes/validation";
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

type RefinementProgress = {
  percent: number;
  iteration: number;
  stage: string;
  step: string;
};

const diagnosticQueue: string[] = [];
let diagnosticWorkerRunning = false;

const diagnosticLoopQueue: string[] = [];
let diagnosticLoopWorkerRunning = false;
const diagnosticLoopStopRequests = new Set<string>();

const refinementQueue: string[] = [];
let refinementWorkerRunning = false;
const refinementStopRequests = new Set<string>();

let cachedBinance24hTickers: any[] | null = null;
let cachedBinance24hTickersAt = 0;

const logOnceKeys = new Set<string>();
function logOnce(key: string, message: string, err: unknown) {
  const k = String(key || "").trim();
  if (k && logOnceKeys.has(k)) return;
  if (k) logOnceKeys.add(k);
  console.error(message, err);
}

async function enqueueDiagnosticJob(jobId: string) {
  diagnosticQueue.push(jobId);
  if (!diagnosticWorkerRunning) {
    processDiagnosticQueue().catch((err) => {
      console.error("Diagnostic queue error:", err);
    });
  }
}

async function enqueueRefinementRun(runId: string) {
  refinementQueue.push(runId);
  if (!refinementWorkerRunning) {
    processRefinementQueue().catch((err) => {
      console.error("Refinement queue error:", err);
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

function toPctMaybe(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) <= 1.2) return n * 100;
  return n;
}

function toRatioMaybe(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > 1.2) return n / 100;
  return n;
}

function parseJsonBlock(text: string, blockLang: "json" | "action"): any | null {
  const src = String(text || "");
  const re = new RegExp("```" + blockLang + "\\s*([\\s\\S]*?)```", "m");
  const m = src.match(re);
  if (!m || !m[1]) return null;
  const raw = String(m[1]).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseLooseJson(text: string): any | null {
  const src = String(text || "").trim();
  if (!src) return null;
  const firstBrace = src.indexOf("{");
  const lastBrace = src.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = src.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }
  try {
    return JSON.parse(src);
  } catch {
    return null;
  }
}

function parseRefinementProposal(text: string): any | null {
  return parseJsonBlock(text, "json") ?? parseLooseJson(text);
}

function mergeConfigPatch(base: any, patch: any): any {
  const next = base && typeof base === "object" ? JSON.parse(JSON.stringify(base)) : {};
  if (!patch || typeof patch !== "object") return next;
  for (const [k, v] of Object.entries(patch)) {
    (next as any)[k] = v;
  }
  return next;
}

async function readUserConfig(): Promise<any> {
  const cfgPath = path.join(process.cwd(), "user_data", "config.json");
  try {
    const raw = await fs.readFile(cfgPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read user config:", err);
    throw new Error("Failed to read user_data/config.json");
  }
}

async function writeUserConfig(nextConfig: any): Promise<void> {
  const cfgPath = path.join(process.cwd(), "user_data", "config.json");
  try {
    await fs.writeFile(cfgPath, JSON.stringify(nextConfig, null, 2), "utf-8");
    await storage.syncWithFilesystem();
  } catch (err) {
    console.error("Failed to write user config:", err);
    throw new Error("Failed to write user_data/config.json");
  }
}

function applyConfigUpdatePatchToConfig(config: any, input: any): any {
  const next = config && typeof config === "object" ? JSON.parse(JSON.stringify(config)) : {};
  if (!input || typeof input !== "object") return next;

  if (typeof input.strategy === "string") {
    (next as any).strategy = input.strategy;
  }
  if (typeof input.timeframe === "string") {
    (next as any).timeframe = input.timeframe;
  }
  if (input.stake_amount !== undefined) {
    (next as any).dry_run_wallet = input.stake_amount;
    if (typeof (next as any).stake_amount === "number" || (next as any).stake_amount !== "unlimited") {
      (next as any).stake_amount = input.stake_amount;
    }
  }
  if (input.max_open_trades !== undefined) {
    (next as any).max_open_trades = input.max_open_trades;
  }
  if (input.tradable_balance_ratio !== undefined) {
    (next as any).tradable_balance_ratio = input.tradable_balance_ratio;
  }
  if (input.trailing_stop !== undefined) {
    (next as any).trailing_stop = input.trailing_stop;
  }
  if (input.trailing_stop_positive !== undefined) {
    (next as any).trailing_stop_positive = input.trailing_stop_positive;
  }
  if (input.trailing_stop_positive_offset !== undefined) {
    (next as any).trailing_stop_positive_offset = input.trailing_stop_positive_offset;
  }
  if (input.trailing_only_offset_is_reached !== undefined) {
    (next as any).trailing_only_offset_is_reached = input.trailing_only_offset_is_reached;
  }
  if (input.minimal_roi !== undefined) {
    (next as any).minimal_roi = input.minimal_roi;
  }
  if (input.stoploss !== undefined) {
    (next as any).stoploss = input.stoploss;
  }
  if (typeof input.timerange === "string") {
    (next as any).timerange = input.timerange;
  }
  if (typeof input.backtest_date_from === "string") {
    (next as any).backtest_date_from = input.backtest_date_from;
  }
  if (typeof input.backtest_date_to === "string") {
    (next as any).backtest_date_to = input.backtest_date_to;
  }
  if (Array.isArray(input.pairs) && input.pairs.length > 0) {
    (next as any).exchange = (next as any).exchange && typeof (next as any).exchange === "object" ? (next as any).exchange : {};
    (next as any).exchange.pair_whitelist = input.pairs;
    if (Array.isArray((next as any).pairlists) && (next as any).pairlists[0]) {
      (next as any).pairlists[0].pair_whitelist = input.pairs;
    }
  }
  if (input.protections !== undefined) {
    (next as any).protections = input.protections;
  }

  return next;
}

async function applyValidatedStrategyEdits(strategyPath: string, edits: any[], dryRun: boolean): Promise<any> {
  const projectRoot = process.cwd();
  const absStrategy = resolvePathWithinProject(strategyPath);
  const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "edit_tools.py");
  const res = await runPythonTool(scriptPath, ["apply", absStrategy], { edits, dryRun: Boolean(dryRun) });
  if (res.code !== 0) {
    throw new Error(res.err || res.out || "Rejected change(s)");
  }
  const parsed = JSON.parse(res.out);
  if (!dryRun) {
    try {
      await storage.syncWithFilesystem();
    } catch (err) {
      console.error("Failed to sync filesystem after applying strategy edits:", err);
    }
  }
  return parsed;
}

function calcTimerangeDays(timerange: unknown): number {
  const s = String(timerange || "");
  const m = s.match(/^(\d{8})-(\d{8})$/);
  if (!m) return 0;
  const parse = (p: string) => {
    const y = Number(p.slice(0, 4));
    const mo = Number(p.slice(4, 6));
    const d = Number(p.slice(6, 8));
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isFinite(dt.getTime()) ? dt : null;
  };
  const a = parse(m[1]);
  const b = parse(m[2]);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (24 * 3600 * 1000);
}

function summarizeBacktestResults(bt: any): { profitTotalPct: number; maxDrawdownPct: number; totalTrades: number; profitAbsTotal: number } {
  const r = (bt as any)?.results;
  const profit_total = r ? (r as any).profit_total : 0;
  const max_drawdown = r ? (r as any).max_drawdown : 0;
  const total_trades = r ? Number((r as any).total_trades ?? 0) : 0;
  const profit_abs_total = r ? Number((r as any).profit_abs_total ?? 0) : 0;
  return {
    profitTotalPct: toPctMaybe(profit_total),
    maxDrawdownPct: toPctMaybe(max_drawdown),
    totalTrades: Number.isFinite(total_trades) ? total_trades : 0,
    profitAbsTotal: Number.isFinite(profit_abs_total) ? profit_abs_total : 0,
  };
}

function suiteAggregates(suite: Array<{ bt: any; timerange?: string }>): {
  medianProfitPct: number;
  worstProfitPct: number;
  worstDrawdownPct: number;
  avgTradesPerDay: number;
  worstTradesPerDay: number;
  profitAbsPerDay: number;
} {
  const profits = suite.map(({ bt }) => summarizeBacktestResults(bt).profitTotalPct).filter((x) => Number.isFinite(x));
  const dds = suite.map(({ bt }) => summarizeBacktestResults(bt).maxDrawdownPct).filter((x) => Number.isFinite(x));

  const tradesPerDay = suite
    .map(({ bt, timerange }) => {
      const s = summarizeBacktestResults(bt);
      const days = calcTimerangeDays(timerange ?? (bt as any)?.config?.timerange ?? (bt as any)?.config?.config?.timerange);
      if (!Number.isFinite(days) || days <= 0) return null;
      return s.totalTrades / days;
    })
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));

  const absPerDay = suite
    .map(({ bt, timerange }) => {
      const s = summarizeBacktestResults(bt);
      const days = calcTimerangeDays(timerange ?? (bt as any)?.config?.timerange ?? (bt as any)?.config?.config?.timerange);
      if (!Number.isFinite(days) || days <= 0) return null;
      return s.profitAbsTotal / days;
    })
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));

  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  };

  const min = (arr: number[]) => (arr.length ? Math.min(...arr) : 0);
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

  return {
    medianProfitPct: median(profits),
    worstProfitPct: min(profits),
    worstDrawdownPct: max(dds),
    avgTradesPerDay: avg(tradesPerDay),
    worstTradesPerDay: min(tradesPerDay),
    profitAbsPerDay: avg(absPerDay),
  };
}

async function callOpenRouterChat(
  input: { model: string; system: string; user: string; maxTokens?: number; strictModel?: boolean },
  retries = 2,
): Promise<string | null> {
  const apiKey = getOpenRouterApiKey();
  const baseUrl = getOpenRouterBaseUrl();
  if (!apiKey) {
    throw new Error("OpenRouter API key is missing (set OPENROUTER_API_KEY or AI_INTEGRATIONS_OPENROUTER_API_KEY)");
  }

  // Fallback models in order of preference
  const fallbackModels = input.strictModel
    ? [input.model]
    : [
        input.model,
        "google/gemini-2.0-flash-exp:free",
        "google/gemini-2.0-pro-exp-02-05:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "qwen/qwen-2.5-72b-instruct:free",
        "deepseek/deepseek-chat:free",
      ];

  let lastError: Error | null = null;

  for (const model of fallbackModels) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://replit.com",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
            max_tokens: typeof input.maxTokens === "number" ? input.maxTokens : 900,
          }),
        });
      } catch (e: any) {
        const msg = e?.name === "AbortError" ? "OpenRouter request timed out" : (e?.message || String(e));
        lastError = new Error(msg);
        clearTimeout(timeout);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      } finally {
        clearTimeout(timeout);
      }

      if (!upstreamRes.ok) {
        const body = await upstreamRes.text().catch(() => "");
        lastError = new Error(
          `OpenRouter request failed for model '${model}' (${upstreamRes.status}): ${body || upstreamRes.statusText}`,
        );
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }

      const data = (await upstreamRes.json()) as any;
      const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
      if (!content) {
        lastError = new Error("Empty response from model");
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }
      return content;
    }
  }

  throw lastError || new Error("All models failed to return a response");
}

let cachedFeeConfig: { maker: number | null; taker: number | null; at: number } = { maker: null, taker: null, at: 0 };

async function getExchangeFeesFromConfig(): Promise<{ maker: number | null; taker: number | null }> {
  const now = Date.now();
  if (now - cachedFeeConfig.at < 30_000) return { maker: cachedFeeConfig.maker, taker: cachedFeeConfig.taker };
  try {
    const cfgPath = path.join(process.cwd(), "user_data", "config.json");
    const raw = await fs.readFile(cfgPath, "utf-8");
    const parsed = JSON.parse(raw);
    const makerRaw = parsed?.exchange?.fees?.maker;
    const takerRaw = parsed?.exchange?.fees?.taker;
    const maker = typeof makerRaw === "number" ? makerRaw : typeof makerRaw === "string" ? Number(makerRaw) : NaN;
    const taker = typeof takerRaw === "number" ? takerRaw : typeof takerRaw === "string" ? Number(takerRaw) : NaN;
    cachedFeeConfig = {
      maker: Number.isFinite(maker) ? maker : null,
      taker: Number.isFinite(taker) ? taker : null,
      at: now,
    };
    return { maker: cachedFeeConfig.maker, taker: cachedFeeConfig.taker };
  } catch {
    cachedFeeConfig = { maker: null, taker: null, at: now };
    return { maker: null, taker: null };
  }
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

  let pythonCmd = pythonBin;
  try {
    await fs.access(pythonBin);
  } catch {
    pythonCmd = "python3";
  }

  const proc = spawn(pythonCmd, [scriptPath, ...args], { cwd: projectRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.stderr.on("data", (d) => (err += d.toString()));
  if (stdinObj !== undefined) {
    proc.stdin.write(JSON.stringify(stdinObj));
  }
  proc.stdin.end();

  const code = await new Promise<number>((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
      err += "\nPython tool timed out.";
      resolve(124);
    }, 30_000);

    proc.on("error", (e) => {
      clearTimeout(killTimer);
      err += `\n${(e as any)?.message || String(e)}`;
      resolve(1);
    });

    proc.on("close", (c) => {
      clearTimeout(killTimer);
      resolve(typeof c === "number" ? c : 1);
    });
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
    try {
      await storage.syncWithFilesystem();
    } catch (err) {
      console.error("Failed to sync filesystem after restoring snapshot:", err);
    }
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
    } catch (e) {
      console.error("Failed to write backtest snapshot:", { backtestId: backtest.id }, e);
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
    } catch (e) {
      logOnce(`backtest:${backtestId}:summary`, "Failed to read/parse backtest summary JSON; falling back to parser", e);
      btData = parser.parse(String(backtestId));
    }
    if (!btData) {
      throw new Error("Backtest results not found");
    }

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

      try {
        await storage.syncWithFilesystem();
      } catch (err) {
        console.error("Failed to sync filesystem after applying changes:", err);
      }
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

async function runRefinementRun(runId: string) {
  const run = await storage.getAiRefinementRun(runId);
  if (!run) return;

  const existingIterations = await storage.getAiRefinementIterations(runId);
  const lastCompletedIteration = existingIterations
    .filter((it: any) => String(it?.stage || "") === "completed")
    .reduce((max: number, it: any) => Math.max(max, Number(it?.iteration || 0)), 0);

  const pendingIterationByNumber = new Map<number, any>();
  for (const it of existingIterations) {
    const n = Number((it as any)?.iteration);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (String((it as any)?.stage || "") === "completed") continue;
    const prev = pendingIterationByNumber.get(n);
    if (!prev || Number((it as any)?.id) > Number((prev as any)?.id)) pendingIterationByNumber.set(n, it);
  }

  let runState: any = (run as any).report && typeof (run as any).report === "object" ? (run as any).report : {};

  if (refinementStopRequests.has(runId)) {
    refinementStopRequests.delete(runId);
    await storage.updateAiRefinementRun(runId, { status: "stopped", stopReason: "stop_requested", finishedAt: new Date() } as any);
    return;
  }

  const projectRoot = process.cwd();
  const strategyPath = String((run as any).strategyPath || "");
  const baseConfig = (run as any).baseConfig && typeof (run as any).baseConfig === "object" ? (run as any).baseConfig : {};
  const rolling = (run as any).rolling && typeof (run as any).rolling === "object" ? (run as any).rolling : { windowDays: 30, stepDays: 30, count: 4 };
  const maxIterations = clampNum((baseConfig as any)?.maxIterations ?? 6, 1, 8);
  const model = String((run as any)?.model || (baseConfig as any)?.model || "meta-llama/llama-3-8b-instruct:free");

  const configPatchAtStart = (baseConfig as any)?.configPatch;
  let configOverrides = (baseConfig as any)?.config && typeof (baseConfig as any).config === "object" ? (baseConfig as any).config : {};

  await storage.updateAiRefinementRun(runId, {
    status: "running",
    startedAt: (run as any).startedAt ?? new Date(),
    progress: { percent: 0, iteration: lastCompletedIteration, stage: "start", step: "start" } as RefinementProgress,
    model,
  } as any);

  const readStrategy = async () => {
    const abs = resolvePathWithinProject(strategyPath);
    return await fs.readFile(abs, "utf-8");
  };

  const versionsDir = path.join(projectRoot, "user_data", "strategies", "versions");
  await fs.mkdir(versionsDir, { recursive: true });
  const strategyBaseName = path.basename(strategyPath);

  const snapshotStrategyPath = async (tag: string) => {
    const content = await readStrategy();
    const p = path.join(versionsDir, `${strategyBaseName}.${runId}.${tag}.py`);
    await fs.writeFile(p, content, "utf-8");
    return p;
  };

  const snapshotConfigPath = async (tag: string) => {
    const cfg = await readUserConfig();
    const p = path.join(versionsDir, `config.json.${runId}.${tag}.json`);
    await fs.writeFile(p, JSON.stringify(cfg, null, 2), "utf-8");
    return p;
  };

  const restoreConfigSnapshot = async (p: string) => {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    await writeUserConfig(parsed);
  };

  const restoreStrategySnapshot = async (p: string) => {
    const abs = resolvePathWithinProject(strategyPath);
    const content = await fs.readFile(p, "utf-8");
    await fs.writeFile(abs, content, "utf-8");
    try {
      await storage.syncWithFilesystem();
    } catch (err) {
      console.error("Failed to sync filesystem after restoring snapshot:", err);
    }
  };

  const runSuite = async (suiteTag: string) => {
    const cfg = await readUserConfig();
    const effectiveCfg = mergeConfigPatch(cfg, configPatchAtStart);
    const baseConfigForBacktest = {
      ...(typeof (effectiveCfg as any)?.timeframe === "string" ? { timeframe: (effectiveCfg as any).timeframe } : {}),
      ...(typeof (effectiveCfg as any)?.dry_run_wallet === "number" ? { stake_amount: (effectiveCfg as any).dry_run_wallet } : {}),
      ...(configOverrides && typeof configOverrides === "object" ? configOverrides : {}),
    };

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

    const windowDays = Number(rolling.windowDays);
    const stepDays = Number(rolling.stepDays ?? rolling.windowDays);
    const count = Number(rolling.count ?? 4);
    const end = typeof rolling.end === "string" ? parseIsoDate(String(rolling.end)) : null;
    const endDate = end ?? new Date();

    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      throw new Error("rolling.windowDays must be > 0");
    }
    if (!Number.isFinite(stepDays) || stepDays <= 0) {
      throw new Error("rolling.stepDays must be > 0");
    }
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error("rolling.count must be > 0");
    }

    const ranges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < count; i++) {
      const endDt = new Date(endDate.getTime());
      endDt.setUTCDate(endDt.getUTCDate() - i * stepDays);
      const startDt = new Date(endDt.getTime());
      startDt.setUTCDate(startDt.getUTCDate() - windowDays);
      ranges.push({ from: toIsoDate(startDt), to: toIsoDate(endDt) });
    }
    ranges.reverse();

    const backtests: any[] = [];
    const batchId = `${runId}:${suiteTag}`;
    for (let idx = 0; idx < ranges.length; idx++) {
      const r = ranges[idx];
      const timerange = buildTimerange(r.from, r.to);
      const runInput = {
        strategyName: strategyPath,
        config: {
          ...(baseConfigForBacktest || {}),
          backtest_date_from: r.from,
          backtest_date_to: r.to,
          timerange,
          batchId,
          batchIndex: idx,
          batchRange: `${r.from}→${r.to}`,
        },
      };

      const backtest = await storage.createBacktest(runInput as any);
      backtests.push({ ...backtest, config: runInput.config });

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
    }

    const waitOne = async (id: number, timeoutMs: number) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const bt = await storage.getBacktest(id);
        if (bt?.status === "completed" || bt?.status === "failed") return bt;
        if (refinementStopRequests.has(runId)) return bt;
        await sleep(1000);
      }
      return await storage.getBacktest(id);
    };

    const done: Array<{ id: number; bt: any; timerange?: string }> = [];
    for (const bt of backtests) {
      const id = Number(bt?.id);
      if (!Number.isFinite(id)) continue;
      const final = await waitOne(id, 60 * 60 * 1000);
      done.push({ id, bt: final, timerange: String((bt as any)?.config?.timerange ?? "") });
    }

    const completed = done.filter((x) => String((x.bt as any)?.status) === "completed");
    const failed = done.filter((x) => String((x.bt as any)?.status) === "failed");
    return {
      suiteTag,
      backtestIds: done.map((x) => x.id),
      completedIds: completed.map((x) => x.id),
      failedIds: failed.map((x) => x.id),
      done,
      aggregates: suiteAggregates(completed.map((x) => ({ bt: x.bt, timerange: x.timerange }))),
    };
  };

  let baselineStrategySnap =
    runState?.baselineSnapshots && typeof runState.baselineSnapshots === "object" ? String(runState.baselineSnapshots.strategy || "") : "";
  let baselineConfigSnap =
    runState?.baselineSnapshots && typeof runState.baselineSnapshots === "object" ? String(runState.baselineSnapshots.config || "") : "";

  let bestStrategySnap =
    runState?.bestSnapshots && typeof runState.bestSnapshots === "object" ? String(runState.bestSnapshots.strategy || "") : "";
  let bestConfigSnap =
    runState?.bestSnapshots && typeof runState.bestSnapshots === "object" ? String(runState.bestSnapshots.config || "") : "";

  let objectiveMode: "profit" | "drawdown" | "balanced" =
    runState?.objectiveMode === "profit" || runState?.objectiveMode === "drawdown" || runState?.objectiveMode === "balanced"
      ? runState.objectiveMode
      : "balanced";
  let bestAgg: any = runState?.bestMetrics && typeof runState.bestMetrics === "object" ? runState.bestMetrics : null;
  let bestIteration = Number.isFinite(Number(runState?.bestIteration)) ? Number(runState.bestIteration) : 0;

  const thresholds = {
    maxDrawdownPct: 15,
    profitPoorPct: 1,
    goalProfitPct: 1.5,
    minTradesPerDay: 1.5,
    lowTradesPerDayPriority: 1,
  };

  const stopLimits = {
    maxConsecutiveNoKeep: 4,
    maxConsecutiveAiInvalid: 2,
  };

  const stopIfRequested = async (stage: string) => {
    if (!refinementStopRequests.has(runId)) return false;
    refinementStopRequests.delete(runId);
    await storage.updateAiRefinementRun(runId, {
      status: "stopped",
      stopReason: "stop_requested",
      finishedAt: new Date(),
      progress: { percent: 100, iteration: bestIteration, stage: "stopped", step: stage } as any,
    } as any);
    return true;
  };

  try {
    try {
      if (!runState?.configOverridesApplied && configOverrides && typeof configOverrides === "object" && Object.keys(configOverrides).length > 0) {
        const currentCfg = await readUserConfig();
        const nextCfg = applyConfigUpdatePatchToConfig(currentCfg, configOverrides);
        await writeUserConfig(nextCfg);
        configOverrides = {};
        runState = { ...(runState || {}), configOverridesApplied: true };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
      }
    } catch (e) {
      console.error("Failed to apply refinement config overrides:", { runId }, e);
      throw e;
    }

    const ensureSnapshotPaths = async () => {
      const usable = async (p: string) => {
        if (!p) return false;
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      };

      if (!(await usable(baselineStrategySnap))) baselineStrategySnap = "";
      if (!(await usable(baselineConfigSnap))) baselineConfigSnap = "";

      if (!baselineStrategySnap) baselineStrategySnap = await snapshotStrategyPath("baseline");
      if (!baselineConfigSnap) baselineConfigSnap = await snapshotConfigPath("baseline");

      runState = {
        ...(runState || {}),
        baselineSnapshots: { strategy: baselineStrategySnap, config: baselineConfigSnap },
      };

      if (!(await usable(bestStrategySnap))) bestStrategySnap = "";
      if (!(await usable(bestConfigSnap))) bestConfigSnap = "";
      if (!bestStrategySnap) bestStrategySnap = baselineStrategySnap;
      if (!bestConfigSnap) bestConfigSnap = baselineConfigSnap;

      runState = {
        ...(runState || {}),
        bestSnapshots: { strategy: bestStrategySnap, config: bestConfigSnap },
      };

      await storage.updateAiRefinementRun(runId, { report: runState } as any);
    };

    await ensureSnapshotPaths();

    const needBaselineMetrics = !(runState?.baselineMetrics && typeof runState.baselineMetrics === "object");
    if (needBaselineMetrics) {
      await restoreStrategySnapshot(baselineStrategySnap);
      await restoreConfigSnapshot(baselineConfigSnap);
    }

    await storage.updateAiRefinementRun(runId, { progress: { percent: 2, iteration: 0, stage: "baseline", step: "suite" } as RefinementProgress } as any);
    const baselineSuite = needBaselineMetrics ? await runSuite("baseline") : { aggregates: runState.baselineMetrics };

    runState = { ...(runState || {}), baselineMetrics: (baselineSuite as any).aggregates };

    if (!bestAgg) bestAgg = (runState.bestMetrics && typeof runState.bestMetrics === "object") ? runState.bestMetrics : (baselineSuite as any).aggregates;
    if (!Number.isFinite(bestIteration)) bestIteration = Number.isFinite(Number(runState?.bestIteration)) ? Number(runState.bestIteration) : 0;

    const baselineProfit = baselineSuite.aggregates.medianProfitPct;
    const baselineDd = baselineSuite.aggregates.worstDrawdownPct;
    if (baselineDd >= thresholds.maxDrawdownPct) objectiveMode = "drawdown";
    else if (baselineProfit <= thresholds.profitPoorPct) objectiveMode = "profit";
    else objectiveMode = "balanced";
    runState = {
      ...(runState || {}),
      objectiveMode,
      thresholds,
      maxIterations,
      model,
      rolling,
      bestIteration,
      bestMetrics: bestAgg,
      bestSnapshots: { strategy: bestStrategySnap, config: bestConfigSnap },
    };
    await storage.updateAiRefinementRun(runId, { objectiveMode, report: runState, progress: { percent: 5, iteration: 0, stage: "baseline", step: "done" } as any } as any);

    await restoreStrategySnapshot(bestStrategySnap || baselineStrategySnap);
    await restoreConfigSnapshot(bestConfigSnap || baselineConfigSnap);

    let completedStopReason: string | null = null;
    let consecutiveNoKeep = Number.isFinite(Number(runState?.consecutiveNoKeep)) ? Number(runState.consecutiveNoKeep) : 0;
    let consecutiveAiInvalid = Number.isFinite(Number(runState?.consecutiveAiInvalid)) ? Number(runState.consecutiveAiInvalid) : 0;

    const startIteration = Math.max(1, lastCompletedIteration + 1);
    for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
      if (await stopIfRequested("iteration_start")) return;

      const existingIt = pendingIterationByNumber.get(iteration);
      const it = existingIt
        ? await storage.updateAiRefinementIteration((existingIt as any).id, {
            stage: "propose",
            decision: null,
            proposed: null,
            validation: null,
            applied: null,
            suite: null,
            metrics: null,
            failure: null,
          } as any)
        : await storage.createAiRefinementIteration({
            runId,
            iteration,
            stage: "propose",
          } as any);
      pendingIterationByNumber.delete(iteration);

      const progress: RefinementProgress = {
        percent: Math.min(95, 5 + Math.floor((iteration / Math.max(1, maxIterations)) * 90)),
        iteration,
        stage: "running",
        step: "propose",
      };
      await storage.updateAiRefinementRun(runId, { progress } as any);

      const strategyContent = await readStrategy();
      const sys =
        "You are optimizing a Freqtrade strategy with strict constraints. " +
        "You must propose EXACTLY ONE experiment per iteration. " +
        "Your entire response MUST be exactly ONE ```json code block and nothing else. " +
        "Allowed outputs are ONLY: {type:'strategy_edit', edits:[...]} OR {type:'config_patch', patch:{...}}. " +
        "Never include both edits and patch. " +
        "If you cannot comply, return a minimal valid config_patch. " +
        "For config_patch, only use allowedConfigKeys and keep it small (typically 1-3 keys; if trailing_stop then include its related keys).";

      const allowedConfigKeys = [
        "timeframe",
        "max_open_trades",
        "tradable_balance_ratio",
        "stoploss",
        "trailing_stop",
        "trailing_stop_positive",
        "trailing_stop_positive_offset",
        "trailing_only_offset_is_reached",
        "minimal_roi",
        "protections",
      ];

      const recentIterations = (await storage.getAiRefinementIterations(runId))
        .filter((x: any) => String(x?.stage || "") === "completed")
        .slice(-3)
        .map((x: any) => ({
          iteration: x.iteration,
          decision: x.decision,
          metrics: x.metrics,
          failure: x.failure,
        }));

      const user = JSON.stringify(
        {
          task: "Propose exactly one improvement experiment.",
          constraints: {
            one_change_only: true,
            objectiveMode,
            thresholds,
            must_keep_drawdown_under_pct: thresholds.maxDrawdownPct,
            min_trades_per_day: thresholds.minTradesPerDay,
            trades_priority_if_below: thresholds.lowTradesPerDayPriority,
            do_not_invent_missing_context: true,
          },
          baselineMetrics: runState?.baselineMetrics ?? null,
          bestSoFarMetrics: bestAgg,
          recentIterations,
          strategyPath,
          strategyContent: strategyContent.slice(0, 22000),
          allowedConfigKeys,
          response_schema: {
            type: "strategy_edit|config_patch",
            edits: "only if type=strategy_edit",
            patch: "only if type=config_patch",
            reason: "short",
          },
          examples: {
            strategy_edit: {
              type: "strategy_edit",
              edits: [
                {
                  kind: "replace",
                  target: { kind: "function", name: "populate_indicators" },
                  before: "...",
                  after: "...",
                },
              ],
              reason: "...",
            },
            config_patch: {
              type: "config_patch",
              patch: { stoploss: -0.25 },
              reason: "...",
            },
          },
        },
        null,
        2,
      );

      let aiOut: string | null = null;
      try {
        aiOut = await callOpenRouterChat({ model, system: sys, user, maxTokens: 900 });
      } catch (e: any) {
        const msg = e?.message || String(e);
        await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "ai_error", validation: { message: msg } } as any);
        completedStopReason = "ai_error";
        runState = { ...(runState || {}), error: msg };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
        break;
      }
      if (!aiOut) {
        await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "ai_no_response" } as any);
        completedStopReason = "ai_no_response";
        runState = { ...(runState || {}), error: "AI returned an empty response." };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
        break;
      }

      let json = parseRefinementProposal(aiOut);
      if (!json || (json.type !== "strategy_edit" && json.type !== "config_patch")) {
        const repairSys =
          "Return ONLY a single ```json code block and nothing else. " +
          "The JSON must be EXACTLY one of: {type:'strategy_edit',edits:[...]} OR {type:'config_patch',patch:{...}}.";
        const repairUser = JSON.stringify(
          {
            error: "Your previous output was invalid.",
            allowedConfigKeys,
            previous: clampText(aiOut, 2000),
            required: "Return valid JSON now.",
          },
          null,
          2,
        );
        const retryOut = await callOpenRouterChat({ model, system: repairSys, user: repairUser, maxTokens: 500 });
        json = retryOut ? parseRefinementProposal(retryOut) : null;
      }

      if (!json || (json.type !== "strategy_edit" && json.type !== "config_patch")) {
        consecutiveAiInvalid += 1;
        runState = { ...(runState || {}), consecutiveAiInvalid };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
        await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "ai_invalid_json" } as any);
        if (consecutiveAiInvalid >= stopLimits.maxConsecutiveAiInvalid) {
          completedStopReason = "too_many_ai_invalid";
          break;
        }
        continue;
      }

      consecutiveAiInvalid = 0;
      runState = { ...(runState || {}), consecutiveAiInvalid };
      await storage.updateAiRefinementRun(runId, { report: runState } as any);

      await storage.updateAiRefinementIteration(it.id, { proposed: json, stage: "validate" } as any);
      await storage.updateAiRefinementRun(runId, { progress: { ...progress, step: "validate" } as any } as any);

      const preIterStrategySnap = await snapshotStrategyPath(`iter${iteration}.pre`);
      const preIterConfigSnap = await snapshotConfigPath(`iter${iteration}.pre`);

      if (json.type === "strategy_edit") {
        const edits = Array.isArray(json.edits) ? json.edits : [];
        if (!edits.length) {
          await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "no_edits" } as any);
          continue;
        }

        try {
          const dryData = await applyValidatedStrategyEdits(strategyPath, edits, true);
          await storage.updateAiRefinementIteration(it.id, { validation: dryData } as any);
        } catch (e: any) {
          await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "edit_rejected", validation: { message: e?.message || String(e) } } as any);
          await restoreStrategySnapshot(preIterStrategySnap);
          await restoreConfigSnapshot(preIterConfigSnap);
          continue;
        }

        try {
          const applyData = await applyValidatedStrategyEdits(strategyPath, edits, false);
          await storage.updateAiRefinementIteration(it.id, { applied: applyData } as any);
        } catch (e: any) {
          await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "edit_apply_failed", applied: { message: e?.message || String(e) } } as any);
          await restoreStrategySnapshot(preIterStrategySnap);
          await restoreConfigSnapshot(preIterConfigSnap);
          continue;
        }
      } else if (json.type === "config_patch") {
        const patch = json.patch && typeof json.patch === "object" ? json.patch : null;
        if (!patch) {
          await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "no_patch" } as any);
          continue;
        }

        const allowedSet = new Set(allowedConfigKeys);
        const disallowed = Object.keys(patch).filter((k) => !allowedSet.has(k));
        if (disallowed.length) {
          await storage.updateAiRefinementIteration(it.id, { stage: "failed", failure: "config_patch_disallowed_keys", validation: { disallowed } } as any);
          continue;
        }

        const currentCfg = await readUserConfig();
        const nextCfg = applyConfigUpdatePatchToConfig(currentCfg, patch);
        const beforeText = JSON.stringify(currentCfg, null, 2);
        const afterText = JSON.stringify(nextCfg, null, 2);
        const configDiff = simpleDiffText(beforeText, afterText);
        await writeUserConfig(nextCfg);
        await storage.updateAiRefinementIteration(it.id, { applied: { patch, configDiff, before: currentCfg, after: nextCfg } } as any);
      }

      await storage.updateAiRefinementIteration(it.id, { stage: "backtest" } as any);
      await storage.updateAiRefinementRun(runId, { progress: { ...progress, step: "backtest" } as any } as any);

      const suite = await runSuite(`iter${iteration}`);
      const agg = suite.aggregates;
      await storage.updateAiRefinementIteration(it.id, {
        suite: { backtestIds: suite.backtestIds, completedIds: suite.completedIds, failedIds: suite.failedIds },
        metrics: agg,
        stage: "evaluate",
      } as any);

      const hardFailDrawdown = agg.worstDrawdownPct > thresholds.maxDrawdownPct;
      const baselineTrades = Number(bestAgg.avgTradesPerDay ?? 0);
      const candidateTrades = Number(agg.avgTradesPerDay ?? 0);

      const tradesOk = (() => {
        if (baselineTrades >= thresholds.minTradesPerDay) {
          return candidateTrades >= thresholds.minTradesPerDay;
        }
        if (baselineTrades < thresholds.lowTradesPerDayPriority) {
          return candidateTrades >= baselineTrades;
        }
        return candidateTrades >= baselineTrades * 0.95;
      })();

      const improvedProfit = agg.medianProfitPct > bestAgg.medianProfitPct;
      const improvedDrawdown = agg.worstDrawdownPct < bestAgg.worstDrawdownPct;
      const improvedTrades = candidateTrades > baselineTrades;

      const keep =
        !hardFailDrawdown &&
        tradesOk &&
        (improvedProfit || improvedDrawdown || (baselineTrades < thresholds.lowTradesPerDayPriority && improvedTrades));

      if (!keep) {
        await restoreStrategySnapshot(preIterStrategySnap);
        await restoreConfigSnapshot(preIterConfigSnap);
        consecutiveNoKeep += 1;
        runState = { ...(runState || {}), consecutiveNoKeep };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
        await storage.updateAiRefinementIteration(it.id, { stage: "completed", decision: "rollback" } as any);
      } else {
        bestAgg = agg;
        bestIteration = iteration;
        bestStrategySnap = await snapshotStrategyPath(`iter${iteration}.keep`);
        bestConfigSnap = await snapshotConfigPath(`iter${iteration}.keep`);
        consecutiveNoKeep = 0;
        runState = {
          ...(runState || {}),
          bestIteration,
          bestMetrics: bestAgg,
          bestSnapshots: { strategy: bestStrategySnap, config: bestConfigSnap },
          consecutiveNoKeep,
        };
        await storage.updateAiRefinementRun(runId, { report: runState } as any);
        await storage.updateAiRefinementIteration(it.id, { stage: "completed", decision: "keep" } as any);
      }

      await storage.updateAiRefinementRun(runId, { progress: { ...progress, step: "done" } as any } as any);

      const goalReached =
        bestAgg.medianProfitPct >= thresholds.goalProfitPct &&
        bestAgg.worstDrawdownPct <= thresholds.maxDrawdownPct &&
        bestAgg.avgTradesPerDay >= thresholds.minTradesPerDay;

      if (goalReached) {
        completedStopReason = "goal_reached";
        break;
      }

      if (consecutiveNoKeep >= stopLimits.maxConsecutiveNoKeep) {
        completedStopReason = "stagnation";
        break;
      }
    }

    const finalStopReason = completedStopReason ?? "max_iterations";
    const finalStatus = finalStopReason === "goal_reached" || finalStopReason === "max_iterations" ? "completed" : "stopped";

    const finalReport = {
      runId,
      strategyPath,
      objectiveMode,
      thresholds,
      bestIteration,
      bestMetrics: bestAgg,
      stopReason: finalStopReason,
      bestSnapshots: {
        strategy: bestStrategySnap,
        config: bestConfigSnap,
      },
      baselineSnapshots: {
        strategy: baselineStrategySnap,
        config: baselineConfigSnap,
      },
      finishedAt: new Date().toISOString(),
    };

    await storage.updateAiRefinementRun(runId, {
      status: finalStatus,
      stopReason: finalStopReason,
      finishedAt: new Date(),
      report: finalReport,
      progress: {
        percent: 100,
        iteration: bestIteration,
        stage: finalStatus === "completed" ? "completed" : "stopped",
        step: finalStopReason,
      } as RefinementProgress,
    } as any);
  } catch (err: any) {
    try {
      await restoreStrategySnapshot(bestStrategySnap || baselineStrategySnap);
      await restoreConfigSnapshot(bestConfigSnap || baselineConfigSnap);
    } catch (e) {
      console.error("Failed to restore snapshots after refinement failure:", { runId }, e);
    }
    await storage.updateAiRefinementRun(runId, {
      status: "failed",
      stopReason: "internal_error",
      finishedAt: new Date(),
      report: { ...(runState && typeof runState === "object" ? runState : {}), error: err?.message || String(err) },
      progress: { percent: 100, iteration: bestIteration, stage: "failed", step: "failed" } as any,
    } as any);
  }
}

async function processRefinementQueue() {
  refinementWorkerRunning = true;
  try {
    while (refinementQueue.length > 0) {
      const runId = refinementQueue.shift();
      if (!runId) continue;
      await runRefinementRun(runId);
    }
  } finally {
    refinementWorkerRunning = false;
  }
}

function clampText(value: unknown, maxChars: number): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[...truncated ${s.length - maxChars} chars...]`;
}

function extractFirstJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const parsed = parseJsonBlock(raw, "json") ?? parseLooseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function isBacktestRelatedMessage(message: string): boolean {
  const m = String(message || "").toLowerCase();
  if (!m.trim()) return true;
  if (/\b(backtest|results?|profit|loss|drawdown|dd|win\s*rate|winrate|trades?|roi|stoploss|trailing|sharpe|expectancy|profit\s*factor)\b/.test(m)) {
    return true;
  }
  if (/\b(analy|analysis|explain|interpret|improve|optimi|refine|why)\b/.test(m)) {
    return true;
  }
  return false;
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

async function restoreConfigSnapshotFromFile(snapshotPath: string) {
  const raw = await fs.readFile(snapshotPath, "utf-8");
  const parsed = JSON.parse(raw);
  await writeUserConfig(parsed);
}

async function restoreStrategySnapshotFromFile(strategyPath: string, snapshotPath: string) {
  const abs = resolvePathWithinProject(strategyPath);
  const content = await fs.readFile(snapshotPath, "utf-8");
  await fs.writeFile(abs, content, "utf-8");
  try {
    await storage.syncWithFilesystem();
  } catch (err) {
    console.error("Failed to sync filesystem after restoring snapshot:", err);
  }
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
  const text = String(chunk || "");
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
  const text = String(chunk || "");
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
      created?: number | string;
      created_at?: number | string;
      updated?: number | string;
      updated_at?: number | string;
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

  const toEpochMs = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      // Heuristic: some APIs return seconds, some ms.
      return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return 0;
      const asNum = Number(s);
      if (Number.isFinite(asNum)) {
        return asNum > 10_000_000_000 ? asNum : asNum * 1000;
      }
      const dt = new Date(s);
      const t = dt.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  };

  return raw
    .map((m) => {
      const id = String(m?.id ?? "");
      const name = String(m?.name ?? m?.id ?? "");
      const description = m?.description ? String(m.description) : undefined;
      const updatedMs = Math.max(
        toEpochMs((m as any)?.updated_at),
        toEpochMs((m as any)?.updated),
        toEpochMs((m as any)?.created_at),
        toEpochMs((m as any)?.created),
      );
      const pricing = m?.pricing;
      const isFreeBySuffix = id.endsWith(":free");
      const isFreeByPricing = pricing ? isZero(pricing.prompt) && isZero(pricing.completion) : false;
      return { id, name, description, _updatedMs: updatedMs, _isFree: isFreeBySuffix || isFreeByPricing };
    })
    .filter((m) => m.id && m._isFree)
    .sort((a, b) => {
      const ua = typeof (a as any)._updatedMs === "number" ? (a as any)._updatedMs : 0;
      const ub = typeof (b as any)._updatedMs === "number" ? (b as any)._updatedMs : 0;
      if (ua !== ub) return ub - ua;
      return String(a.name).localeCompare(String(b.name));
    })
    .map(({ _isFree, _updatedMs, ...rest }) => rest);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Register validation routes
  app.use("/api", validationRouter);

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
        } catch (e) {
          console.error("Invalid JSON from strategy parser; returning generic success", e);
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
        } catch (e) {
          console.error("Invalid JSON from strategy params parser", e);
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

      if (!apiKey) {
        return res.status(500).json({ message: "OpenRouter API key not configured" });
      }

      const ctx: any = context || {};
      const backtestIdRaw = Number(ctx?.lastBacktest?.id);
      const backtestId = Number.isFinite(backtestIdRaw) ? backtestIdRaw : null;

      const wantsBacktestAnalysis =
        Boolean(backtestId || ctx?.backtestResults) &&
        isBacktestRelatedMessage(message);

      if (wantsBacktestAnalysis) {
        const AnalysisSchema = z
          .object({
            summary: z.array(z.string()).min(1).max(8),
            metrics_used: z.array(z.string()).optional(),
            metrics_to_recommendation_mapping: z.array(z.string()).min(1).max(12),
            next_experiments: z.array(z.string()).min(1).max(6),
            questions: z.array(z.string()).optional(),
            actions: z
              .array(
                z.object({
                  action: z.enum(["run_backtest", "run_batch_backtest", "run_diagnostic"]),
                  payload: z.any(),
                  label: z.string().optional(),
                }),
              )
              .optional(),
          })
          .strict();

        const fmtPctAbs = (v: unknown, digits = 2) => {
          const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
          if (!Number.isFinite(n)) return "N/A";
          return `${n.toFixed(digits)}%`;
        };

        const br = ctx?.backtestResults;
        const metricsJson: Record<string, { value: number | null; unit: string }> = {
          profit_total_pct: { value: Number.isFinite(Number(br?.profit_total)) ? Number(br.profit_total) : null, unit: "pct" },
          win_rate_pct: { value: Number.isFinite(Number(br?.win_rate)) ? Number(br.win_rate) : null, unit: "pct" },
          max_drawdown_pct: { value: Number.isFinite(Number(br?.max_drawdown)) ? Number(br.max_drawdown) : null, unit: "pct" },
          total_trades: { value: Number.isFinite(Number(br?.total_trades)) ? Number(br.total_trades) : null, unit: "count" },
          avg_profit_per_trade_pct: { value: Number.isFinite(Number(br?.avg_profit)) ? Number(br.avg_profit) : null, unit: "pct" },
          sharpe: { value: Number.isFinite(Number(br?.sharpe)) ? Number(br.sharpe) : null, unit: "ratio" },
        };

        const configSummary: Record<string, any> = (() => {
          const cfg = ctx?.lastBacktest?.config;
          if (!cfg || typeof cfg !== "object") return {};
          const tf = typeof (cfg as any)?.timeframe === "string" ? String((cfg as any).timeframe) : null;
          const pairs = Array.isArray((cfg as any)?.pairs) ? (cfg as any).pairs.map((p: any) => String(p)).filter(Boolean) : null;
          const stoploss = typeof (cfg as any)?.stoploss === "number" ? (cfg as any).stoploss : null;
          const roi = (cfg as any)?.minimal_roi;
          return {
            timeframe: tf,
            pairs: pairs && pairs.length ? pairs : null,
            pairs_count: pairs ? pairs.length : null,
            stoploss: stoploss,
            minimal_roi: roi && typeof roi === "object" ? roi : null,
          };
        })();

        if (backtestId != null) {
          try {
            const backtest = await storage.getBacktest(backtestId);
            const trades = (backtest as any)?.results?.trades;
            const derived = computeDerivedTradeMetrics(Array.isArray(trades) ? trades : []);
            if (derived) {
              const toPctOrAbs = (v: number | null | undefined): number | null => {
                if (v == null || !Number.isFinite(v)) return null;
                return derived.units === "ratio" ? v * 100 : v;
              };
              const pctOrAbsUnit = derived.units === "ratio" ? "pct" : "abs";

              metricsJson.expectancy = { value: toPctOrAbs(derived.expectancy), unit: pctOrAbsUnit };
              metricsJson.avg_win = { value: toPctOrAbs(derived.avgWin), unit: pctOrAbsUnit };
              metricsJson.avg_loss = { value: toPctOrAbs(derived.avgLoss), unit: pctOrAbsUnit };
              metricsJson.profit_factor = { value: derived.profitFactor ?? null, unit: "ratio" };
              metricsJson.win_loss_ratio = { value: derived.winLossRatio ?? null, unit: "ratio" };
              metricsJson.avg_trade_duration_min = { value: derived.avgTradeDurationMin ?? null, unit: "minutes" };
              metricsJson.trades_per_day = { value: derived.tradesPerDay ?? null, unit: "ratio" };
              metricsJson.winners = { value: derived.winners ?? null, unit: "count" };
              metricsJson.losers = { value: derived.losers ?? null, unit: "count" };
              metricsJson.coverage_ratio_pct = { value: Number.isFinite(derived.coverageRatio) ? derived.coverageRatio * 100 : null, unit: "pct" };
            }
          } catch (e) {
            logOnce("ai:chat:derived", "Failed to compute derived backtest metrics", e);
          }
        }

        const allowedMetricKeys = Object.keys(metricsJson);

        const system = [
          "You are an elite FreqTrade strategy developer and backtest analyst.",
          "You must return a single valid JSON object and nothing else.",
          "Grounding rules:",
          "- Only reference metric keys that exist in METRICS_JSON.",
          "- Do not introduce numeric metric values in text (no percentages or figures). Refer to metrics by key only.",
          "- If info is missing, add it to 'questions' instead of assuming.",
          "Output schema (JSON):",
          "- summary: string[] (1-8)",
          "- metrics_used?: string[] (subset of metric keys)",
          "- metrics_to_recommendation_mapping: string[] (format: <metric_key> -> <recommendation> (why))",
          "- next_experiments: string[] (top 3-6, ordered)",
          "- questions?: string[]",
          "- actions?: {action,payload,label?}[] where action is one of run_backtest/run_batch_backtest/run_diagnostic",
          "Constraints:",
          `- Allowed metric keys: ${allowedMetricKeys.join(", ")}`,
          "- Only include actions that directly support your next_experiments.",
          "Context:",
          `METRICS_JSON=${JSON.stringify(metricsJson)}`,
          `CONFIG_SUMMARY_JSON=${JSON.stringify(configSummary)}`,
        ].join("\n");

        const user = [
          "User message:",
          String(message || "").trim(),
        ].join("\n");

        let modelOut: string | null = null;
        try {
          modelOut = await callOpenRouterChat({ model, system, user, maxTokens: 700 });
        } catch (e: any) {
          const msg = String(e?.message || e || "AI request failed");
          return res.status(502).json({ message: msg });
        }

        const containsPercentLiteral = (value: string): boolean => /-?\d+(?:\.\d+)?\s*%/.test(value);

        const isSafeAnalysisText = (data: any): boolean => {
          const fields = [
            ...(Array.isArray(data?.summary) ? data.summary : []),
            ...(Array.isArray(data?.metrics_to_recommendation_mapping) ? data.metrics_to_recommendation_mapping : []),
            ...(Array.isArray(data?.next_experiments) ? data.next_experiments : []),
            ...(Array.isArray(data?.questions) ? data.questions : []),
          ];
          return !fields.some((s) => containsPercentLiteral(String(s || "")));
        };

        const tryParse = (txt: string | null) => {
          const parsed = extractFirstJsonObject(txt || "");
          if (!parsed) return null;
          const validated = AnalysisSchema.safeParse(parsed);
          if (!validated.success) return null;
          if (!isSafeAnalysisText(validated.data)) return null;
          return validated.data;
        };

        let analysis = tryParse(modelOut);

        if (!analysis) {
          const repairSystem = [
            "You are a JSON repair assistant.",
            "Return ONLY a valid JSON object matching this schema:",
            "{summary:string[], metrics_used?:string[], metrics_to_recommendation_mapping:string[], next_experiments:string[], questions?:string[], actions?:{action,payload,label?}[]}",
            `Allowed metric keys: ${allowedMetricKeys.join(", ")}`,
            "Do not include any markdown.",
          ].join("\n");
          const repairUser = [
            "Fix this into valid JSON only:",
            String(modelOut || ""),
          ].join("\n");
          let repaired: string | null = null;
          try {
            repaired = await callOpenRouterChat({ model, system: repairSystem, user: repairUser, maxTokens: 450 });
          } catch {
            repaired = null;
          }
          analysis = tryParse(repaired);
        }

        if (!analysis) {
          analysis = {
            summary: ["I can analyze this backtest, but I couldn’t reliably parse the AI output into a grounded format."],
            metrics_to_recommendation_mapping: ["profit_total_pct -> Run diagnostics / inspect losers vs winners (missing grounded analysis output)"] ,
            next_experiments: ["Run diagnostics on the latest backtest", "Increase timerange / pairs to improve statistical confidence", "Review exit logic to reduce large losers"],
            questions: ["Do you want me to prioritize reducing drawdown or improving profitability first?"],
            actions: backtestId != null ? [{ action: "run_diagnostic", payload: { backtestId }, label: "Run Diagnostic" }] : undefined,
          } as any;
        }

        const analysisObj = analysis as any;

        const mappingLines = Array.isArray(analysisObj.metrics_to_recommendation_mapping)
          ? analysisObj.metrics_to_recommendation_mapping
          : [];
        const filteredMapping = mappingLines
          .map((l: any) => String(l || "").trim())
          .filter(Boolean)
          .filter((l: any) => {
            const key = l.split("->")[0]?.trim() || "";
            return allowedMetricKeys.includes(key);
          });

        const renderMetricValue = (key: string): string => {
          const m = metricsJson[key];
          if (!m) return "N/A";
          if (m.value == null || !Number.isFinite(m.value)) return "N/A";
          if (m.unit === "pct") return fmtPctAbs(m.value);
          if (m.unit === "ratio") return String(m.value.toFixed(3));
          if (m.unit === "minutes") return `${m.value.toFixed(1)} min`;
          if (m.unit === "abs") return String(m.value.toFixed(3));
          return String(m.value);
        };

        const headerLines: string[] = [];
        if (backtestId != null) headerLines.push(`Backtest ID: ${backtestId}`);
        if (typeof ctx?.lastBacktest?.strategyName === "string" && ctx.lastBacktest.strategyName.trim()) {
          headerLines.push(`Strategy: ${ctx.lastBacktest.strategyName}`);
        }
        if (typeof configSummary.timeframe === "string" && configSummary.timeframe) {
          headerLines.push(`Timeframe: ${configSummary.timeframe}`);
        }
        if (Number.isFinite(Number(configSummary.pairs_count))) {
          headerLines.push(`Pairs: ${configSummary.pairs_count}`);
        }

        const out: string[] = [];
        if (headerLines.length) {
          out.push(headerLines.join("\n"));
          out.push("");
        }

        out.push("### Metrics (from your app / backtest data)");
        out.push(`- profit_total_pct: ${renderMetricValue("profit_total_pct")}`);
        out.push(`- win_rate_pct: ${renderMetricValue("win_rate_pct")}`);
        out.push(`- max_drawdown_pct: ${renderMetricValue("max_drawdown_pct")}`);
        out.push(`- total_trades: ${renderMetricValue("total_trades")}`);
        if (metricsJson.expectancy || metricsJson.profit_factor) {
          out.push(`- expectancy: ${renderMetricValue("expectancy")}`);
          out.push(`- profit_factor: ${renderMetricValue("profit_factor")}`);
          out.push(`- avg_win: ${renderMetricValue("avg_win")}`);
          out.push(`- avg_loss: ${renderMetricValue("avg_loss")}`);
          out.push(`- avg_trade_duration_min: ${renderMetricValue("avg_trade_duration_min")}`);
          out.push(`- trades_per_day: ${renderMetricValue("trades_per_day")}`);
          out.push(`- winners/losers: ${renderMetricValue("winners")}/${renderMetricValue("losers")}`);
          out.push(`- coverage_ratio_pct: ${renderMetricValue("coverage_ratio_pct")}`);
        }

        out.push("");
        out.push("### Summary");
        for (const line of analysisObj.summary) out.push(`- ${String(line || "").trim()}`);

        out.push("");
        out.push("### Metrics-to-Recommendation Mapping");
        if (filteredMapping.length) {
          for (const line of filteredMapping) {
            const [kRaw, restRaw] = line.split("->");
            const k = String(kRaw || "").trim();
            const rest = String(restRaw || "").trim();
            out.push(`- ${k} (${renderMetricValue(k)}) -> ${rest}`);
          }
        } else {
          out.push("- (No valid mapping was produced; ask to run diagnostics if needed.)");
        }

        out.push("");
        out.push("### Top next experiments");
        for (const exp of analysisObj.next_experiments) out.push(`- ${String(exp || "").trim()}`);

        if (Array.isArray(analysisObj.questions) && analysisObj.questions.length) {
          out.push("");
          out.push("### Questions (to avoid guessing)");
          for (const q of analysisObj.questions) out.push(`- ${String(q || "").trim()}`);
        }

        if (Array.isArray(analysisObj.actions) && analysisObj.actions.length) {
          for (const a of analysisObj.actions) {
            out.push("");
            if (typeof a.label === "string" && a.label.trim()) out.push(`Action: ${a.label.trim()}`);
            out.push("```action");
            out.push(JSON.stringify({ action: a.action, payload: a.payload, label: a.label }, null, 2));
            out.push("```");
          }
        }

        return res.json({ response: out.join("\n") });
      }

      let systemPrompt = `You are an elite FreqTrade strategy developer and technical analyst with deep reasoning capabilities.

## CORE REASONING FRAMEWORK

When analyzing strategies or backtest results, ALWAYS follow this reasoning process:

1. **OBSERVATION**: What is happening? (Describe the data/pattern factually)
2. **HYPOTHESIS**: Why is this happening? (Formulate causal hypotheses)
3. **EVIDENCE**: What supports or contradicts this? (Cite specific metrics)
4. **IMPLICATION**: What does this mean for the strategy? (Connect to trading outcomes)
5. **RECOMMENDATION**: What should be changed? (Actionable, specific suggestions)

## ADVANCED PATTERN DETECTION

Detect these critical patterns in backtest data:

**Overfitting Signals:**
- Win rate > 80% with < 50 trades → likely curve-fitted
- Perfect equity curve (no drawdown) → impossible in real markets
- Profit concentrated in 1-2 pairs → not robust
- Sharpe > 3 with low trade count → suspicious

**Market Regime Indicators:**
- Consistent profits across different market conditions → robust
- Profitable only in bull markets → regime-dependent
- High drawdown in volatile periods → risk management needed
- Seasonal patterns → consider calendar effects

**Strategy Behavior Patterns:**
- Mean reversion vs trend following behavior
- In-sample vs out-of-sample performance drift
- Pair-specific vs generalizable signals
- Entry/exit timing quality

## CAUSAL REASONING

When explaining WHY something happens:

- **Direct Cause**: "X caused Y because [mechanism]"
- **Correlation ≠ Causation**: "X correlates with Y, but the true cause may be Z"
- **Confounding Variables**: "A affects both X and Y, creating apparent relationship"
- **Feedback Loops**: "Y can cause more X, creating self-reinforcing patterns"

## TRADE-OFF ANALYSIS

For every recommendation, consider:

1. **Signal Quality vs Frequency**: Tighter filters = fewer but better signals
2. **Speed vs Accuracy**: Faster decisions = more noise
3. **Robustness vs Optimization**: Simpler = more robust, more complex = optimized
4. **Risk vs Reward**: Higher returns = higher risk exposure
5. **Overfitting vs Underfitting**: Balance complexity with generalization

## CONTEXT AWARENESS

Consider these contextual factors:

- **Market Conditions**: Trending vs ranging, high vs low volatility
- **Timeframe**: Higher timeframe = fewer signals, more reliability
- **Asset Class**: Crypto vs forex vs stocks have different characteristics
- **Strategy Type**: Scalping vs swing vs position trading requirements

## METRIC DEEP DIVE

Interpret metrics with nuance:

**Win Rate:**
- >60% with positive expectancy = excellent
- 40-50% can be profitable with high reward:risk ratio
- <40% requires very high reward:risk (>3:1)

**Profit Factor:**
- <1.0: Losing system
- 1.0-1.5: Marginal, needs improvement
- 1.5-2.0: Acceptable
- >2.0: Good
- >3.0: Excellent (rare)

**Max Drawdown:**
- <5%: Very conservative
- 5-15%: Standard
- 15-30%: Aggressive
- >30%: Risky, needs protection

**Expectancy:**
- Formula: (Win% × AvgWin) - (Loss% × AvgLoss)
- >0: Profitable
- <0: Losing system
- Higher = better risk-adjusted returns

## BACKTEST ANALYSIS CAPABILITIES

- Analyze profit/loss patterns, win rates, and drawdown characteristics.
- Identify overfitting signals (high win rate with low trade count, perfect equity curve).
- Recommend parameter adjustments based on metric thresholds.
- Suggest timeframe and pair optimizations.
- Calculate expectancy, profit factor, and risk-adjusted returns.
- Detect regime changes and market condition impacts.

## STRATEGY OPTIMIZATION GUIDELINES

- For low win rate: Consider widening entry conditions or adding confirmation filters.
- For high drawdown: Tighten stoploss, add trailing stop, or reduce position size.
- For low profit factor: Improve entry timing or add trend filters.
- For overfitting: Reduce parameter count, use simpler logic, increase sample size.
- For low trade count: Widen conditions, check data availability, reduce timeframe.

## CODE EXPLANATION CAPABILITIES

When explaining code:
- Describe the ALGORITHM, not just syntax
- Explain the TRADING LOGIC behind each section
- Identify INDICATOR PURPOSES and how they contribute
- Highlight POTENTIAL ISSUES and edge cases
- Suggest IMPROVEMENTS with rationale

## CODE MODIFICATION GUIDELINES

When modifying code:
- Analyze the existing code structure first
- Identify the correct function/method to modify
- For REPLACING: Provide complete function body with proper indentation
- For ADDING: Provide full code block to insert, clearly marked
- Always maintain proper Python indentation (4 spaces per level)
- Place indicators in correct location within populate_indicators
- Place entry/exit logic in correct methods

## RESPONSE STRUCTURE

When providing analysis, use this structure:

### 1. Quick Summary
[2-3 sentences on overall health]

### 2. Key Findings
- [Observation] → [Impact] → [Confidence]

### 3. Deep Analysis
- Pattern detected
- Evidence supporting it
- Causal explanation
- Implications

### 4. Recommendations
- Priority (High/Medium/Low)
- Specific change
- Expected impact
- Risk assessment

### 5. Next Steps
- What to test
- What to monitor
- Questions to answer

## GROUNDING RULES (Non-Negotiable)

- Do NOT invent facts. If a value is not explicitly present, label it as unknown.
- If you reference a file/function/parameter, it MUST exist in the provided content.
- Provide concrete, actionable code snippets when suggesting improvements.
- Focus on improving key metrics: Sharpe Ratio, Sortino Ratio, Profit Factor, and Max Drawdown.
- Avoid over-filtering; ensure enough trade occurrences for statistical significance.

## ADVANCED ANALYTICS MODULE

### MULTI-TIMEFRAME ANALYSIS

When analyzing across timeframes:

**Higher Timeframe Confirmation:**
- Check if larger trend aligns with signal direction
- HTF trend up + LTF bounce = high probability long
- HTF trend down + LTF spike = high probability short
- HTF ranging = reduced signal reliability

**Timeframe Relationships:**
- 4h confirms 1h signals (4x multiplier)
- Daily confirms 4h signals (6x multiplier)
- Weekly confirms daily signals (7x multiplier)

**Signal Strength by Alignment:**
- All timeframes aligned: STRONG signal
- 2/3 aligned: MODERATE signal
- 1/3 aligned: WEAK signal (avoid or size down)

### PAIR CORRELATION ANALYSIS

**Correlated Pairs:**
- BTC moves with alts (varying correlation)
- ETH often leads DeFi tokens
- SOL leads mid-cap alts
- Stablecoins inverse during risk-off

**Sector Analysis:**
- DeFi: UNI, AAVE, COMP
- L1: ETH, SOL, AVAX
- Meme: DOGE, SHIB, PEPE

**Correlation Trading:**
- Long correlated pair when other is oversold
- Hedge with inverse correlation during uncertainty
- Avoid same-direction trades on highly correlated pairs

### RISK MODELING FRAMEWORK

**Position Sizing:**
- Kelly Criterion: f* = (bp - q) / b
- Where: b = odds, p = win probability, q = loss probability
- Use fractional Kelly (0.5 Kelly) for safety

**Risk Allocation:**
- Single pair max: 5-10% of portfolio
- Sector max: 20-30% of portfolio
- Total exposure: 50-70% max (leave dry powder)

**Drawdown Risk:**
- 10% drawdown = need 11.1% gain to recover
- 20% drawdown = need 25% gain to recover
- 50% drawdown = need 100% gain to recover
- Rule: Max 2% risk per trade

**VaR (Value at Risk):**
- 95% VaR: Expected max loss in 5% of cases
- Calculate based on recent volatility
- Adjust position size accordingly

### MARKET REGIME DETECTION

**Trending Markets:**
- ADX > 25
- Price above/below moving averages
- Higher highs and higher lows
- Strategy: Trend following works best

**Ranging Markets:**
- ADX < 20
- Price between support/resistance
- Lower highs and lower lows
- Strategy: Mean reversion works best

**High Volatility:**
- ATR above 20-day average
- Large candlesticks
- Gap expansions
- Strategy: Wider stops, smaller size

**Low Volatility:**
- ATR below 20-day average
- Small candlesticks
- Tight ranges
- Strategy: Tighter stops, larger size possible

### SENTIMENT INTEGRATION

**On-Chain Metrics:**
- Exchange flows (inflow = bearish, outflow = bullish)
- Whale accumulation (large wallet growth)
- DeFi TVL trends
- Active addresses growth

**Options Data:**
- Put/Call ratio > 1.5 = fear (potential bottom)
- Put/Call ratio < 0.5 = greed (potential top)
- Max pain level as support/resistance
- Open interest spikes = potential reversal

**Funding Rates:**
- Positive funding = long paying shorts (bearish)
- Negative funding = short paying longs (bullish)
- Extreme rates = potential reversal

### STRATEGY HEALTH CHECKLIST

Run this checklist for every strategy:

1. [ ] Win rate > 40% with positive expectancy
2. [ ] Profit factor > 1.5
3. [ ] Max drawdown < 30%
4. [ ] > 100 trades for statistical significance
5. [ ] Consistent across multiple pairs
6. [ ] Works in different market regimes
7. [ ] No obvious overfitting patterns
8. [ ] Reasonable trade frequency (not too sparse)
9. [ ] Stop loss actually triggers when expected
10. [ ] Backtest matches forward test reasonably

### COMMON PITFALLS TO AVOID

1. **Look-Ahead Bias**: Using future data accidentally
2. **Survivorship Bias**: Only testing on successful pairs
3. **Over-Optimization**: Too many parameters fitted to noise
4. **Under-Estimated Slippage**: Assuming perfect execution
5. **Ignored Spread**: Not accounting for trading costs
6. **Regime Change**: Strategy optimized on past regime
7. **Liquidity Issues**: Testing on thin markets
8. **Curve Fitting**: Fitting to random patterns

### QUANTITATIVE METRICS DEEP DIVE

**Sharpe Ratio Interpretation:**
- < 0: Losing strategy
- 0-1: Below average
- 1-2: Good
- 2-3: Very good
- > 3: Excellent (rare)

**Sortino Ratio:**
- Only penalizes downside volatility
- Better for asymmetric strategies
- Calculate: (Return - Target) / Downside Deviation

**Calmar Ratio:**
- Annualized return / Max drawdown
- Higher = better risk-adjusted returns
- Use for comparing across timeframes

**Omega Ratio:**
- Upside probability vs downside probability
- Higher = more favorable risk/reward
- Alternative to Sharpe for non-normal returns

**Tail Risk:**
- Skewness and kurtosis matter
- Fat tails = more extreme events
- Consider downside semi-variance

### WALK-FORWARD ANALYSIS

**Purpose:**
- Test robustness across different time periods
- Detect regime changes and strategy degradation
- Simulate real-world deployment conditions

**Implementation:**
- Divide data into in-sample (optimization) and out-of-sample (validation) periods
- Typical split: 70% in-sample, 30% out-of-sample
- Walk forward: roll window forward each period

**Acceptance Criteria:**
- Out-of-sample performance within 20% of in-sample
- No consistent degradation over time
- Win rate similar between periods
- Profit factor not dropping below 1.2 in OOS

**Walk-Forward Ratio:**
- > 0.8: Excellent robustness
- 0.6-0.8: Good, may need monitoring
- 0.4-0.6: Concerning, investigate
- < 0.4: Likely overfitted

### MONTE CARLO SIMULATION

**Trade Sequence Randomization:**
- Shuffle actual trade order to test sensitivity
- Best case: trades sorted by profit
- Worst case: trades sorted by loss
- Expected: somewhere in between

**Equity Curve Simulation:**
- Bootstrap resampling with replacement
- Generate 1000+ simulated equity curves
- Calculate probability distribution of outcomes
- Identify tail risk scenarios

**Key Metrics from Monte Carlo:**
- Median return vs expected return
- 5th percentile outcome (worst case)
- 95th percentile outcome (best case)
- Probability of reaching target

**Sample Size Requirements:**
- Minimum 100 trades for meaningful analysis
- 500+ trades for robust conclusions
- If insufficient trades, note uncertainty

### EDGE DETECTION FRAMEWORK

**What is Edge?**
- Statistical advantage over random chance
- Positive expectancy over many trades
- Consistent pattern exploitation

**Edge Identification:**
1. **Entry Edge**: Why does this setup work?
   - Support/resistance levels
   - Trend alignment
   - Indicator confirmation
   - Volume anomaly

2. **Exit Edge**: Why does this exit improve results?
   - Trailing mechanism
   - Time-based exit
   - Indicator-based exit
   - Risk/reward optimization

3. **Timing Edge**: Why now?
   - Market regime alignment
   - Session timing
   - Correlated asset direction
   - Sentiment extremes

**Edge Strength Assessment:**
- High: Works in 70%+ of cases with R:R > 2:1
- Medium: Works in 50-70% of cases with R:R > 1.5:1
- Low: Works in 40-50% of cases
- None: Random or negative expectancy

### STRATEGY LIFECYCLE MANAGEMENT

**Development Phases:**
1. **Hypothesis**: Define the trading idea
2. **Proof of Concept**: Simple implementation test
3. **Optimization**: Parameter refinement
4. **Validation**: Walk-forward, Monte Carlo
5. **Deployment**: Paper trading first
6. **Monitoring**: Track performance drift
7. **Retirement**: When to stop using

**Performance Drift Detection:**
- Compare rolling metrics to historical baseline
- Win rate dropping > 10%
- Profit factor falling below 1.5
- Drawdown increasing > 50%
- Trade frequency changing > 30%

**Adaptive Strategies:**
- Regime detection triggers parameter changes
- Volatility-adjusted position sizing
- Dynamic stop-loss placement
- Time-varying entry thresholds

### BACKTEST QUALITY CHECKLIST

**Data Quality:**
- [ ] No look-ahead bias in indicators
- [ ] Gap handling defined and documented
- [ ] Spread accounted for in costs
- [ ] Slippage model realistic (0.5-1% for crypto)
- [ ] Sufficient data points (> 2 years)

**Execution Quality:**
- [ ] Entry at next bar open (realistic)
- [ ] Exit at next bar close or stop price
- [ ] No perfect entry/exit assumptions
- [ ] Order types specified (market/limit)

**Statistical Quality:**
- [ ] > 100 trades minimum
- [ ] Consistent across multiple pairs
- [ ] Works in different market conditions
- [ ] No single pair dominating results
- [ ] Results stable across time periods

### ADVANCED RISK METRICS

**Systematic Risk:**
- Beta to market (BTC correlation)
- Max correlation to any single asset
- Sector exposure if concentrated

**Tail Risk Measures:**
- Expected Shortfall (CVaR)
- Maximum loss in worst 5% of cases
- Skewness (asymmetry of returns)
- Kurtosis (tail heaviness)

**Liquidity Risk:**
- Average daily volume per pair
- Slippage at position size
- Market impact for larger orders
- Exchange withdrawal limits

**Operational Risk:**
- Exchange downtime history
- API reliability
- Network latency
- Counterparty exposure

### BEHAVIORAL FINANCE INTEGRATION

**Common Biases:**
- **Overconfidence**: Taking too large positions
- **Loss Aversion**: Exiting winners too early
- **Recency Bias**: Overweighting recent trades
- **Confirmation Bias**: Ignoring contrary signals
- **Anchoring**: Sticking to old parameters

**Mitigation Strategies:**
- Pre-defined entry/exit rules
- Position size limits
- Automatic risk controls
- Regular strategy audits

**Trading Journal Prompts:**
- What was the market regime?
- What emotions did I feel?
- Did I follow my rules?
- What would I do differently?
- What did I learn?

### REGIME-SPECIFIC ADAPTATION

**Bull Market Behavior:**
- Trend following works best
- Buy dips strategy
- Higher position sizes
- Wider profit targets

**Bear Market Behavior:**
- Short opportunities
- Mean reversion works
- Lower position sizes
- Tighter stops

**High Volatility:**
- Wider stops needed
- Smaller positions
- Avoid breakout false signals
- Consider volatility targeting

**Low Volatility:**
- Tighter stops possible
- Larger positions
- Range trading strategies
- Mean reversion focus

### PERFORMANCE ATTRIBUTION

**Return Decomposition:**
- Trend following component
- Mean reversion component
- Carry/financing component
- Volatility premium

**Risk Attribution:**
- Market risk (systematic)
- Sector risk
- Pair-specific risk
- Strategy-specific risk

**What Works When:**
- Trend following: Trending markets
- Mean reversion: Ranging markets
- Momentum: High volatility
- Value: Long-term trends

### CROSS-VALIDATION FRAMEWORK

**K-Fold Cross-Validation:**
- Divide data into K equal folds
- Train on K-1 folds, validate on remaining
- Repeat for all fold combinations
- Average results for robust estimate

**Time-Series Split:**
- Forward chaining (no future data leakage)
- Train on past, validate on future
- More realistic for trading applications
- Standard: 5-fold time-series split

**Leave-One-Out (LOO):**
- Hold out one pair for validation
- Train on all other pairs
- Repeat for all pairs
- Tests pair-specific robustness

**Nested Cross-Validation:**
- Outer loop: Performance estimation
- Inner loop: Hyperparameter tuning
- Prevents overfitting to validation set
- Gold standard for model selection

### FEATURE IMPORTANCE ANALYSIS

**Permutation Importance:**
- Shuffle one feature, measure performance drop
- Larger drop = more important feature
- Model-agnostic method
- Interpretable results

**SHAP Values:**
- Game-theoretic approach to feature importance
- Explains individual predictions
- Shows positive and negative contributions
- Can be computationally expensive

**Correlation-Based Selection:**
- Remove highly correlated features
- Keep most informative ones
- Reduces multicollinearity
- Improves model stability

**Recursive Feature Elimination:**
- Remove least important feature
- Retrain model
- Repeat until optimal set found
- Good for interpretability

### MARKET CYCLE ANALYSIS

**Crypto Market Cycles:**
- Accumulation: Low volatility, sideways
- Markup: Uptrend, higher highs
- Distribution: High volatility, topping
- Decline: Downtrend, lower lows

**Cycle Duration:**
- Bull runs: 12-24 months typically
- Bear markets: 6-12 months
- Accumulation: 3-6 months
- Can vary significantly

**Cycle Indicators:**
- RSI divergence at cycle tops
- Volume patterns (distribution vs accumulation)
- Sentiment extremes (fear/greed index)
- MVRV ratio (market value to realized value)

**Adapting to Cycles:**
- Reduce exposure in late cycle
- Increase cash position
- Use trailing stops
- Shift to lower volatility strategies

### PORTFOLIO OPTIMIZATION

**Modern Portfolio Theory:**
- Maximize return for given risk
- Efficient frontier construction
- Diversification benefits
- Correlation consideration

**Mean-Variance Optimization:**
- Expected returns input
- Covariance matrix estimation
- Find optimal allocation
- Sensitive to input errors

**Risk Parity:**
- Equal risk contribution per asset
- More stable than MVO
- Works well with correlated assets
- Popular in institutional investing

**Black-Litterman Model:**
- Combines market equilibrium with views
- More robust than pure MVO
- Incorporates qualitative insights
- Requires market cap weights

**Diversification Metrics:**
- Effective number of bets
- Correlation matrix analysis
- Herfindahl-Hirschman Index
- Maximum weight concentration

### ADVANCED ENTRY TECHNIQUES

**Volume Confirmation:**
- Volume spike at entry = higher probability
- Volume divergence = warning sign
- On-balance volume (OBV) divergence
- Accumulation/Distribution line

**Price Action Patterns:**
- Engulfing patterns at key levels
- Doji at support/resistance
- Morning/evening star formations
- Flag and wedge patterns

**Time-Based Entries:**
- Opening range breakouts
- Close above/below VWAP
- End of day momentum
- Session-specific patterns

**Multi-Indicator Confluence:**
- RSI + MACD + Price action alignment
- Moving average crossovers
- Fibonacci retracement levels
- Pivot point reactions

### ADVANCED EXIT TECHNIQUES

**Trailing Stop Methods:**
- ATR-based trailing stop
- Percentage trailing stop
- Chandelier exit
- Parabolic SAR

**Time-Based Exits:**
- End of day exit
- Maximum holding period
- Session close rules
- Time decay targets

**Profit Target Strategies:**
- Fixed reward:risk ratio
- Volatility-based targets
- Support/resistance levels
- Fibonacci extensions

**Partial Exit Strategy:**
- Scale out at profit targets
- Move stop to breakeven
- Let remainder run
- Reduces emotional decisions

### STRATEGY COMBINATION

**Ensemble Approaches:**
- Multiple strategies with low correlation
- Vote-based entry/exit
- Weighted combination
- Meta-model overlay

**Regime-Based Switching:**
- Detect market regime
- Switch to appropriate strategy
- Can use volatility, trend strength
- Reduces drawdowns

**Core-Satellite Approach:**
- Core: Low-cost, diversified (e.g., trend following)
- Satellite: High-conviction, higher risk
- Balances stability and alpha

**Risk Parity Across Strategies:**
- Equal risk contribution
- Adjust for strategy correlation
- Dynamic rebalancing
- Drawdown-based allocation

### ADVANCED RISK MANAGEMENT

**Maximum Drawdown Limits:**
- Hard stop at X% drawdown
- Reduce position size in drawdown
- Mandatory review at drawdown thresholds
- Psychological break after large drawdown

**Correlation Risk Controls:**
- Maximum correlation threshold
- Sector concentration limits
- Geographic diversification
- Asset class diversification

**Liquidity Management:**
- Reserve dry powder for opportunities
- Avoid illiquid pairs
- Size positions for market depth
- Plan for market stress

**Leverage Management:**
- Maximum leverage limits
- Volatility-based leverage adjustment
- Margin requirements monitoring
- Automatic deleveraging triggers

### FORWARD TESTING PROTOCOLS

**Paper Trading Requirements:**
- Minimum 3 months paper trading
- Track metrics same as live
- Document all trades
- Compare to backtest expectations

**Gradual Deployment:**
- Start with 10% position size
- Double every week if no issues
- Full size at 4-8 weeks
- Requires consistent performance

**Live Monitoring:**
- Real-time performance tracking
- Alert on metric deviations
- Daily/weekly performance reports
- Automatic shutdown triggers

**Continuous Improvement:**
- Regular strategy reviews
- Performance attribution analysis
- Parameter adjustment process
- Strategy retirement criteria
`;

      if (ctx?.fileName) systemPrompt += `\nUser is working on file: ${ctx.fileName}`;
      if (ctx?.lineNumber) systemPrompt += `\nCursor is at line: ${ctx.lineNumber}`;
      if (ctx?.cursorFunctionName) systemPrompt += `\nCursor is inside function: ${ctx.cursorFunctionName}`;
      if (ctx?.selectedCode) systemPrompt += `\n\nSelected code:\n\`\`\`\n${clampText(ctx.selectedCode, 6000)}\n\`\`\``;
      if (ctx?.fileContent) systemPrompt += `\n\nFile content:\n\`\`\`\n${clampText(ctx.fileContent, 22000)}\n\`\`\``;

      let aiResponse: string | null = null;
      try {
        aiResponse = await callOpenRouterChat({ model, system: systemPrompt, user: message, maxTokens: 8000 });
      } catch (e: any) {
        const msg = String(e?.message || e || "AI request failed");
        return res.status(502).json({ message: msg });
      }

      const cleaned = typeof aiResponse === "string" ? aiResponse.trim() : "";
      if (!cleaned) {
        return res.status(502).json({
          message: "AI provider returned an empty response",
          details: { model },
        });
      }

      res.json({ response: cleaned });
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

      enqueueDiagnosticJob(jobId).catch((err) => {
        console.error("enqueueDiagnosticJob failed:", err);
      });
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

      enqueueDiagnosticLoopRun(runId).catch((err) => {
        console.error("enqueueDiagnosticLoopRun failed:", err);
      });
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

  // === AI Refinement Loop Endpoints ===
  app.post(api.refinement.start.path, async (req, res) => {
    try {
      const input = api.refinement.start.input.parse(req.body);
      const { strategyPath } = input;
      if (!strategyPath.startsWith("user_data/strategies/")) {
        return res.status(400).json({ message: "strategyPath must be under user_data/strategies/" });
      }
      resolvePathWithinProject(strategyPath);

      const runId = uuidv4();
      const baseConfig = {
        ...(input.baseConfig && typeof input.baseConfig === "object" ? input.baseConfig : {}),
        ...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}),
      };
      const rolling = input.rolling && typeof input.rolling === "object" ? input.rolling : { windowDays: 30, stepDays: 30, count: 4 };
      const model = typeof input.model === "string" ? input.model : undefined;

      await storage.createAiRefinementRun({
        id: runId,
        strategyPath,
        baseConfig,
        rolling,
        model: model ?? null,
        status: "queued",
        progress: { percent: 0, iteration: 0, stage: "queued", step: "queued" } as RefinementProgress,
      } as any);

      enqueueRefinementRun(runId).catch((err) => {
        console.error("enqueueRefinementRun failed:", err);
      });
      return res.status(202).json({ runId, status: "queued" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
      }
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(api.refinement.runs.path, async (req, res) => {
    const runs = await storage.getAiRefinementRuns();
    res.json(runs);
  });

  app.get(api.refinement.run.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getAiRefinementRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    const iterations = await storage.getAiRefinementIterations(runId);
    res.json({ ...run, iterations });
  });

  app.post(api.refinement.stop.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getAiRefinementRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });

    refinementStopRequests.add(runId);
    if (String((run as any).status) === "queued") {
      await storage.updateAiRefinementRun(runId, {
        status: "stopped",
        stopReason: "stop_requested",
        finishedAt: new Date(),
        progress: { percent: 100, iteration: 0, stage: "stopped", step: "stop_requested" } as RefinementProgress,
      } as any);
    } else {
      await storage.updateAiRefinementRun(runId, {
        progress: { ...((run as any).progress || {}), step: "stop_requested" } as any,
      } as any);
    }
    res.json({ success: true });
  });

  app.post(api.refinement.resume.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getAiRefinementRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });

    const status = String((run as any).status || "");
    if (status === "completed") return res.status(400).json({ message: "Run is already completed" });
    if (status === "running" || status === "queued") return res.json({ success: true, status });

    refinementStopRequests.delete(runId);

    await storage.updateAiRefinementRun(runId, {
      status: "queued",
      stopReason: null,
      finishedAt: null,
      progress: { ...(((run as any).progress || {}) as any), stage: "queued", step: "resume" } as any,
    } as any);

    enqueueRefinementRun(runId).catch((err) => {
      console.error("enqueueRefinementRun failed:", err);
    });
    return res.json({ success: true, status: "queued" });
  });

  app.post(api.refinement.rerunBaseline.path, async (req, res) => {
    const sourceRunId = String(req.params.runId);
    const run = await storage.getAiRefinementRun(sourceRunId);
    if (!run) return res.status(404).json({ message: "Run not found" });

    const status = String((run as any).status || "");
    if (status === "running" || status === "queued") {
      return res.status(400).json({ message: "Run must not be running to rerun baseline" });
    }

    const report = (run as any).report && typeof (run as any).report === "object" ? (run as any).report : null;
    const baseline = report?.baselineSnapshots && typeof report.baselineSnapshots === "object" ? report.baselineSnapshots : null;
    const baselineStrategy = baseline && typeof baseline.strategy === "string" ? String(baseline.strategy) : "";
    const baselineConfig = baseline && typeof baseline.config === "string" ? String(baseline.config) : "";

    if (!baselineStrategy || !baselineConfig) {
      return res.status(400).json({ message: "Baseline snapshots not found for this run" });
    }

    try {
      await restoreStrategySnapshotFromFile(String((run as any).strategyPath || ""), baselineStrategy);
      await restoreConfigSnapshotFromFile(baselineConfig);
    } catch (e: any) {
      return res.status(400).json({ message: e?.message || String(e) });
    }

    const newRunId = uuidv4();
    await storage.createAiRefinementRun({
      id: newRunId,
      strategyPath: String((run as any).strategyPath || ""),
      baseConfig: (run as any).baseConfig && typeof (run as any).baseConfig === "object" ? (run as any).baseConfig : {},
      rolling: (run as any).rolling && typeof (run as any).rolling === "object" ? (run as any).rolling : { windowDays: 30, stepDays: 30, count: 4 },
      model: typeof (run as any).model === "string" ? (run as any).model : null,
      status: "queued",
      progress: { percent: 0, iteration: 0, stage: "queued", step: "queued" } as RefinementProgress,
    } as any);

    enqueueRefinementRun(newRunId).catch((err) => {
      console.error("enqueueRefinementRun failed:", err);
    });
    return res.status(202).json({ runId: newRunId, status: "queued" });
  });

  app.get(api.refinement.report.path, async (req, res) => {
    const runId = String(req.params.runId);
    const run = await storage.getAiRefinementRun(runId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    if (!(run as any).report) return res.status(404).json({ message: "Report not ready" });
    res.json((run as any).report);
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
      } catch (e) {
        // ignore
        logOnce("coverage:exchangeName", "Failed to read exchange name from config.json; defaulting to binance", e);
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
          } catch (e) {
            logOnce("coverage:checks", "Coverage checks failed", e);
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
  // === Freqtrade Utilities ===
  app.get("/api/freqtrade/version", async (_req, res) => {
    const projectRoot = process.cwd();
    const venvBin = path.join(projectRoot, ".venv", "bin");
    const freqtradeBin = path.join(venvBin, "freqtrade");
    const env = {
      ...process.env,
      VIRTUAL_ENV: path.join(projectRoot, ".venv"),
      PATH: process.env.PATH ? `${venvBin}:${process.env.PATH}` : venvBin,
    };

    let output = "";
    const maxChars = 50_000;
    const killAfterMs = 10_000;

    try {
      const proc = spawn(freqtradeBin, ["--version"], { cwd: projectRoot, env, shell: false });

      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, killAfterMs);

      const append = (chunk: unknown) => {
        if (output.length >= maxChars) return;
        output += String(chunk ?? "");
        if (output.length > maxChars) output = `${output.slice(0, maxChars)}\n...(truncated)\n`;
      };

      proc.stdout.on("data", append);
      proc.stderr.on("data", append);

      proc.on("close", (code) => {
        clearTimeout(killTimer);
        res.json({ ok: code === 0, output: output.trim() || "", code });
      });
    } catch (e: any) {
      res.status(200).json({ ok: false, output: e?.message || "Failed to execute freqtrade", code: 1 });
    }
  });

  // Deprecated: left in place so older clients fail closed without any execution.
  app.post("/api/cmd", async (_req, res) => {
    return res.status(410).json({
      message: "Deprecated. Use /api/freqtrade/version or dedicated APIs (backtests, download-data, diagnostics).",
    });
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

    // CRITICAL: Check if strategy file exists before proceeding
    const strategyAbs = resolvePathWithinProject(strategyPath);
    try {
      await fs.access(strategyAbs);
    } catch (e) {
      const errorMsg = `✗ Strategy file not found: ${strategyPath}`;
      console.error(`Backtest ${backtestId} failed:`, errorMsg);
      await storage.appendBacktestLog(backtestId, `\n${errorMsg}\n`);
      await storage.updateBacktestStatus(backtestId, "failed");
      await storage.updateBacktestError(backtestId, errorMsg);
      return;
    }

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
    } catch (e) {
      const errorMsg = `Failed to read user_data/config.json: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`Backtest ${backtestId} failed:`, errorMsg);
      await storage.appendBacktestLog(backtestId, `\n✗ ${errorMsg}\n`);
      await storage.updateBacktestStatus(backtestId, "failed");
      await storage.updateBacktestError(backtestId, errorMsg);
      return;
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
    } catch (e) {
      // best-effort
      logOnce(`backtest:${backtestId}:pairs-log`, "Failed to append pairs selected log", e);
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

    let stderrOutput = "";

    proc.stdout.on("data", (data) => {
      const filtered = filterFreqtradeStdoutChunk(data.toString());
      if (filtered) {
        storage.appendBacktestLog(backtestId, filtered);
      }
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderrOutput += chunk;
      const filtered = filterFreqtradeStderrChunk(chunk);
      if (filtered) {
        storage.appendBacktestLog(backtestId, filtered);
      }
    });

    proc.on("error", async (err) => {
      const errorMsg = `Failed to start backtest process: ${err.message}`;
      console.error(`Backtest ${backtestId} error:`, errorMsg);
      await storage.appendBacktestLog(backtestId, `\n✗ ${errorMsg}\n`);
      await storage.updateBacktestStatus(backtestId, "failed");
      await storage.updateBacktestError(backtestId, errorMsg);
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
              const errorMsg = `Failed to parse backtest results. Exit code ${pyCode}`;
              await storage.appendBacktestLog(backtestId, `\n✗ ${errorMsg}\n`);
              if (pyErr) await storage.appendBacktestLog(backtestId, `${pyErr}\n`);
              await storage.updateBacktestStatus(backtestId, "failed");
              await storage.updateBacktestError(backtestId, `${errorMsg}: ${pyErr}`);
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
                  fee_open: Number(t?.fee_open ?? 0),
                  fee_close: Number(t?.fee_close ?? 0),
                  funding_fees: Number(t?.funding_fees ?? 0),
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
