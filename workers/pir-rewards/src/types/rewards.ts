/**
 * PIR Manchester SP - Rewards Types
 *
 * Defines reward/scoring system for RRE (Rhizomatic Reasoning Engine) learning.
 * System learns from successful/unsuccessful triage outcomes to improve over time.
 */

export type RewardCategory =
  | 'classification_accuracy'
  | 'deadline_adherence'
  | 'patient_safety'
  | 'resource_efficiency'
  | 'pattern_detection';

export type OutcomeType = 'positive' | 'negative' | 'neutral';

/**
 * Reward component definition from PIR JSON
 */
export interface RewardComponent {
  category: RewardCategory;
  weight: number; // 0-1, sum should be 1.0
  description: string;
  metrics: {
    positive_indicators: string[];
    negative_indicators: string[];
  };
}

/**
 * Context for reward calculation
 */
export interface RewardContext {
  session_id: string;
  patient_id?: string;
  timestamp: string;

  // Initial state
  initial_classification?: string;
  initial_flowchart?: string;
  priority_flow_activated?: string;

  // Execution data
  slots_extracted: Record<string, any>;
  tasks_executed: string[];
  guards_triggered: string[];
  deadlines_met: string[];
  deadlines_missed: string[];

  // Outcome data
  final_classification?: string;
  actual_diagnosis?: string;
  treatment_outcome?: 'improved' | 'stable' | 'worsened' | 'unknown';
  patient_satisfaction?: number; // 1-5
  clinical_accuracy?: boolean; // Was triage classification correct?

  // Time metrics
  total_triage_time_ms: number;
  time_to_physician_ms?: number;

  // Resource usage
  resources_used?: {
    exams_requested: string[];
    medications_prescribed: string[];
    specialists_consulted: string[];
  };

  // Safety incidents
  adverse_events?: string[];
  near_misses?: string[];
  guard_overrides?: Array<{
    guard_id: string;
    reason: string;
    outcome: 'justified' | 'error';
  }>;
}

/**
 * Individual reward score for a category
 */
export interface CategoryScore {
  category: RewardCategory;
  weight: number;
  raw_score: number; // -1 to 1
  weighted_score: number; // raw_score * weight
  reasoning: string;
  positive_factors: string[];
  negative_factors: string[];
}

/**
 * Complete reward calculation result
 */
export interface RewardResult {
  session_id: string;
  timestamp: string;
  overall_score: number; // -1 to 1 (weighted sum)
  normalized_score: number; // 0 to 100
  outcome_type: OutcomeType;
  category_scores: CategoryScore[];

  // Learning signals for RRE
  learning_signals: {
    classification_feedback?: {
      predicted: string;
      actual: string;
      correct: boolean;
    };
    pattern_matches?: string[]; // Patterns that were correctly identified
    pattern_misses?: string[]; // Patterns that were missed
    optimal_actions?: string[]; // Actions that should be reinforced
    suboptimal_actions?: string[]; // Actions to avoid
  };

  // Aggregation for RRE
  aggregate_to_rre: boolean; // Should this be sent to RRE for learning?
  anonymized_features?: Record<string, any>; // De-identified features for learning

  execution_time_ms: number;
  model_used?: string;
}

/**
 * Aggregated performance metrics (for system-level learning)
 */
export interface PerformanceMetrics {
  time_period: {
    start: string;
    end: string;
  };
  total_sessions: number;

  average_scores: {
    overall: number;
    by_category: Record<RewardCategory, number>;
  };

  classification_accuracy: {
    total: number;
    correct: number;
    percentage: number;
    by_color: Record<string, { correct: number; total: number; percentage: number }>;
  };

  deadline_performance: {
    total_deadlines: number;
    met: number;
    missed: number;
    percentage_met: number;
    by_priority: Record<string, { met: number; total: number }>;
  };

  patient_safety: {
    adverse_events: number;
    near_misses: number;
    guard_overrides_justified: number;
    guard_overrides_errors: number;
  };

  resource_efficiency: {
    average_triage_time_ms: number;
    average_exams_per_patient: number;
    average_medications_per_patient: number;
  };

  patterns_detected: {
    sepsis_early_detection: number;
    stroke_recognition: number;
    cardiac_ischemia: number;
    other: Record<string, number>;
  };
}

/**
 * Workers AI models for reward calculation
 */
export const REWARD_AI_MODELS = {
  REASONING: '@cf/qwen/qwq-32b-preview',
  DEEPSEEK: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
} as const;

/**
 * Helper: Normalize score from [-1, 1] to [0, 100]
 */
export function normalizeScore(score: number): number {
  return Math.round(((score + 1) / 2) * 100 * 100) / 100;
}

/**
 * Helper: Determine outcome type from overall score
 */
export function determineOutcome(score: number): OutcomeType {
  if (score >= 0.3) return 'positive';
  if (score <= -0.3) return 'negative';
  return 'neutral';
}

/**
 * Helper: Calculate weighted sum of category scores
 */
export function calculateWeightedScore(scores: CategoryScore[]): number {
  return scores.reduce((sum, score) => sum + score.weighted_score, 0);
}
