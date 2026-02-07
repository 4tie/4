import { api } from "@shared/routes";
import type { ValidationResult } from "../components/diagnostic/StrategyValidationDialog";

export interface ValidationRequest {
  strategyName: string;
  code: string;
  config?: Record<string, any>;
}

export interface InsertionSuggestion {
  type: "filter" | "indicator" | "helper";
  name: string;
  description: string;
  suggestedCode: string;
  insertionPoint: "after_populate_indicators" | "end_of_class" | "specific_line";
  lineNumber?: number;
  confidence: number;
}

export interface DiagnosticChange {
  id: string;
  timestamp: number;
  strategyName: string;
  originalCode: string;
  modifiedCode: string;
  changes: Array<{
    type: string;
    description: string;
    targetLine?: number;
    snippet: string;
  }>;
  validationResult: ValidationResult;
  applied: boolean;
  saved: boolean;
}

/**
 * Validates strategy code on the server and returns suggestions
 */
export async function validateStrategy(request: ValidationRequest): Promise<ValidationResult> {
  const res = await fetch("/api/strategies/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || "Validation failed");
  }

  return res.json();
}

/**
 * Determines the best insertion point for filters/indicators/helpers
 * Heuristic: prefer after populate_indicators, else end of class
 */
export function findInsertionPoint(code: string, type: "filter" | "indicator" | "helper"): {
  insertionPoint: "after_populate_indicators" | "end_of_class" | "specific_line";
  lineNumber: number;
} {
  const lines = code.split("\n");
  
  // Look for populate_indicators method
  let populateIndicatorsEnd = -1;
  let inPopulateIndicators = false;
  let indentLevel = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Detect start of populate_indicators
    if (trimmed.startsWith("def populate_indicators") || trimmed.startsWith("def populate_buy_trend")) {
      inPopulateIndicators = true;
      indentLevel = line.search(/\S/); // Get indentation level
      continue;
    }
    
    // Detect end of populate_indicators (next method or class end at same/higher level)
    if (inPopulateIndicators) {
      if (trimmed === "") continue;
      const currentIndent = line.search(/\S/);
      
      // If we hit another def at same or higher level, populate_indicators ended
      if (trimmed.startsWith("def ") && currentIndent <= indentLevel) {
        populateIndicatorsEnd = i;
        inPopulateIndicators = false;
        break;
      }
      
      // Or if we hit a class definition at higher level
      if (trimmed.startsWith("class ") && currentIndent < indentLevel) {
        populateIndicatorsEnd = i;
        inPopulateIndicators = false;
        break;
      }
    }
  }
  
  // If we found populate_indicators, suggest inserting after it
  if (populateIndicatorsEnd !== -1) {
    // Find the next method after populate_indicators
    for (let i = populateIndicatorsEnd; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("def ")) {
        // Insert before this method, after any blank lines
        let insertLine = i;
        while (insertLine > 0 && lines[insertLine - 1].trim() === "") {
          insertLine--;
        }
        return {
          insertionPoint: "after_populate_indicators",
          lineNumber: insertLine,
        };
      }
    }
  }
  
  // Fallback: find end of class
  let classEnd = -1;
  let classIndent = -1;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith("class ") && trimmed.includes("IStrategy")) {
      classIndent = line.search(/\S/);
      // Find last line of class (next line at same or lower indent, or EOF)
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") continue;
        const currentIndent = lines[j].search(/\S/);
        if (currentIndent <= classIndent) {
          classEnd = j;
          break;
        }
      }
      if (classEnd === -1) classEnd = lines.length;
      break;
    }
  }
  
  return {
    insertionPoint: "end_of_class",
    lineNumber: classEnd !== -1 ? classEnd : lines.length,
  };
}

/**
 * Generates insertion code for filters/indicators/helpers
 */
export function generateInsertionCode(
  type: "filter" | "indicator" | "helper",
  name: string,
  params: Record<string, any> = {}
): string {
  switch (type) {
    case "filter":
      return generateFilterCode(name, params);
    case "indicator":
      return generateIndicatorCode(name, params);
    case "helper":
      return generateHelperCode(name, params);
    default:
      return "";
  }
}

function generateFilterCode(name: string, params: Record<string, any>): string {
  const conditions = params.conditions || [];
  const conditionStr = conditions.map((c: string) => `        ${c}`).join("\n");
  
  return `
    def ${name}(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        ${params.description || "Custom filter"}
        """
${conditionStr}
        return dataframe[dataframe['${name}'] == True]
`.trim();
}

function generateIndicatorCode(name: string, params: Record<string, any>): string {
  const calculation = params.calculation || "# TODO: Add indicator calculation";
  
  return `
        # ${params.description || name}
        dataframe['${name}'] = ${calculation}
`.trim();
}

function generateHelperCode(name: string, params: Record<string, any>): string {
  return `
    def ${name}(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        ${params.description || "Helper method"}
        """
        ${params.code || "pass"}
        return dataframe
`.trim();
}

/**
 * Saves diagnostic change to report JSON
 */
export async function saveDiagnosticChange(change: DiagnosticChange): Promise<void> {
  const res = await fetch("/api/diagnostics/changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(change),
  });

  if (!res.ok) {
    throw new Error("Failed to save diagnostic change");
  }
}

/**
 * Fetches diagnostic changes for a strategy
 */
export async function fetchDiagnosticChanges(strategyName: string): Promise<DiagnosticChange[]> {
  const res = await fetch(`/api/diagnostics/changes?strategy=${encodeURIComponent(strategyName)}`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch diagnostic changes");
  }

  return res.json();
}

/**
 * Gets the strategy code with applied changes for preview
 */
export async function previewStrategyChanges(
  strategyName: string,
  changes: InsertionSuggestion[]
): Promise<string> {
  const res = await fetch("/api/strategies/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      strategyName,
      changes: changes.map(c => ({
        lineNumber: c.lineNumber,
        code: c.suggestedCode,
      })),
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to generate preview");
  }

  const { code } = await res.json();
  return code;
}
