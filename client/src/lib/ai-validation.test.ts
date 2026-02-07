import { describe, it, expect } from '../../../script/testkit';
import { extractFirstJsonObject, isSafeAnalysisText, containsPercentLiteral } from './ai-validation';

describe('AI Response Validation', () => {
  describe('extractFirstJsonObject', () => {
    it('should extract JSON from markdown code blocks', () => {
      const text = '```json\n{"summary": ["test"], "metrics_to_recommendation_mapping": ["a -> b"]}\n```';
      const result = extractFirstJsonObject(text);
      expect(result).toEqual({
        summary: ['test'],
        metrics_to_recommendation_mapping: ['a -> b']
      });
    });

    it('should extract JSON from plain text', () => {
      const text = 'Some text before {"summary": ["test"], "next_experiments": ["exp1"]} and after';
      const result = extractFirstJsonObject(text);
      expect(result).toEqual({
        summary: ['test'],
        next_experiments: ['exp1']
      });
    });

    it('should return null for invalid JSON', () => {
      const text = '```json\n{invalid json}\n```';
      const result = extractFirstJsonObject(text);
      expect(result).toBeNull();
    });

    it('should return null when no JSON found', () => {
      const text = 'Just plain text without any JSON';
      const result = extractFirstJsonObject(text);
      expect(result).toBeNull();
    });
  });

  describe('containsPercentLiteral', () => {
    it('should detect percentages in text', () => {
      expect(containsPercentLiteral('Profit is 25%')).toBe(true);
      expect(containsPercentLiteral('Value: -12.5%')).toBe(true);
      expect(containsPercentLiteral('No percentage here')).toBe(false);
    });
  });

  describe('isSafeAnalysisText', () => {
    it('should reject text with hallucinated percentages', () => {
      const data = {
        summary: ['Profit increased by 25%'],
        metrics_to_recommendation_mapping: ['metric -> do something'],
        next_experiments: ['Try this']
      };
      expect(isSafeAnalysisText(data)).toBe(false);
    });

    it('should accept text without percentages', () => {
      const data = {
        summary: ['Profit increased'],
        metrics_to_recommendation_mapping: ['metric_key -> recommendation'],
        next_experiments: ['Try this']
      };
      expect(isSafeAnalysisText(data)).toBe(true);
    });

    it('should handle missing fields', () => {
      expect(isSafeAnalysisText({})).toBe(true);
      expect(isSafeAnalysisText(null)).toBe(false);
    });
  });
});
