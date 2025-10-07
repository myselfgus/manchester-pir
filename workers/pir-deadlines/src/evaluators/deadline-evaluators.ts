/**
 * PIR Manchester SP - Deadline Evaluators
 *
 * Implements deadline evaluators for Manchester Protocol time windows.
 * Each evaluator monitors specific time-critical workflows.
 */

import { AdaptiveDeadlineEvaluator } from './base-evaluator';

/**
 * Standard deadline evaluator for Manchester classification colors
 *
 * Time windows:
 * - VERMELHO (Red): Immediate
 * - LARANJA (Orange): ≤10 min
 * - AMARELO (Yellow): ≤1 hour
 * - VERDE (Green): ≤2 hours
 * - AZUL (Blue): ≤4 hours
 */
export class ManchesterClassificationDeadlineEvaluator extends AdaptiveDeadlineEvaluator {
  // Implementation uses base class functionality
  // Adaptive behavior handled by base class
}

/**
 * Priority flow deadline evaluator
 *
 * For time-critical clinical pathways:
 * - Chest Pain (MI): Door-to-ECG ≤10 min, Door-to-balloon ≤90 min
 * - Stroke: Door-to-CT ≤25 min, Door-to-needle ≤60 min
 * - Sepsis: Blood cultures + Antibiotics ≤1 hour
 * - Trauma: ATLS primary survey ≤2 min, imaging ≤30 min
 */
export class PriorityFlowDeadlineEvaluator extends AdaptiveDeadlineEvaluator {
  // These deadlines rarely relax (life-threatening)
  // Override shouldRelax to be more restrictive

  protected shouldRelax(instance: any, context: any): boolean {
    // Priority flows should NOT relax even under high load
    // Exception: can relax if multiple critical cases and this is lowest acuity

    const isPriorityFlow = !!instance.context.priority_flow;
    if (!isPriorityFlow) {
      return super.shouldRelax(instance, context);
    }

    // Never relax for:
    // - Stroke within thrombolysis window
    // - Sepsis within 1-hour bundle
    // - Active chest pain with ECG changes
    const neverRelax = [
      'stroke_door_to_needle',
      'sepsis_antibiotic_administration',
      'chest_pain_door_to_ecg'
    ];

    if (neverRelax.includes(this.deadline.id)) {
      return false;
    }

    // For other priority flows, only relax under CRITICAL load
    return instance.load_condition === 'critical' && super.shouldRelax(instance, context);
  }
}

/**
 * Operational deadline evaluator
 *
 * For administrative/operational tasks:
 * - Patient registration
 * - Wristband assignment
 * - Medical records update
 * - Queue management
 *
 * These are more flexible and can relax more easily
 */
export class OperationalDeadlineEvaluator extends AdaptiveDeadlineEvaluator {
  // Operational deadlines are most flexible
  // Can relax even under moderate load

  protected shouldRelax(instance: any, context: any): boolean {
    // Relax if load is HIGH or CRITICAL (not just CRITICAL)
    return instance.load_condition === 'high' || instance.load_condition === 'critical';
  }
}
