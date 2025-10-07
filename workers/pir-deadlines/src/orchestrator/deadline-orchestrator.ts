/**
 * PIR Manchester SP - Deadline Orchestrator
 *
 * Orchestrates monitoring of multiple adaptive deadlines.
 * Uses Cloudflare Workers AI to intelligently manage time windows
 * and adapt to system load.
 */

import {
  Deadline,
  DeadlineContext,
  DeadlineInstance,
  DeadlineCheckResult,
  DeadlineMonitoringSession,
  EscalationResult,
  DEADLINE_AI_MODELS
} from '../types/deadlines';
import { BaseDeadlineEvaluator, AdaptiveDeadlineEvaluator } from '../evaluators/base-evaluator';
import {
  ManchesterClassificationDeadlineEvaluator,
  PriorityFlowDeadlineEvaluator,
  OperationalDeadlineEvaluator
} from '../evaluators/deadline-evaluators';

export class DeadlineOrchestrator {
  private ai: Ai;
  private evaluators: Map<string, BaseDeadlineEvaluator> = new Map();
  private sessions: Map<string, DeadlineMonitoringSession> = new Map();

  constructor(ai: Ai, deadlines: Deadline[]) {
    this.ai = ai;
    this.initializeEvaluators(deadlines);
  }

  /**
   * Initialize evaluators for all deadlines
   */
  private initializeEvaluators(deadlines: Deadline[]): void {
    for (const deadline of deadlines) {
      const evaluator = this.createEvaluator(deadline);
      if (evaluator) {
        this.evaluators.set(deadline.id, evaluator);
      }
    }
  }

  /**
   * Factory method to create appropriate evaluator
   */
  private createEvaluator(deadline: Deadline): BaseDeadlineEvaluator | null {
    const config = { deadline };

    // Determine evaluator type based on deadline characteristics
    if (deadline.applies_to.priority_flow && deadline.applies_to.priority_flow.length > 0) {
      // Priority flow deadlines (chest pain, stroke, sepsis, trauma)
      return new PriorityFlowDeadlineEvaluator(this.ai, config);
    } else if (deadline.applies_to.classification && deadline.applies_to.classification.length > 0) {
      // Manchester classification deadlines (colors)
      return new ManchesterClassificationDeadlineEvaluator(this.ai, config);
    } else {
      // Operational deadlines (registration, wristband, etc.)
      return new OperationalDeadlineEvaluator(this.ai, config);
    }
  }

  /**
   * Start monitoring deadlines for a session
   */
  async startMonitoring(
    sessionId: string,
    context: DeadlineContext
  ): Promise<DeadlineMonitoringSession> {
    const session: DeadlineMonitoringSession = {
      session_id: sessionId,
      status: 'active',
      deadlines_tracked: [],
      deadlines_met: [],
      deadlines_missed: [],
      deadlines_escalated: [],
      started_at: context.timestamp,
      context: {
        patient_id: context.patient_id,
        classification: context.classification
      }
    };

    // Determine which deadlines apply to this session
    const applicableDeadlines = this.getApplicableDeadlines(context);

    // Start tracking each applicable deadline
    for (const deadlineId of applicableDeadlines) {
      const evaluator = this.evaluators.get(deadlineId);
      if (evaluator) {
        const instanceId = `${sessionId}_${deadlineId}`;
        const instance = evaluator.startTracking(instanceId, context);
        session.deadlines_tracked.push(instance);
      }
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Check all active deadlines for a session
   */
  async checkDeadlines(
    sessionId: string,
    context: DeadlineContext
  ): Promise<DeadlineCheckResult[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Monitoring session not found: ${sessionId}`);
    }

    const results: DeadlineCheckResult[] = [];

    // Check each tracked deadline
    for (const instance of session.deadlines_tracked) {
      if (instance.status === 'met' || instance.status === 'escalated') {
        continue; // Skip completed deadlines
      }

      const evaluator = this.evaluators.get(instance.deadline_id);
      if (!evaluator) continue;

      const result = await evaluator.checkDeadline(instance.instance_id, context);
      results.push(result);

      // Handle relaxation if recommended
      if (result.should_relax) {
        evaluator.relaxDeadline(instance.instance_id);
      }

      // Handle escalation if needed
      if (result.should_escalate && !instance.escalation_triggered) {
        const escalationResult = await this.triggerEscalation(instance, context);
        evaluator.markEscalated(instance.instance_id, escalationResult.actions_taken);

        if (!session.deadlines_escalated.includes(instance.deadline_id)) {
          session.deadlines_escalated.push(instance.deadline_id);
        }
      }

      // Track missed deadlines
      if (result.is_overdue && !session.deadlines_missed.includes(instance.deadline_id)) {
        session.deadlines_missed.push(instance.deadline_id);
      }
    }

    // Assess load and adapt if needed
    await this.assessAndAdapt(sessionId, context);

    this.sessions.set(sessionId, session);
    return results;
  }

  /**
   * Mark a deadline as met
   */
  markDeadlineMet(
    sessionId: string,
    deadlineId: string,
    timestamp: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const instanceId = `${sessionId}_${deadlineId}`;
    const evaluator = this.evaluators.get(deadlineId);

    if (evaluator) {
      evaluator.markMet(instanceId, timestamp);

      if (!session.deadlines_met.includes(deadlineId)) {
        session.deadlines_met.push(deadlineId);
      }

      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Complete monitoring session
   */
  completeMonitoring(sessionId: string, timestamp: string): DeadlineMonitoringSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Monitoring session not found: ${sessionId}`);
    }

    session.status = 'completed';
    session.completed_at = timestamp;

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get monitoring session
   */
  getSession(sessionId: string): DeadlineMonitoringSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get applicable deadlines for context
   */
  private getApplicableDeadlines(context: DeadlineContext): string[] {
    const applicable: string[] = [];

    for (const [deadlineId, evaluator] of this.evaluators.entries()) {
      if (evaluator.appliesTo(context)) {
        applicable.push(deadlineId);
      }
    }

    return applicable;
  }

  /**
   * Assess system load and adapt deadlines using Workers AI
   */
  private async assessAndAdapt(
    sessionId: string,
    context: DeadlineContext
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Get active instances
    const activeInstances = session.deadlines_tracked.filter(
      inst => inst.status === 'active' || inst.status === 'relaxed'
    );

    if (activeInstances.length === 0) return;

    // Use first adaptive evaluator to assess load
    // (all share same AI logic)
    const adaptiveEvaluator = Array.from(this.evaluators.values()).find(
      ev => ev instanceof AdaptiveDeadlineEvaluator
    ) as AdaptiveDeadlineEvaluator | undefined;

    if (!adaptiveEvaluator) return;

    const assessment = await adaptiveEvaluator.assessLoadAndAdapt(context, activeInstances);

    // Relax recommended deadlines
    if (assessment.should_relax) {
      for (const instanceId of assessment.instances_to_relax) {
        const instance = activeInstances.find(inst => inst.instance_id === instanceId);
        if (instance) {
          const evaluator = this.evaluators.get(instance.deadline_id);
          if (evaluator) {
            evaluator.relaxDeadline(instanceId);
          }
        }
      }
    }
  }

  /**
   * Trigger escalation for missed deadline
   */
  private async triggerEscalation(
    instance: DeadlineInstance,
    context: DeadlineContext
  ): Promise<EscalationResult> {
    const evaluator = this.evaluators.get(instance.deadline_id);
    if (!evaluator) {
      throw new Error(`Evaluator not found: ${instance.deadline_id}`);
    }

    // Get deadline definition
    const deadline = (evaluator as any).deadline as Deadline;

    const result: EscalationResult = {
      instance_id: instance.instance_id,
      deadline_id: instance.deadline_id,
      actions_taken: [],
      notifications_sent: [],
      timestamp: context.timestamp
    };

    // Execute escalation actions
    for (const action of deadline.escalation.actions) {
      try {
        await this.executeEscalationAction(action, instance, context);
        result.actions_taken.push(action);
      } catch (error) {
        console.error(`[DeadlineOrchestrator] Escalation action failed: ${action}`, error);
      }
    }

    // Send notifications
    for (const role of deadline.escalation.notify) {
      try {
        const sent = await this.sendNotification(role, instance, context);
        result.notifications_sent.push({
          role,
          sent_at: context.timestamp,
          status: sent ? 'sent' : 'failed'
        });
      } catch (error) {
        console.error(`[DeadlineOrchestrator] Notification failed: ${role}`, error);
        result.notifications_sent.push({
          role,
          sent_at: context.timestamp,
          status: 'failed'
        });
      }
    }

    return result;
  }

  /**
   * Execute escalation action
   */
  private async executeEscalationAction(
    action: string,
    instance: DeadlineInstance,
    context: DeadlineContext
  ): Promise<void> {
    console.log(`[DeadlineOrchestrator] Executing escalation action: ${action}`);

    switch (action) {
      case 'alert_team':
        // Send alert to clinical team
        // Implementation would integrate with notification system
        break;

      case 'reallocate_resources':
        // Trigger resource reallocation
        // Implementation would integrate with resource management system
        break;

      case 'escalate_priority':
        // Increase patient priority in queue
        // Implementation would integrate with queue management system
        break;

      case 'notify_supervisor':
        // Notify supervisor
        break;

      default:
        console.warn(`[DeadlineOrchestrator] Unknown escalation action: ${action}`);
    }
  }

  /**
   * Send notification to role
   */
  private async sendNotification(
    role: string,
    instance: DeadlineInstance,
    context: DeadlineContext
  ): Promise<boolean> {
    console.log(`[DeadlineOrchestrator] Sending notification to: ${role}`);

    // Implementation would integrate with notification system
    // (SMS, push notification, in-app alert, etc.)

    return true; // Mock success
  }

  /**
   * Get summary statistics for session
   */
  getSummary(sessionId: string): {
    total_deadlines: number;
    met: number;
    missed: number;
    escalated: number;
    active: number;
    on_time_percentage: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        total_deadlines: 0,
        met: 0,
        missed: 0,
        escalated: 0,
        active: 0,
        on_time_percentage: 0
      };
    }

    const total = session.deadlines_tracked.length;
    const met = session.deadlines_met.length;
    const missed = session.deadlines_missed.length;
    const escalated = session.deadlines_escalated.length;
    const active = session.deadlines_tracked.filter(
      inst => inst.status === 'active' || inst.status === 'relaxed'
    ).length;

    const onTimePercentage = total > 0 ? (met / total) * 100 : 0;

    return {
      total_deadlines: total,
      met,
      missed,
      escalated,
      active,
      on_time_percentage: Math.round(onTimePercentage * 100) / 100
    };
  }
}
