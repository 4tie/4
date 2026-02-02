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
import { BacktestParser } from "./utils/backtest-diagnostic/parser";
import { v4 as uuidv4 } from "uuid";

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

function applyBacktestOverridesToConfig(baseConfig: any, runInput: any) {
  const next = baseConfig && typeof baseConfig === "object" ? JSON.parse(JSON.stringify(baseConfig)) : {};
  const cfg = runInput?.config && typeof runInput.config === "object" ? runInput.config : {};

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

    if (Array.isArray(next.pairlists) && next.pairlists[0] && typeof next.pairlists[0] === "object") {
      next.pairlists[0].pair_whitelist = cfg.pairs;
    }
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

Default Behavior:
- If the user request is vague (e.g. "improve", "what's missing", "why is this bad") and backtest results are provided, you MUST proactively analyze the metrics and explain what is missing / likely wrong (expectancy, drawdown control, trade quality, exit logic, costs/slippage, overfitting).
- If appropriate, propose concrete next steps (parameter changes, additional filters, risk controls) and explain why.

When Providing Code:
- ALWAYS wrap code in markdown blocks with the language identifier (e.g., \`\`\`python).
- Ensure generated code is ready for the "Apply" feature.
- Include necessary imports if they are missing from the context.`;

      systemPrompt += `\n\nConfig Updates:\n- If the user asks to change backtest configuration (strategy name, timeframe, stake, dates, pairs, limits), output a single \`\`\`json code block containing ONLY the keys to change from: strategy, timeframe, stake_amount, max_open_trades, tradable_balance_ratio, stoploss, trailing_stop, trailing_stop_positive, trailing_stop_positive_offset, trailing_only_offset_is_reached, minimal_roi, backtest_date_from, backtest_date_to, pairs. Example:\n\`\`\`json\n{\n  "strategy": "AIStrategy",\n  "timeframe": "5m",\n  "max_open_trades": 2,\n  "stoploss": -0.1,\n  "trailing_stop": true,\n  "trailing_stop_positive": 0.01,\n  "trailing_stop_positive_offset": 0.02,\n  "trailing_only_offset_is_reached": false,\n  "minimal_roi": {}\n}\n\`\`\``;

      systemPrompt += `\n\nExecutable Actions (Optional):\n- If the user asks you to RUN a backtest, validate over different time ranges, or do a multi-range check, you MAY output a single \`\`\`action code block containing JSON with this shape:\n\`\`\`action\n{\n  "action": "run_backtest" | "run_batch_backtest",\n  "payload": { ... }\n}\n\`\`\`\n- For action \"run_backtest\", payload may include:\n  - strategyName (optional)\n  - config: { timeframe, stake_amount, backtest_date_from, backtest_date_to, timerange, pairs, max_open_trades, tradable_balance_ratio, ... }\n- For action \"run_batch_backtest\", payload may include:\n  - strategyName (optional)\n  - baseConfig: { timeframe, stake_amount, pairs, max_open_trades, tradable_balance_ratio, ... }\n  - ranges: [{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}, ...] OR rolling: {"windowDays":90,"stepDays":90,"count":4,"end":"YYYY-MM-DD"}\n- If the user asks for \"validate across time ranges\" but does NOT specify the ranges, default to a rolling plan of 4 windows of 90 days ending today.`;

      systemPrompt += `\n\nTargeted Edits:\n- If the user has selected code, assume they want a targeted replacement. Return a single \`\`\`python code block containing ONLY the updated replacement snippet for the selected block (typically one function), and keep the same function name unless the user explicitly asks to rename it.\n- If the user has NOT selected code but the cursor is inside a function (cursorFunctionName is provided), prefer modifying that function and return ONLY that function definition as a single \`\`\`python code block.`;
      
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
          systemPrompt += `\n\nUser has selected this code (lines starting around ${context.lineNumber || 'unknown'}):\n\`\`\`\n${context.selectedCode}\n\`\`\``;
        }
        if (context.fileContent) {
          systemPrompt += `\n\nFull file content for reference:\n\`\`\`\n${context.fileContent}\n\`\`\``;
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
      }

      systemPrompt += `\n\nWhen providing code suggestions, ALWAYS wrap them in markdown code blocks like: \`\`\`python\n# your code\n\`\`\`.
Use the "Apply" button feature to help the user.
If the user asks to "Explain this", "Optimize this", or "Why is this not working", focus your analysis on the provided selection or the full file context.`;

      const response = await fetch(`${baseUrl}/chat/completions`, {
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

      if (!response.ok) {
        const error = await response.text();
        console.error("OpenRouter error:", error);
        return res.status(500).json({ message: "Failed to get AI response" });
      }

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
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
    const { backtestId, strategyPath } = req.body;
    
    try {
      const parser = new BacktestParser();
      const backtestData = parser.parse(backtestId);
      
      if (!backtestData) {
        return res.status(404).json({ error: "Backtest results not found" });
      }

      let strategyContent = "";
      if (strategyPath) {
        const file = await storage.getFileByPath(strategyPath);
        strategyContent = file?.content || "";
      }

      const phase1 = new Phase1Structural();
      const structuralReport = await phase1.analyze(backtestData, strategyContent);

      const phase2 = new Phase2Performance();
      const performanceReport = phase2.analyze(backtestData);

      const phase3 = new Phase3Drawdown();
      const drawdownRiskReport = phase3.analyze(backtestData);

      const phase4 = new Phase4EntryQuality();
      const entryQualityReport = phase4.analyze(backtestData);

      const phase5 = new Phase5Exit();
      const exitLogicReport = phase5.analyze(backtestData);

      const phase6 = new Phase6Regime();
      const regimeAnalysisReport = await phase6.analyze(backtestData);

      const phase7 = new Phase7Costs();
      const costAnalysisReport = await phase7.analyze(backtestData);

      const phase8 = new Phase8Logic();
      const logicIntegrityReport = phase8.analyze(strategyContent);

      const phase9 = new Phase9Statistics();
      const statisticsReport = phase9.analyze(backtestData);

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

      const reportId = uuidv4();
      const fullReport = {
        metadata: {
          reportId,
          timestamp: new Date().toISOString(),
          backtestId: String(backtestId),
          strategy: strategyPath || "unknown",
          timeframe: backtestData.strategy?.[Object.keys(backtestData.strategy)[0]]?.timeframe || "unknown",
          timerange: "unknown"
        },
        phase1: {
          structuralIntegrity: structuralReport
        },
        phase2: {
          performance: performanceReport
        },
        phase3: {
          drawdownRisk: drawdownRiskReport
        },
        phase4: {
          entryQuality: entryQualityReport
        },
        phase5: {
          exitLogic: exitLogicReport
        },
        phase6: {
          regimeAnalysis: regimeAnalysisReport
        },
        phase7: {
          costAnalysis: costAnalysisReport
        },
        phase8: {
          logicIntegrity: logicIntegrityReport
        },
        phase9: {
          statistics: statisticsReport
        },
        summary: finalSummary
      };

      await storage.createDiagnosticReport({
        reportId,
        backtestId: Number(backtestId),
        strategy: strategyPath || "unknown",
        timeframe: fullReport.metadata.timeframe,
        timerange: fullReport.metadata.timerange,
        report: fullReport
      });

      res.json(fullReport);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/diagnostic/reports/:backtestId", async (req, res) => {
    const reports = await storage.getDiagnosticReports(Number(req.params.backtestId));
    res.json(reports);
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

      proc.on("close", (code) => {
        finish(200, {
          success: code === 0,
          code,
          command,
          output,
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
                }))
                .filter((t: any) => t.pair);

              const total_trades = trades.length;
              const winners = trades.filter((t: any) => Number.isFinite(t.profit_ratio) && t.profit_ratio > 0).length;
              const win_rate = total_trades > 0 ? winners / total_trades : 0;

              const stakeAmount = Number(config?.config?.stake_amount ?? 1000);
              const startEquity = Number.isFinite(stakeAmount) && stakeAmount > 0 ? stakeAmount : 1000;
              let equity = startEquity;
              let peak = startEquity;
              let max_drawdown = 0;

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
                const equityBefore = equity;
                const profitAbs = equityBefore * r;
                const equityAfter = equityBefore * (1 + r);

                (tr as any).equity_before = equityBefore;
                (tr as any).equity_after = equityAfter;
                (tr as any).profit_abs = profitAbs;

                equity = equityAfter;
                if (equity > peak) peak = equity;
                const dd = peak > 0 ? (peak - equity) / peak : 0;
                if (dd > max_drawdown) max_drawdown = dd;

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

              const profit_total = startEquity > 0 ? equity / startEquity - 1 : 0;
              const profit_abs_total = equity - startEquity;

              const results = {
                total_trades,
                win_rate,
                profit_total,
                profit_abs_total,
                max_drawdown,
                start_balance: startEquity,
                end_balance: equity,
                trades,
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
