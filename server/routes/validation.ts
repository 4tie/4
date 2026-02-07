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
    
    // Run validation logic
    const validationResult = await validateStrategyCode(strategyName, code, config);
    
    // Store validation in database
    const validationId = uuidv4();
    let persistWarning: string | null = null;
    try {
      await db.insert(aiStrategyValidations).values({
        validationId,
        strategyName,
        originalCode: code,
        modifiedCode: code,
        changes: validationResult.changes,
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

  // Hard validation: ensure Python code is syntactically valid
  const compileErr = await pythonCompileCheck(strategyName, code);
  if (compileErr) {
    errors.push(compileErr);
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
