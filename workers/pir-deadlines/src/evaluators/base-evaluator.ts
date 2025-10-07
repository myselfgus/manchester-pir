/**
 * PIR Manchester SP - Deadline Evaluators Base Classes
 *
 * Base abstractions for deadline evaluators that monitor time windows
 * and adapt to load conditions using Cloudflare Workers AI.
 */

import {
  Deadline,
  DeadlineInstance,
  DeadlineContext,
  DeadlineCheckResult,
  DeadlineStatus,
  LoadCondition,
  parseDuration,
  calculateUrgency,
  DEADLINE_AI_MODELS
} from '../types/deadlines';

export interface DeadlineEvaluatorConfig {
  deadline: Deadline;
  enableAdaptation?: boolean;
  enableEscalation?: boolean;
}

/**
 * Abstract base class for all deadline evaluators
 */
export abstract class BaseDeadlineEvaluator {
  protected ai: Ai;
  protected config: DeadlineEvaluatorConfig;
  protected deadline: Deadline;
  protected instances: Map<string, DeadlineInstance> = new Map();

  constructor(ai: Ai, config: DeadlineEvaluatorConfig) {
    this.ai = ai;
    this.config = {
      enableAdaptation: true,
      enableEscalation: true,
      ...config
    };
    this.deadline = config.deadline;
  }

  /**
   * Start tracking a deadline for a session
   */
  startTracking(
    instanceId: string,
    context: DeadlineContext
  ): DeadlineInstance {
    const now = new Date(context.timestamp);
    const targetTimeMs = parseDuration(this.deadline.target_time);
    const targetDeadline = new Date(now.getTime() + targetTimeMs);

    const instance: DeadlineInstance = {
      instance_id: instanceId,
      deadline_id: this.deadline.id,
      session_id: context.session_id,
      patient_id: context.patient_id,
      status: 'active',
      priority: this.deadline.priority,
      started_at: now.toISOString(),
      target_deadline: targetDeadline.toISOString(),
      time_elapsed_ms: 0,
      is_overdue: false,
      load_condition: this.assessLoadCondition(context.current_queue_length),
      escalation_triggered: false,
      context: {
        classification: context.classification,
        flowchart: context.flowchart,
        priority_flow: context.priority_flow
      }
    };

    this.instances.set(instanceId, instance);
    return instance;
  }

  /**
   * Check deadline status
   */
  async checkDeadline(
    instanceId: string,
    context: DeadlineContext
  ): Promise<DeadlineCheckResult> {
    const instance = this.instances.get(instanceId);

    if (!instance) {
      throw new Error(`Deadline instance not found: ${instanceId}`);
    }

    const now = new Date(context.timestamp);
    const startedAt = new Date(instance.started_at);
    const targetDeadline = new Date(instance.target_deadline);
    const effectiveDeadline = instance.relaxed_deadline
      ? new Date(instance.relaxed_deadline)
      : targetDeadline;

    // Calculate time metrics
    const timeElapsedMs = now.getTime() - startedAt.getTime();
    const timeRemainingMs = effectiveDeadline.getTime() - now.getTime();
    const isOverdue = timeRemainingMs < 0;

    // Update instance
    instance.time_elapsed_ms = timeElapsedMs;
    instance.time_remaining_ms = timeRemainingMs;
    instance.is_overdue = isOverdue;
    instance.load_condition = this.assessLoadCondition(context.current_queue_length);

    // Determine urgency
    const totalTimeMs = effectiveDeadline.getTime() - startedAt.getTime();
    const urgencyLevel = calculateUrgency(timeRemainingMs, totalTimeMs);

    // Check if should escalate
    const shouldEscalate = this.shouldEscalate(instance, urgencyLevel, context);

    // Check if should relax (only if adaptive)
    const shouldRelax =
      this.deadline.adaptive &&
      this.config.enableAdaptation &&
      !instance.relaxed_deadline &&
      this.shouldRelax(instance, context);

    // Use Workers AI for recommendation if critical
    let recommendation;
    if (urgencyLevel === 'critical' || shouldEscalate) {
      recommendation = await this.getRecommendation(instance, context, urgencyLevel);
    }

    // Update status
    if (isOverdue && !instance.escalation_triggered) {
      instance.status = 'missed';
    } else if (isOverdue && instance.escalation_triggered) {
      instance.status = 'escalated';
    } else if (instance.relaxed_deadline) {
      instance.status = 'relaxed';
    }

    this.instances.set(instanceId, instance);

    return {
      instance_id: instanceId,
      deadline_id: this.deadline.id,
      status: instance.status,
      time_remaining_ms: timeRemainingMs,
      time_elapsed_ms: timeElapsedMs,
      is_overdue: isOverdue,
      urgency_level: urgencyLevel,
      should_escalate: shouldEscalate,
      should_relax: shouldRelax,
      load_condition: instance.load_condition,
      recommendation
    };
  }

  /**
   * Mark deadline as met
   */
  markMet(instanceId: string, timestamp: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = 'met';
      instance.met_at = timestamp;
      this.instances.set(instanceId, instance);
    }
  }

  /**
   * Relax deadline due to high load
   */
  relaxDeadline(instanceId: string): void {
    const instance = this.instances.get(instanceId);

    if (!instance || !this.deadline.relaxes_to) {
      return;
    }

    const startedAt = new Date(instance.started_at);
    const relaxedTimeMs = parseDuration(this.deadline.relaxes_to);
    const relaxedDeadline = new Date(startedAt.getTime() + relaxedTimeMs);

    instance.relaxed_deadline = relaxedDeadline.toISOString();
    instance.status = 'relaxed';

    this.instances.set(instanceId, instance);
  }

  /**
   * Mark escalation as triggered
   */
  markEscalated(instanceId: string, actionsTaken: string[]): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = 'escalated';
      instance.escalation_triggered = true;
      instance.escalation_actions_taken = actionsTaken;
      this.instances.set(instanceId, instance);
    }
  }

  /**
   * Assess load condition based on queue length
   */
  protected assessLoadCondition(queueLength: number): LoadCondition {
    const threshold = this.deadline.load_threshold || 10;

    if (queueLength >= threshold * 2) return 'critical';
    if (queueLength >= threshold) return 'high';
    return 'normal';
  }

  /**
   * Determine if deadline should escalate
   */
  protected shouldEscalate(
    instance: DeadlineInstance,
    urgencyLevel: string,
    context: DeadlineContext
  ): boolean {
    if (!this.deadline.escalation.enabled || !this.config.enableEscalation) {
      return false;
    }

    if (instance.escalation_triggered) {
      return false; // Already escalated
    }

    // Escalate if overdue or critically urgent
    return instance.is_overdue || urgencyLevel === 'critical';
  }

  /**
   * Determine if deadline should relax
   */
  protected shouldRelax(
    instance: DeadlineInstance,
    context: DeadlineContext
  ): boolean {
    if (instance.relaxed_deadline) {
      return false; // Already relaxed
    }

    const loadCondition = this.assessLoadCondition(context.current_queue_length);
    return loadCondition === 'high' || loadCondition === 'critical';
  }

  /**
   * Get AI recommendation for critical deadlines
   */
  protected async getRecommendation(
    instance: DeadlineInstance,
    context: DeadlineContext,
    urgencyLevel: string
  ): Promise<{ action: string; reasoning: string; priority: string }> {
    const systemPrompt = `Você é um sistema de GESTÃO DE DEADLINES para triagem de emergência Manchester.

Analise a situação de deadline crítico e recomende ação apropriada.

Ações possíveis:
- "reallocate_resources": Realocar recursos de casos menos urgentes
- "expedite_process": Acelerar processo atual
- "notify_team": Notificar equipe de supervisão
- "escalate_priority": Escalar prioridade do paciente
- "accept_delay": Aceitar atraso justificado (alta carga)

Considere:
- Prioridade do paciente (vermelho > laranja > amarelo > verde > azul)
- Condição de carga do sistema
- Tempo decorrido vs tempo alvo
- Fluxo prioritário (dor torácica, AVC, sepse, trauma)

Responda APENAS com JSON:
{
  "action": "nome_da_acao",
  "reasoning": "justificativa detalhada",
  "priority": "critical" | "high" | "medium"
}`;

    const userPrompt = `DEADLINE CRÍTICO:

Deadline: ${this.deadline.name}
Descrição: ${this.deadline.description}
Tempo Alvo: ${this.deadline.target_time}
Prioridade: ${this.deadline.priority}

SITUAÇÃO ATUAL:
- Tempo Decorrido: ${instance.time_elapsed_ms}ms
- Tempo Restante: ${instance.time_remaining_ms}ms
- Status: ${instance.is_overdue ? 'ATRASADO' : urgencyLevel}
- Condição de Carga: ${instance.load_condition}

CONTEXTO DO PACIENTE:
- Classificação: ${instance.context.classification || 'não definida'}
- Fluxograma: ${instance.context.flowchart || 'não definido'}
- Fluxo Prioritário: ${instance.context.priority_flow || 'nenhum'}
- Fila Atual: ${context.current_queue_length} pacientes

Recomende ação apropriada.`;

    try {
      const response = await this.ai.run(DEADLINE_AI_MODELS.REASONING, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      // @ts-ignore - Workers AI types
      const responseText = response.response || '';

      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned);

    } catch (error) {
      console.error('[BaseDeadlineEvaluator] Failed to get AI recommendation:', error);

      // Fallback recommendation
      return {
        action: instance.is_overdue ? 'escalate_priority' : 'expedite_process',
        reasoning: 'AI recommendation failed, using fallback action',
        priority: this.deadline.priority
      };
    }
  }

  /**
   * Get deadline instance
   */
  getInstance(instanceId: string): DeadlineInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Check if deadline applies to context
   */
  appliesTo(context: DeadlineContext): boolean {
    const { applies_to } = this.deadline;

    // Check classification (Manchester colors)
    if (applies_to.classification && context.classification) {
      if (!applies_to.classification.includes(context.classification)) {
        return false;
      }
    }

    // Check flowchart
    if (applies_to.flowchart && context.flowchart) {
      if (!applies_to.flowchart.includes(context.flowchart)) {
        return false;
      }
    }

    // Check priority flow
    if (applies_to.priority_flow && context.priority_flow) {
      if (!applies_to.priority_flow.includes(context.priority_flow)) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Adaptive deadline evaluator with AI-driven load management
 */
export abstract class AdaptiveDeadlineEvaluator extends BaseDeadlineEvaluator {
  /**
   * Use Workers AI to assess load and recommend deadline relaxation
   */
  async assessLoadAndAdapt(
    context: DeadlineContext,
    activeInstances: DeadlineInstance[]
  ): Promise<{
    should_relax: boolean;
    instances_to_relax: string[];
    reasoning: string;
  }> {
    const systemPrompt = `Você é um sistema de GESTÃO ADAPTATIVA DE DEADLINES para emergência.

Analise a condição de carga do sistema e determine se deadlines devem ser RELAXADOS.

Critérios para relaxar deadlines:
- Fila longa (> threshold definido)
- Muitos casos críticos simultâneos
- Recursos limitados
- Manter qualidade > velocidade

NÃO relaxar deadlines para:
- Casos VERMELHOS (emergência)
- Fluxos prioritários (dor torácica, AVC < 4.5h, sepse)
- Casos com risco de deterioração

Responda APENAS com JSON:
{
  "should_relax": boolean,
  "instances_to_relax": ["instance_id1", "instance_id2"],
  "reasoning": "justificativa detalhada"
}`;

    const userPrompt = `ANÁLISE DE CARGA:

Fila Atual: ${context.current_queue_length} pacientes
Threshold: ${this.deadline.load_threshold || 10}

DEADLINES ATIVOS:
${activeInstances.map(inst => `
- Instance: ${inst.instance_id}
  Deadline: ${inst.deadline_id}
  Classificação: ${inst.context.classification}
  Fluxo Prioritário: ${inst.context.priority_flow || 'nenhum'}
  Tempo Restante: ${inst.time_remaining_ms}ms
  Status: ${inst.status}
`).join('\n')}

Determine se deve relaxar deadlines e quais.`;

    try {
      const response = await this.ai.run(DEADLINE_AI_MODELS.REASONING, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      // @ts-ignore - Workers AI types
      const responseText = response.response || '';

      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned);

    } catch (error) {
      console.error('[AdaptiveDeadlineEvaluator] Failed to assess load:', error);

      return {
        should_relax: false,
        instances_to_relax: [],
        reasoning: 'AI assessment failed'
      };
    }
  }
}
