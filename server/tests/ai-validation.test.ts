import { describe, it, expect, stringContaining } from '../../script/testkit';
import { z } from 'zod';

/**
 * Server-side AI response validation tests
 * These tests mirror the client-side validation to ensure consistency
 */

// Mirror of client-side validation for server use
const AnalysisSchema = z.object({
  summary: z.array(z.string()).min(1).max(8),
  metrics_used: z.array(z.string()).optional(),
  metrics_to_recommendation_mapping: z.array(z.string()).min(1).max(12),
  next_experiments: z.array(z.string()).min(1).max(6),
  questions: z.array(z.string()).optional(),
  actions: z.array(
    z.object({
      action: z.enum(["run_backtest", "run_batch_backtest", "run_diagnostic"]),
      payload: z.any(),
      label: z.string().optional(),
    })
  ).optional(),
}).strict();

const ActionSchema = z.object({
  action: z.enum(["run_backtest", "run_batch_backtest", "run_diagnostic"]),
  payload: z.any(),
  label: z.string().optional(),
});

describe('Server AI Response Validation', () => {
  describe('AnalysisSchema', () => {
    it('should validate correct analysis structure', () => {
      const valid = {
        summary: ['Test summary'],
        metrics_to_recommendation_mapping: ['profit_total_pct -> fix this'],
        next_experiments: ['Try better stops'],
      };
      expect(() => AnalysisSchema.parse(valid)).not.toThrow();
    });

    it('should reject analysis with too many summaries', () => {
      const invalid = {
        summary: Array(9).fill('too many'),
        metrics_to_recommendation_mapping: ['a -> b'],
        next_experiments: ['test'],
      };
      expect(() => AnalysisSchema.parse(invalid)).toThrow();
    });

    it('should reject analysis with empty summaries', () => {
      const invalid = {
        summary: [],
        metrics_to_recommendation_mapping: ['a -> b'],
        next_experiments: ['test'],
      };
      expect(() => AnalysisSchema.parse(invalid)).toThrow();
    });

    it('should validate actions with valid types', () => {
      const valid = {
        summary: ['Test'],
        metrics_to_recommendation_mapping: ['a -> b'],
        next_experiments: ['test'],
        actions: [
          { action: 'run_backtest', payload: {} },
          { action: 'run_diagnostic', payload: { backtestId: 1 }, label: 'Run' },
        ],
      };
      expect(() => AnalysisSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid action types', () => {
      const invalid = {
        summary: ['Test'],
        metrics_to_recommendation_mapping: ['a -> b'],
        next_experiments: ['test'],
        actions: [{ action: 'invalid_action', payload: {} }],
      };
      expect(() => AnalysisSchema.parse(invalid)).toThrow();
    });
  });

  describe('ActionSchema', () => {
    it('should require valid action types only', () => {
      expect(() => ActionSchema.parse({ action: 'run_backtest', payload: {} })).not.toThrow();
      expect(() => ActionSchema.parse({ action: 'run_batch_backtest', payload: {} })).not.toThrow();
      expect(() => ActionSchema.parse({ action: 'run_diagnostic', payload: {} })).not.toThrow();
      expect(() => ActionSchema.parse({ action: 'invalid', payload: {} })).toThrow();
    });

    it('should allow optional label', () => {
      const withLabel = { action: 'run_backtest', payload: {}, label: 'Quick Backtest' };
      const withoutLabel = { action: 'run_backtest', payload: {} };
      
      expect(() => ActionSchema.parse(withLabel)).not.toThrow();
      expect(() => ActionSchema.parse(withoutLabel)).not.toThrow();
    });
  });
});

/**
 * Validation helper for server-side use
 */
export function validateServerAIResponse(
  data: unknown,
  allowedMetricKeys: string[]
): { valid: boolean; sanitized?: any; errors?: string[] } {
  const errors: string[] = [];
  
  // Parse with schema
  const parseResult = AnalysisSchema.safeParse(data);
  if (!parseResult.success) {
    errors.push(...parseResult.error.errors.map(e => e.message));
    return { valid: false, errors };
  }
  
  const analysis = parseResult.data;
  
  // Check metrics_used only contains allowed keys
  if (analysis.metrics_used) {
    const invalidMetrics = analysis.metrics_used.filter(k => !allowedMetricKeys.includes(k));
    if (invalidMetrics.length > 0) {
      errors.push(`Unknown metrics: ${invalidMetrics.join(', ')}`);
    }
  }
  
  // Validate actions
  if (analysis.actions) {
    for (const action of analysis.actions) {
      const actionResult = ActionSchema.safeParse(action);
      if (!actionResult.success) {
        errors.push(`Invalid action: ${actionResult.error.errors[0].message}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    sanitized: analysis,
    errors: errors.length > 0 ? errors : undefined,
  };
}

describe('validateServerAIResponse', () => {
  it('should validate correct response', () => {
    const response = {
      summary: ['Good backtest'],
      metrics_to_recommendation_mapping: ['profit_total_pct -> improve entries'],
      next_experiments: ['Test different stops'],
      actions: [{ action: 'run_backtest', payload: { strategyName: 'Test' } }],
    };
    
    const result = validateServerAIResponse(response, ['profit_total_pct', 'win_rate']);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should catch unknown metrics', () => {
    const response = {
      summary: ['Test'],
      metrics_to_recommendation_mapping: ['unknown_metric -> do something'],
      next_experiments: ['test'],
      metrics_used: ['unknown_metric'],
    };
    
    const result = validateServerAIResponse(response, ['profit_total_pct']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(stringContaining('Unknown metrics'));
  });

  it('should catch invalid actions', () => {
    const response = {
      summary: ['Test'],
      metrics_to_recommendation_mapping: ['a -> b'],
      next_experiments: ['test'],
      actions: [{ action: 'invalid_action', payload: {} }],
    };
    
    const result = validateServerAIResponse(response, []);
    expect(result.valid).toBe(false);
  });
});
