/**
 * AI Response Validation Utilities
 * 
 * These functions help validate and sanitize AI responses to prevent:
 * - Hallucinated metrics (percentages/numbers not from the actual data)
 * - Invalid action blocks that don't align with the analysis
 */

/**
 * Extract the first JSON object from text, handling markdown code blocks
 */
export function extractFirstJsonObject(text: string | null): any {
  if (!text) return null;
  
  // Try to find JSON in markdown code blocks
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1]);
    } catch {
      // Continue to try other methods
    }
  }
  
  // Try to find JSON object in plain text
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * Check if text contains literal percentage values (e.g., "25%")
 * This helps detect hallucinated metrics
 */
export function containsPercentLiteral(value: string): boolean {
  return /-?\d+(?:\.\d+)?\s*%/.test(value);
}

/**
 * Check if analysis text is safe (no hallucinated percentages)
 */
export function isSafeAnalysisText(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  
  const fields = [
    ...(Array.isArray(data?.summary) ? data.summary : []),
    ...(Array.isArray(data?.metrics_to_recommendation_mapping) ? data.metrics_to_recommendation_mapping : []),
    ...(Array.isArray(data?.next_experiments) ? data.next_experiments : []),
    ...(Array.isArray(data?.questions) ? data.questions : []),
  ];
  
  return !fields.some((s) => containsPercentLiteral(String(s || '')));
}

/**
 * Validate that actions align with the analysis
 * Actions should only reference metrics that exist in the data
 */
export function validateActionAlignment(
  action: { action: string; payload: any; label?: string },
  allowedMetricKeys: string[]
): { valid: boolean; reason?: string } {
  if (!action || typeof action !== 'object') {
    return { valid: false, reason: 'Invalid action object' };
  }
  
  if (typeof action.action !== 'string' || !action.action) {
    return { valid: false, reason: 'Missing action type' };
  }
  
  // Valid action types
  const validActions = ['run_backtest', 'run_batch_backtest', 'run_diagnostic'];
  if (!validActions.includes(action.action)) {
    return { valid: false, reason: `Unknown action: ${action.action}` };
  }
  
  // Check that payload doesn't reference unknown metrics
  if (action.payload && typeof action.payload === 'object') {
    const payloadStr = JSON.stringify(action.payload);
    
    // Look for metric references in payload
    const metricRefs = payloadStr.match(/\b(profit|win_rate|drawdown|sharpe|sortino)\w*\b/gi) || [];
    
    for (const ref of metricRefs) {
      const key = ref.toLowerCase();
      // Check if this is a known metric key
      const isKnown = allowedMetricKeys.some(k => k.toLowerCase().includes(key) || key.includes(k.toLowerCase()));
      if (!isKnown) {
        return { valid: false, reason: `Action references unknown metric: ${ref}` };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Sanitize AI analysis output to ensure metrics are rendered from actual data
 */
export function sanitizeAnalysisOutput(
  analysis: any,
  metricsJson: Record<string, { value: number | null; unit: string }>
): any {
  if (!analysis || typeof analysis !== 'object') {
    return {
      summary: ['Analysis could not be parsed reliably.'],
      metrics_to_recommendation_mapping: [],
      next_experiments: ['Review the backtest data manually'],
    };
  }
  
  // Filter metrics_used to only include keys that exist
  const allowedMetricKeys = Object.keys(metricsJson);
  const metrics_used = Array.isArray(analysis.metrics_used)
    ? analysis.metrics_used.filter((k: string) => allowedMetricKeys.includes(k))
    : [];
  
  // Filter mapping to only include valid metric keys
  const mapping = Array.isArray(analysis.metrics_to_recommendation_mapping)
    ? analysis.metrics_to_recommendation_mapping.filter((line: string) => {
        const key = String(line || '').split('->')[0]?.trim() || '';
        return allowedMetricKeys.includes(key);
      })
    : [];
  
  return {
    ...analysis,
    metrics_used,
    metrics_to_recommendation_mapping: mapping,
  };
}
