/**
 * PIR Manchester SP - Reward Orchestrator
 *
 * Orchestrates calculation of rewards across all 5 categories.
 * Uses Cloudflare Workers AI to score triage session outcomes for RRE learning.
 */

import {
  RewardComponent,
  RewardContext,
  RewardResult,
  CategoryScore,
  PerformanceMetrics,
  normalizeScore,
  determineOutcome,
  calculateWeightedScore,
  REWARD_AI_MODELS
} from '../types/rewards';
import { BaseRewardCalculator } from '../calculators/base-calculator';
import {
  ClassificationAccuracyCalculator,
  DeadlineAdherenceCalculator,
  PatientSafetyCalculator,
  ResourceEfficiencyCalculator,
  PatternDetectionCalculator
} from '../calculators/reward-calculators';

export class RewardOrchestrator {
  private ai: Ai;
  private calculators: Map<string, BaseRewardCalculator> = new Map();
  private results: Map<string, RewardResult> = new Map();
  private components: RewardComponent[];

  constructor(ai: Ai, components: RewardComponent[]) {
    this.ai = ai;
    this.components = components;
    this.initializeCalculators();
  }

  /**
   * Initialize calculators for all reward components
   */
  private initializeCalculators(): void {
    for (const component of this.components) {
      const calculator = this.createCalculator(component);
      if (calculator) {
        this.calculators.set(component.category, calculator);
      }
    }
  }

  /**
   * Factory method to create appropriate calculator
   */
  private createCalculator(component: RewardComponent): BaseRewardCalculator | null {
    const config = { component, useAI: true };

    switch (component.category) {
      case 'classification_accuracy':
        return new ClassificationAccuracyCalculator(this.ai, config);

      case 'deadline_adherence':
        return new DeadlineAdherenceCalculator(this.ai, config);

      case 'patient_safety':
        return new PatientSafetyCalculator(this.ai, config);

      case 'resource_efficiency':
        return new ResourceEfficiencyCalculator(this.ai, config);

      case 'pattern_detection':
        return new PatternDetectionCalculator(this.ai, config);

      default:
        console.warn(`[RewardOrchestrator] No calculator for category: ${component.category}`);
        return null;
    }
  }

  /**
   * Calculate rewards for a completed triage session
   */
  async calculateRewards(context: RewardContext): Promise<RewardResult> {
    const startTime = Date.now();

    try {
      // Calculate score for each category in parallel
      const categoryPromises = Array.from(this.calculators.entries()).map(
        async ([category, calculator]) => {
          try {
            return await calculator.calculate(context);
          } catch (error) {
            console.error(`[RewardOrchestrator] Error calculating ${category}:`, error);

            // Return neutral score on error
            const component = this.components.find(c => c.category === category)!;
            return {
              category: category as any,
              weight: component.weight,
              raw_score: 0,
              weighted_score: 0,
              reasoning: `Error calculating ${category}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              positive_factors: [],
              negative_factors: []
            };
          }
        }
      );

      const categoryScores = await Promise.all(categoryPromises);

      // Calculate overall score
      const overallScore = calculateWeightedScore(categoryScores);
      const normalizedScore = normalizeScore(overallScore);
      const outcomeType = determineOutcome(overallScore);

      // Extract learning signals for RRE
      const learningSignals = this.extractLearningSignals(context, categoryScores);

      // Anonymize features for RRE aggregation
      const anonymizedFeatures = this.anonymizeFeatures(context);

      // Determine if should aggregate to RRE
      const aggregateToRRE = this.shouldAggregateToRRE(context, outcomeType);

      const result: RewardResult = {
        session_id: context.session_id,
        timestamp: context.timestamp,
        overall_score: overallScore,
        normalized_score: normalizedScore,
        outcome_type: outcomeType,
        category_scores: categoryScores,
        learning_signals: learningSignals,
        aggregate_to_rre: aggregateToRRE,
        anonymized_features: anonymizedFeatures,
        execution_time_ms: Date.now() - startTime,
        model_used: REWARD_AI_MODELS.REASONING
      };

      // Store result
      this.results.set(context.session_id, result);

      return result;

    } catch (error) {
      console.error('[RewardOrchestrator] Error calculating rewards:', error);

      // Return error result
      return {
        session_id: context.session_id,
        timestamp: context.timestamp,
        overall_score: 0,
        normalized_score: 50,
        outcome_type: 'neutral',
        category_scores: [],
        learning_signals: {},
        aggregate_to_rre: false,
        execution_time_ms: Date.now() - startTime,
        model_used: undefined
      };
    }
  }

  /**
   * Extract learning signals for RRE
   */
  private extractLearningSignals(
    context: RewardContext,
    categoryScores: CategoryScore[]
  ): RewardResult['learning_signals'] {
    const signals: RewardResult['learning_signals'] = {};

    // Classification feedback
    if (context.initial_classification && context.actual_diagnosis) {
      signals.classification_feedback = {
        predicted: context.initial_classification,
        actual: context.final_classification || context.actual_diagnosis,
        correct: context.clinical_accuracy || false
      };
    }

    // Pattern matches (correctly identified patterns)
    const patternScore = categoryScores.find(s => s.category === 'pattern_detection');
    if (patternScore && patternScore.raw_score > 0.3) {
      signals.pattern_matches = patternScore.positive_factors;
    }

    // Pattern misses (patterns that should have been detected)
    if (patternScore && patternScore.raw_score < -0.3) {
      signals.pattern_misses = patternScore.negative_factors;
    }

    // Optimal actions (actions that led to good outcomes)
    const optimalActions: string[] = [];
    if (context.clinical_accuracy) {
      optimalActions.push('correct_classification');
    }
    if (context.deadlines_met.length > context.deadlines_missed.length) {
      optimalActions.push('deadline_adherence');
    }
    if (context.guards_triggered.length > 0) {
      optimalActions.push('guard_activation');
    }
    if (context.priority_flow_activated) {
      optimalActions.push(`priority_flow_${context.priority_flow_activated}`);
    }
    signals.optimal_actions = optimalActions;

    // Suboptimal actions (actions to avoid)
    const suboptimalActions: string[] = [];
    if (context.clinical_accuracy === false) {
      suboptimalActions.push('incorrect_classification');
    }
    if (context.deadlines_missed.length > 0) {
      suboptimalActions.push('deadline_violations');
    }
    if (context.adverse_events && context.adverse_events.length > 0) {
      suboptimalActions.push('safety_incidents');
    }
    if (context.guard_overrides) {
      const errors = context.guard_overrides.filter(o => o.outcome === 'error');
      if (errors.length > 0) {
        suboptimalActions.push('inappropriate_guard_overrides');
      }
    }
    signals.suboptimal_actions = suboptimalActions;

    return signals;
  }

  /**
   * Anonymize features for RRE aggregation (LGPD compliance)
   */
  private anonymizeFeatures(context: RewardContext): Record<string, any> {
    // Remove all PHI (Protected Health Information)
    // Keep only statistical/pattern features
    return {
      classification: context.initial_classification,
      flowchart: context.initial_flowchart,
      priority_flow: context.priority_flow_activated,
      num_guards_triggered: context.guards_triggered.length,
      num_tasks_executed: context.tasks_executed.length,
      num_deadlines_met: context.deadlines_met.length,
      num_deadlines_missed: context.deadlines_missed.length,
      triage_time_ms: context.total_triage_time_ms,
      time_to_physician_ms: context.time_to_physician_ms,
      treatment_outcome: context.treatment_outcome,
      clinical_accuracy: context.clinical_accuracy,
      had_adverse_events: (context.adverse_events?.length || 0) > 0,
      had_near_misses: (context.near_misses?.length || 0) > 0,
      num_guard_overrides: context.guard_overrides?.length || 0,
      patient_satisfaction: context.patient_satisfaction
      // NO PHI: no patient_id, no slot values, no specific diagnoses
    };
  }

  /**
   * Determine if session should be aggregated to RRE for learning
   */
  private shouldAggregateToRRE(context: RewardContext, outcomeType: string): boolean {
    // Aggregate positive outcomes (learn from success)
    if (outcomeType === 'positive') {
      return true;
    }

    // Aggregate negative outcomes (learn from errors)
    if (outcomeType === 'negative') {
      return true;
    }

    // Aggregate priority flows (always learn from critical cases)
    if (context.priority_flow_activated) {
      return true;
    }

    // Aggregate cases with guards triggered (interesting patterns)
    if (context.guards_triggered.length > 0) {
      return true;
    }

    // Don't aggregate neutral, routine cases
    return false;
  }

  /**
   * Get reward result for a session
   */
  getResult(sessionId: string): RewardResult | undefined {
    return this.results.get(sessionId);
  }

  /**
   * Calculate aggregated performance metrics over multiple sessions
   */
  async calculatePerformanceMetrics(
    sessionIds: string[],
    timePeriod: { start: string; end: string }
  ): Promise<PerformanceMetrics> {
    const sessions = sessionIds
      .map(id => this.results.get(id))
      .filter(Boolean) as RewardResult[];

    if (sessions.length === 0) {
      return this.getEmptyMetrics(timePeriod);
    }

    // Calculate average scores
    const averageOverall = sessions.reduce((sum, s) => sum + s.overall_score, 0) / sessions.length;

    const averageByCategory: Record<string, number> = {};
    for (const category of ['classification_accuracy', 'deadline_adherence', 'patient_safety', 'resource_efficiency', 'pattern_detection'] as const) {
      const scores = sessions
        .flatMap(s => s.category_scores)
        .filter(cs => cs.category === category)
        .map(cs => cs.raw_score);

      averageByCategory[category] = scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 0;
    }

    // Classification accuracy breakdown
    const classificationData = sessions
      .map(s => s.learning_signals.classification_feedback)
      .filter(Boolean) as Array<{ predicted: string; actual: string; correct: boolean }>;

    const totalClassifications = classificationData.length;
    const correctClassifications = classificationData.filter(c => c.correct).length;

    const byColor: Record<string, { correct: number; total: number; percentage: number }> = {};
    for (const color of ['vermelho', 'laranja', 'amarelo', 'verde', 'azul']) {
      const colorData = classificationData.filter(c => c.predicted === color);
      const colorCorrect = colorData.filter(c => c.correct).length;

      byColor[color] = {
        correct: colorCorrect,
        total: colorData.length,
        percentage: colorData.length > 0 ? (colorCorrect / colorData.length) * 100 : 0
      };
    }

    // Deadline performance
    const allContexts = sessions.map(s => this.getContextForSession(s.session_id)).filter(Boolean);
    const totalDeadlines = allContexts.reduce((sum, ctx) =>
      sum + ctx!.deadlines_met.length + ctx!.deadlines_missed.length, 0
    );
    const totalMet = allContexts.reduce((sum, ctx) => sum + ctx!.deadlines_met.length, 0);
    const totalMissed = allContexts.reduce((sum, ctx) => sum + ctx!.deadlines_missed.length, 0);

    // Patient safety metrics
    const totalAdverseEvents = allContexts.reduce((sum, ctx) =>
      sum + (ctx!.adverse_events?.length || 0), 0
    );
    const totalNearMisses = allContexts.reduce((sum, ctx) =>
      sum + (ctx!.near_misses?.length || 0), 0
    );
    const guardOverrides = allContexts.flatMap(ctx => ctx!.guard_overrides || []);
    const justifiedOverrides = guardOverrides.filter(o => o.outcome === 'justified').length;
    const errorOverrides = guardOverrides.filter(o => o.outcome === 'error').length;

    // Resource efficiency
    const triageTimes = allContexts.map(ctx => ctx!.total_triage_time_ms);
    const avgTriageTime = triageTimes.reduce((sum, t) => sum + t, 0) / triageTimes.length;

    // Pattern detection
    const patternsDetected = {
      sepsis_early_detection: allContexts.filter(ctx =>
        ctx!.guards_triggered.includes('sepsis_early_detection')
      ).length,
      stroke_recognition: allContexts.filter(ctx =>
        ctx!.guards_triggered.includes('stroke_time_window')
      ).length,
      cardiac_ischemia: allContexts.filter(ctx =>
        ctx!.guards_triggered.includes('cardiac_ischemia_alert')
      ).length,
      other: {}
    };

    return {
      time_period: timePeriod,
      total_sessions: sessions.length,
      average_scores: {
        overall: averageOverall,
        by_category: averageByCategory as any
      },
      classification_accuracy: {
        total: totalClassifications,
        correct: correctClassifications,
        percentage: totalClassifications > 0 ? (correctClassifications / totalClassifications) * 100 : 0,
        by_color: byColor
      },
      deadline_performance: {
        total_deadlines: totalDeadlines,
        met: totalMet,
        missed: totalMissed,
        percentage_met: totalDeadlines > 0 ? (totalMet / totalDeadlines) * 100 : 0,
        by_priority: {} // TODO: Implement by_priority breakdown
      },
      patient_safety: {
        adverse_events: totalAdverseEvents,
        near_misses: totalNearMisses,
        guard_overrides_justified: justifiedOverrides,
        guard_overrides_errors: errorOverrides
      },
      resource_efficiency: {
        average_triage_time_ms: avgTriageTime,
        average_exams_per_patient: 0, // TODO: Implement from context
        average_medications_per_patient: 0 // TODO: Implement from context
      },
      patterns_detected: patternsDetected
    };
  }

  /**
   * Get context for a session (stored separately if needed)
   */
  private getContextForSession(sessionId: string): RewardContext | undefined {
    // In production, this would fetch from storage
    // For now, return undefined as contexts aren't stored
    return undefined;
  }

  /**
   * Get empty metrics structure
   */
  private getEmptyMetrics(timePeriod: { start: string; end: string }): PerformanceMetrics {
    return {
      time_period: timePeriod,
      total_sessions: 0,
      average_scores: {
        overall: 0,
        by_category: {
          classification_accuracy: 0,
          deadline_adherence: 0,
          patient_safety: 0,
          resource_efficiency: 0,
          pattern_detection: 0
        }
      },
      classification_accuracy: {
        total: 0,
        correct: 0,
        percentage: 0,
        by_color: {}
      },
      deadline_performance: {
        total_deadlines: 0,
        met: 0,
        missed: 0,
        percentage_met: 0,
        by_priority: {}
      },
      patient_safety: {
        adverse_events: 0,
        near_misses: 0,
        guard_overrides_justified: 0,
        guard_overrides_errors: 0
      },
      resource_efficiency: {
        average_triage_time_ms: 0,
        average_exams_per_patient: 0,
        average_medications_per_patient: 0
      },
      patterns_detected: {
        sepsis_early_detection: 0,
        stroke_recognition: 0,
        cardiac_ischemia: 0,
        other: {}
      }
    };
  }

  /**
   * Clear old results (cleanup)
   */
  clearOldResults(maxAgeMs: number = 86400000): void {
    const now = Date.now();

    for (const [sessionId, result] of this.results.entries()) {
      const resultTime = new Date(result.timestamp).getTime();
      if (now - resultTime > maxAgeMs) {
        this.results.delete(sessionId);
      }
    }
  }
}
