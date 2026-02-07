import express from "express";
import { z } from "zod";
import { db } from "../db";
import { aiStrategyValidations } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { spawn } from "child_process";

const router = express.Router();

// Validation request schema
const validateRequestSchema = z.object({
  strategyName: z.string(),
  code: z.string(),
  config: z.record(z.any()).optional(),
});

// Preview request schema
const previewRequestSchema = z.object({
  strategyName: z.string(),
  changes: z.array(z.object({
    lineNumber: z.number(),
    code: z.string(),
  })),
});

/**
 * POST /api/strategies/validate
 * Validates strategy code and suggests improvements
 */
router.post("/strategies/validate", async (req, res) => {
  try {
    const { strategyName, code, config } = validateRequestSchema.parse(req.body);

    const strategyPath = String(strategyName || "").trim();
    if (!strategyPath.startsWith("user_data/strategies/") || !strategyPath.endsWith(".py")) {
      return res.status(400).json({ message: "strategyName must be a .py file under user_data/strategies/" });
    }

    const codeStr = String(code ?? "");
    if (codeStr.length > 500_000) {
      return res.status(413).json({ message: "Strategy code too large" });
    }
    
    // Run validation logic
    const validationResult = await validateStrategyCode(strategyPath, codeStr, config);
    
    // Store validation in database
    const validationId = uuidv4();
    let persistWarning: string | null = null;
    try {
      await db.insert(aiStrategyValidations).values({
        validationId,
        strategyName: strategyPath,
        originalCode: codeStr,
        modifiedCode: code,
        changes: validationResult.changes,
        edits: validationResult.edits,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        valid: validationResult.valid,
        applied: false,
        saved: false,
      });
    } catch (e: any) {
      const pgCode = String(e?.code || "");
      if (pgCode === "42P01") {
        persistWarning = "Validation history table is missing (ai_strategy_validations). Validation succeeded but was not persisted. Run migrations/db:push to create it.";
        console.warn("[validation] ai_strategy_validations table missing; skipping persistence");
      } else {
        persistWarning = "Validation succeeded but saving validation history failed.";
        console.warn("[validation] Failed to persist validation history:", e);
      }
    }

    const warnings = persistWarning
      ? (Array.isArray(validationResult.warnings) ? [...validationResult.warnings, persistWarning] : [persistWarning])
      : validationResult.warnings;

    res.json({
      validationId,
      valid: validationResult.valid,
      errors: validationResult.errors,
      warnings,
      changes: validationResult.changes,
      edits: validationResult.edits,
    });
  } catch (error) {
    console.error("Validation error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0]?.message || "Invalid request" });
    }
    res.status(500).json({ 
      message: "Validation failed", 
      error: (error as Error).message 
    });
  }
});

/**
 * POST /api/strategies/preview
 * Generates code preview with changes applied
 */
router.post("/strategies/preview", async (req, res) => {
  try {
    const { strategyName, changes } = previewRequestSchema.parse(req.body);
    
    // Get current strategy code
    const file = await db.query.files.findFirst({
      where: (files, { eq }) => eq(files.path, strategyName),
    });
    
    if (!file) {
      return res.status(404).json({ message: "Strategy not found" });
    }
    
    // Apply changes to code
    const modifiedCode = applyChangesToCode(file.content, changes);
    
    res.json({ code: modifiedCode });
  } catch (error) {
    console.error("Preview error:", error);
    res.status(500).json({ 
      message: "Preview generation failed", 
      error: (error as Error).message 
    });
  }
});

/**
 * GET /api/diagnostics/changes
 * Fetch diagnostic changes for a strategy
 */
router.get("/diagnostics/changes", async (req, res) => {
  try {
    const strategy = req.query.strategy as string;
    
    if (!strategy) {
      return res.status(400).json({ message: "Strategy parameter required" });
    }
    
    const changes = await db.query.aiStrategyValidations.findMany({
      where: (validations, { eq }) => eq(validations.strategyName, strategy),
      orderBy: [desc(aiStrategyValidations.createdAt)],
      limit: 50,
    });
    
    res.json(changes);
  } catch (error) {
    console.error("Fetch changes error:", error);
    res.status(500).json({ 
      message: "Failed to fetch changes", 
      error: (error as Error).message 
    });
  }
});

/**
 * POST /api/diagnostics/changes
 * Save diagnostic change
 */
router.post("/diagnostics/changes", async (req, res) => {
  try {
    const change = req.body;
    
    // Update the validation record
    await db.update(aiStrategyValidations)
      .set({
        applied: change.applied,
        saved: change.saved,
        appliedAt: change.applied ? new Date() : undefined,
        savedAt: change.saved ? new Date() : undefined,
      })
      .where(eq(aiStrategyValidations.validationId, change.id));
    
    res.json({ success: true });
  } catch (error) {
    console.error("Save change error:", error);
    res.status(500).json({ 
      message: "Failed to save change", 
      error: (error as Error).message 
    });
  }
});

/**
 * Validates strategy code using heuristics and pattern matching
 */
async function validateStrategyCode(
  strategyName: string, 
  code: string, 
  config?: Record<string, any>
): Promise<any> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const changes: any[] = [];
  const edits: any[] = [];

  // Static lint warnings (lookahead / suspicious patterns)
  if (/\.shift\(\s*-\d+\s*\)/.test(code)) {
    warnings.push("Potential lookahead bias: detected negative shift() usage (shift(-n)).");
  }
  if (/\.shift\(\s*-?1\s*\)/.test(code) && /\benter_long\b|\bbuy\b/.test(code)) {
    warnings.push("Potential lookahead bias: detected shift(±1) usage. Review signal logic to ensure it doesn't use future candles.");
  }
  if (/merge\s*\(|merge_asof\s*\(|merge_ordered\s*\(/.test(code) && !code.includes("merge_informative_pair")) {
    warnings.push("If you merge informative timeframes, prefer merge_informative_pair() to avoid lookahead bias.");
  }

  // Import auto-fix: DataFrame type used without import
  const usesDataFrame = /\bDataFrame\b/.test(code);
  const hasDataFrameImport = /from\s+pandas\s+import\s+DataFrame\b/.test(code) || /\bpandas\s+import\s+DataFrame\b/.test(code);
  if (usesDataFrame && !hasDataFrameImport) {
    changes.push({
      type: "add_helper",
      description: "Add missing import: from pandas import DataFrame",
      snippet: "from pandas import DataFrame",
    });
    edits.push({
      kind: "insert",
      anchor: { kind: "after_imports" },
      content: "from pandas import DataFrame\n",
    });
  }

  // Strategy-wide validation: undefined Parameter references like self.buy_xxx.value
  const paramRefsMap: Record<string, true> = {};
  const refRe = /\bself\.([A-Za-z_][A-Za-z0-9_]*)\.value\b/g;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refRe.exec(code)) !== null) {
    const name = String(refMatch[1] || "").trim();
    if (name) paramRefsMap[name] = true;
  }

  const declaredParamsMap: Record<string, true> = {};
  const declaredRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*\w*Parameter\s*\(/gm;
  let declMatch: RegExpExecArray | null;
  while ((declMatch = declaredRe.exec(code)) !== null) {
    const name = String(declMatch[1] || "").trim();
    if (name) declaredParamsMap[name] = true;
  }

  const paramRefs = Object.keys(paramRefsMap);
  const missingParams = paramRefs.filter((p) => !declaredParamsMap[p]);
  if (missingParams.length > 0) {
    warnings.push(
      `Missing strategy parameters detected: ${missingParams.slice(0, 8).join(", ")}${missingParams.length > 8 ? "…" : ""}. ` +
        "Freqtrade Parameters must be declared (e.g. IntParameter/DecimalParameter).",
    );

    // If we propose Parameter declarations, ensure IntParameter is imported.
    const usesIntParameter = true;
    const hasIntParameterImport = /\bIntParameter\b/.test(code) && /from\s+freqtrade\.strategy\s+import\s+[^\n]*\bIntParameter\b/.test(code);
    if (usesIntParameter && !hasIntParameterImport) {
      changes.push({
        type: "add_helper",
        description: "Add missing import: IntParameter",
        snippet: "from freqtrade.strategy import IntParameter",
      });
      edits.push({
        kind: "insert",
        anchor: { kind: "after_imports" },
        content: "from freqtrade.strategy import IntParameter\n",
      });
    }

    const paramLines = missingParams
      .map((name) => `    ${name} = IntParameter(1, 100, default=20)`)
      .join("\n");
    const declBlock = `\n\n${paramLines}\n`;

    changes.push({
      type: "add_helper",
      description: `Declare missing strategy parameters (${missingParams.length})`,
      snippet: paramLines,
    });
    edits.push({
      kind: "insert",
      anchor: { kind: "heuristic_params" },
      content: declBlock,
    } as any);
  }

  // Hard validation: ensure Python code is syntactically valid
  const compileErr = await pythonCompileCheck(strategyName, code);
  if (compileErr) {
    errors.push(compileErr);
  }

  // Full-file validation: apply suggested edits (dry-run) then compile resulting code.
  if (errors.length === 0 && Array.isArray(edits) && edits.length > 0) {
    try {
      const preview = await applyEditsDryRunToTempFile(strategyName, code, edits);
      const nextContent = typeof (preview as any)?.content === "string" ? String((preview as any).content) : "";
      if (nextContent) {
        const afterErr = await pythonCompileCheck(strategyName, nextContent);
        if (afterErr) {
          errors.push(`Post-edit compile failed: ${afterErr}`);
        }
      }
    } catch (e: any) {
      errors.push(`Post-edit validation failed: ${e?.message || String(e)}`);
    }
  }
  
  // Check for required methods
  if (!code.includes("def populate_indicators") && !code.includes("def populate_buy_trend")) {
    errors.push("Missing required method: populate_indicators or populate_buy_trend");
    const snippet = `def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # TODO: Add your indicators here
        return dataframe`;

    changes.push({
      type: "add_helper",
      description: "Add populate_indicators method",
      snippet,
    });

    edits.push({
      kind: "insert",
      anchor: { kind: "heuristic_indicators" },
      content: `\n\n${snippet}\n`,
    } as any);
  }
  
  // Check for entry signals
  if (!code.includes("enter_long") && !code.includes("buy")) {
    errors.push("Missing entry signal: enter_long or buy column not set");
    changes.push({
      type: "modify_entry",
      description: "Add entry signal logic",
      snippet: `dataframe.loc[conditions, 'enter_long'] = 1`,
    });
  }
  
  // Check for stoploss
  if (!code.includes("stoploss")) {
    warnings.push("No stoploss defined - consider adding risk management");
    changes.push({
      type: "risk_management",
      description: "Add stoploss configuration",
      snippet: `stoploss = -0.10  # 10% stoploss`,
    });
  }
  
  // Check for minimal ROI
  if (!code.includes("minimal_roi")) {
    warnings.push("No minimal_roi defined - consider adding profit targets");
    changes.push({
      type: "risk_management",
      description: "Add minimal ROI configuration",
      snippet: `minimal_roi = {
        "0": 0.10,    # 10% at any duration
        "60": 0.05,   # 5% after 60 minutes
    }`,
    });
  }
  
  // Check for IStrategy inheritance
  if (!code.includes("IStrategy")) {
    errors.push("Strategy class must inherit from IStrategy");
  }
  
  // Generate modified code with changes
  let modifiedCode = code;
  
  // Apply insertion heuristic: prefer after populate_indicators
  const lines = code.split("\n");
  let populateIndicatorsEnd = -1;
  let inPopulateIndicators = false;
  let indentLevel = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith("def populate_indicators") || trimmed.startsWith("def populate_buy_trend")) {
      inPopulateIndicators = true;
      indentLevel = line.search(/\S/);
      continue;
    }
    
    if (inPopulateIndicators) {
      if (trimmed === "") continue;
      const currentIndent = line.search(/\S/);
      
      if (trimmed.startsWith("def ") && currentIndent <= indentLevel) {
        populateIndicatorsEnd = i;
        inPopulateIndicators = false;
        break;
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    changes,
    edits,
  };
}

async function pythonCompileCheck(strategyName: string, code: string): Promise<string | null> {
  const base = path.basename(String(strategyName || "strategy")).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "strategy-validate-"));
  const filePath = path.join(dir, base.endsWith(".py") ? base : `${base}.py`);

  try {
    await fs.writeFile(filePath, code, "utf8");

    const { code: exitCode, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const proc = spawn("python3", ["-m", "py_compile", filePath], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.on("close", (c) => resolve({ code: c, stderr: err }));
      proc.on("error", (e) => resolve({ code: 1, stderr: String((e as Error)?.message || e) }));
    });

    if (exitCode === 0) return null;
    const msg = String(stderr || "Python compile failed").trim();
    return msg ? `Python syntax error: ${msg}` : "Python syntax error";
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function applyEditsDryRunToTempFile(strategyPath: string, code: string, edits: any[]): Promise<{ content: string; diff?: string } | null> {
  const base = path.basename(String(strategyPath || "strategy")).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "strategy-validate-edit-"));
  const filePath = path.join(dir, base.endsWith(".py") ? base : `${base}.py`);

  try {
    await fs.writeFile(filePath, code, "utf8");
    const projectRoot = process.cwd();
    const scriptPath = path.join(projectRoot, "server", "utils", "strategy-ast", "edit_tools.py");

    const payload = JSON.stringify({ edits, dryRun: true });
    const { code: exitCode, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn("python3", [scriptPath, "apply", filePath], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.on("close", (c) => resolve({ code: c, stdout: out, stderr: err }));
      proc.on("error", (e) => resolve({ code: 1, stdout: "", stderr: String((e as Error)?.message || e) }));
      proc.stdin.write(payload);
      proc.stdin.end();
    });

    if (exitCode !== 0) {
      throw new Error(String(stderr || stdout || "Rejected change(s)").trim());
    }

    const parsed = JSON.parse(stdout || "{}") as any;
    const contentOut = typeof parsed?.content === "string" ? String(parsed.content) : "";
    if (!contentOut) return null;
    return { content: contentOut, diff: typeof parsed?.diff === "string" ? String(parsed.diff) : undefined };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Applies changes to code at specified line numbers
 */
function applyChangesToCode(code: string, changes: Array<{ lineNumber: number; code: string }>): string {
  const lines = code.split("\n");
  
  // Sort changes by line number descending to avoid offset issues
  const sortedChanges = [...changes].sort((a, b) => b.lineNumber - a.lineNumber);
  
  for (const change of sortedChanges) {
    const insertLines = change.code.split("\n");
    lines.splice(change.lineNumber, 0, ...insertLines);
  }
  
  return lines.join("\n");
}

export default router;
