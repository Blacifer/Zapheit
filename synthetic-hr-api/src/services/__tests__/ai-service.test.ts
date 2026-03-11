import { calculateTokenCost } from '../ai-service';

describe('AI Service', () => {
  describe('Token Cost Calculation', () => {
    it('should calculate OpenAI GPT-4 costs correctly', () => {
      const cost = calculateTokenCost('openai', 'gpt-4', 100, 200);
      
      // GPT-4: $0.03/1K input, $0.06/1K output
      // Expected: (100/1000 * 0.03) + (200/1000 * 0.06) = 0.003 + 0.012 = 0.015
      expect(cost).toBeCloseTo(0.015, 6);
    });

    it('should calculate Claude-3 costs correctly', () => {
      const cost = calculateTokenCost('anthropic', 'claude-3-sonnet', 1000, 500);
      
      // Claude-3 Sonnet: $0.003/1K input, $0.015/1K output
      // Expected: (1000/1000 * 0.003) + (500/1000 * 0.015) = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('should handle zero tokens', () => {
      const cost = calculateTokenCost('openai', 'gpt-4o', 0, 0);
      expect(cost).toBe(0);
    });

    it('should fallback to default pricing for unknown models', () => {
      const cost = calculateTokenCost('openai', 'unknown-model', 1000, 1000);
      expect(cost).toBeGreaterThan(0);
    });
  });
});
