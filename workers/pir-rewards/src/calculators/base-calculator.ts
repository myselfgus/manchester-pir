/**
 * PIR Manchester SP - Reward Calculators Base Classes
 *
 * Base abstractions for reward calculators that use Cloudflare Workers AI
 * to score triage session outcomes for RRE learning.
 */

import {
  RewardComponent,
  RewardContext,
  CategoryScore,
  RewardCategory,
  REWARD_AI_MODELS
} from '../types/rewards';

export interface RewardCalculatorConfig {
  component: RewardComponent;
  useAI?: boolean;
}

/**
 * Abstract base class for all reward calculators
 */
export abstract class BaseRewardCalculator {
  protected ai: Ai;
  protected config: RewardCalculatorConfig;
  protected component: RewardComponent;

  constructor(ai: Ai, config: RewardCalculatorConfig) {
    this.ai = ai;
    this.config = {
      useAI: true,
      ...config
    };
    this.component = config.component;
  }

  /**
   * Calculate category score
   */
  async calculate(context: RewardContext): Promise<CategoryScore> {
    const startTime = Date.now();

    try {
      // Use AI-driven calculation if enabled
      if (this.config.useAI) {
        return await this.calculateWithAI(context);
      } else {
        return this.calculateRuleBased(context);
      }
    } catch (error) {
      console.error(`[BaseRewardCalculator] Error calculating ${this.component.category}:`, error);

      // Fallback to rule-based
      return this.calculateRuleBased(context);
    }
  }

  /**
   * AI-driven calculation using Workers AI
   */
  protected async calculateWithAI(context: RewardContext): Promise<CategoryScore> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(context);

    const response = await this.ai.run(REWARD_AI_MODELS.REASONING, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    // @ts-ignore - Workers AI types
    const responseText = response.response || '';

    const cleaned = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(cleaned) as {
      raw_score: number;
      reasoning: string;
      positive_factors: string[];
      negative_factors: string[];
    };

    // Clamp score to [-1, 1]
    const rawScore = Math.max(-1, Math.min(1, result.raw_score));

    return {
      category: this.component.category,
      weight: this.component.weight,
      raw_score: rawScore,
      weighted_score: rawScore * this.component.weight,
      reasoning: result.reasoning,
      positive_factors: result.positive_factors,
      negative_factors: result.negative_factors
    };
  }

  /**
   * Rule-based calculation (fallback)
   */
  protected abstract calculateRuleBased(context: RewardContext): CategoryScore;

  /**
   * Get system prompt for AI calculation
   */
  protected abstract getSystemPrompt(): string;

  /**
   * Get user prompt for AI calculation
   */
  protected abstract getUserPrompt(context: RewardContext): string;

  /**
   * Count positive indicators present in context
   */
  protected countPositiveIndicators(context: RewardContext): number {
    let count = 0;
    for (const indicator of this.component.metrics.positive_indicators) {
      if (this.checkIndicator(indicator, context, true)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Count negative indicators present in context
   */
  protected countNegativeIndicators(context: RewardContext): number {
    let count = 0;
    for (const indicator of this.component.metrics.negative_indicators) {
      if (this.checkIndicator(indicator, context, false)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if indicator is present in context
   */
  protected checkIndicator(
    indicator: string,
    context: RewardContext,
    isPositive: boolean
  ): boolean {
    // Simple keyword matching (can be enhanced with more sophisticated logic)
    const lowerIndicator = indicator.toLowerCase();

    if (lowerIndicator.includes('classification') && context.clinical_accuracy !== undefined) {
      return context.clinical_accuracy === isPositive;
    }

    if (lowerIndicator.includes('deadline') && lowerIndicator.includes('met')) {
      return context.deadlines_met.length > 0 === isPositive;
    }

    if (lowerIndicator.includes('deadline') && lowerIndicator.includes('missed')) {
      return context.deadlines_missed.length > 0 !== isPositive;
    }

    if (lowerIndicator.includes('adverse') && context.adverse_events) {
      return context.adverse_events.length > 0 !== isPositive;
    }

    if (lowerIndicator.includes('guard') && lowerIndicator.includes('triggered')) {
      return context.guards_triggered.length > 0 === isPositive;
    }

    return false;
  }

  /**
   * Calculate simple rule-based score from indicators
   */
  protected calculateSimpleScore(positiveCount: number, negativeCount: number, total: number): number {
    if (total === 0) return 0;

    const positiveRatio = positiveCount / total;
    const negativeRatio = negativeCount / total;

    return positiveRatio - negativeRatio;
  }
}

/**
 * AI-driven reward calculator with nuanced evaluation
 */
export abstract class AIRewardCalculator extends BaseRewardCalculator {
  /**
   * Parse LLM response with error handling
   */
  protected parseLLMResponse<T>(response: string): T {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned) as T;
    } catch (error) {
      throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
