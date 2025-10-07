/**
 * PIR Manchester SP - Guard Orchestrator
 *
 * Orchestrates parallel execution of multiple predictive guards.
 * Uses Cloudflare Workers AI to intelligently determine which guards
 * should run based on clinical context.
 *
 * Guards are PREDICTIVE and run in parallel (rhizomatic architecture).
 */

import {
  Guard,
  GuardContext,
  GuardResult,
  GuardExecutionSession,
  GuardSessionStatus,
  GUARD_AI_MODELS
} from '../types/guards';
import { BaseGuardExecutor } from '../executors/base-guard';
import {
  SepsisEarlyDetectionGuard,
  StrokeTimeWindowGuard,
  CardiacIschemiaAlertGuard,
  CriticalHypoxemiaGuard,
  HypovolemicShockGuard,
  AllergyConflictCheckGuard,
  MedicationInteractionGuard,
  PediatricDoseSafetyGuard,
  GeriatricFragilityAlertGuard,
  PregnancyContraindicationGuard
} from '../executors/llm-guards';

export class GuardOrchestrator {
  private ai: Ai;
  private executors: Map<string, BaseGuardExecutor> = new Map();
  private sessions: Map<string, GuardExecutionSession> = new Map();

  constructor(ai: Ai, guards: Guard[]) {
    this.ai = ai;
    this.initializeExecutors(guards);
  }

  /**
   * Initialize guard executors for all defined guards
   */
  private initializeExecutors(guards: Guard[]): void {
    for (const guard of guards) {
      const executor = this.createExecutor(guard);
      if (executor) {
        this.executors.set(guard.id, executor);
      }
    }
  }

  /**
   * Factory method to create appropriate executor for each guard
   */
  private createExecutor(guard: Guard): BaseGuardExecutor | null {
    const config = { guard };

    switch (guard.id) {
      case 'sepsis_early_detection':
        return new SepsisEarlyDetectionGuard(this.ai, config);

      case 'stroke_time_window':
        return new StrokeTimeWindowGuard(this.ai, config);

      case 'cardiac_ischemia_alert':
        return new CardiacIschemiaAlertGuard(this.ai, config);

      case 'critical_hypoxemia':
        return new CriticalHypoxemiaGuard(this.ai, config);

      case 'hypovolemic_shock':
        return new HypovolemicShockGuard(this.ai, config);

      case 'allergy_conflict_check':
        return new AllergyConflictCheckGuard(this.ai, config);

      case 'medication_interaction':
        return new MedicationInteractionGuard(this.ai, config);

      case 'pediatric_dose_safety':
        return new PediatricDoseSafetyGuard(this.ai, config);

      case 'geriatric_fragility_alert':
        return new GeriatricFragilityAlertGuard(this.ai, config);

      case 'pregnancy_contraindication':
        return new PregnancyContraindicationGuard(this.ai, config);

      default:
        console.warn(`No executor found for guard: ${guard.id}`);
        return null;
    }
  }

  /**
   * Execute guards for a session
   * Uses Workers AI to intelligently select which guards to run based on clinical context
   */
  async executeGuards(
    sessionId: string,
    context: Omit<GuardContext, 'guard_id'>
  ): Promise<GuardExecutionSession> {
    const session: GuardExecutionSession = {
      session_id: sessionId,
      status: 'running',
      guards_executed: [],
      guards_triggered: [],
      started_at: new Date().toISOString(),
      context: {
        patient_id: context.patient_id,
        timestamp: context.timestamp
      }
    };

    this.sessions.set(sessionId, session);

    try {
      // PHASE 1: Use Workers AI to determine which guards should run
      const relevantGuards = await this.selectRelevantGuards(context);

      // PHASE 2: Execute selected guards in parallel (rhizomatic)
      const guardPromises = relevantGuards.map(guardId =>
        this.executeGuard(guardId, { ...context, guard_id: guardId })
      );

      const results = await Promise.allSettled(guardPromises);

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const guardId = relevantGuards[i];

        if (result.status === 'fulfilled') {
          const guardResult = result.value;

          session.guards_executed.push({
            guard_id: guardId,
            status: guardResult.status,
            triggered: guardResult.triggered,
            execution_time_ms: guardResult.execution_time_ms
          });

          if (guardResult.triggered) {
            session.guards_triggered.push(guardId);
          }

          // Store full result
          if (!session.results) session.results = {};
          session.results[guardId] = guardResult;

        } else {
          session.guards_executed.push({
            guard_id: guardId,
            status: 'failed',
            triggered: false,
            error: result.reason?.message || 'Unknown error'
          });
        }
      }

      // Update session status
      session.status = session.guards_triggered.length > 0 ? 'alerts_triggered' : 'completed';
      session.completed_at = new Date().toISOString();
      session.total_execution_time_ms =
        new Date(session.completed_at).getTime() - new Date(session.started_at).getTime();

    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      session.completed_at = new Date().toISOString();
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Use Workers AI to intelligently select which guards should run
   * based on clinical context (avoid running all guards every time)
   */
  private async selectRelevantGuards(
    context: Omit<GuardContext, 'guard_id'>
  ): Promise<string[]> {
    const systemPrompt = `Você é um sistema de SELEÇÃO INTELIGENTE DE GUARDS para triagem de emergência.

Analise o contexto clínico e selecione APENAS os guards relevantes para executar.
NÃO execute guards desnecessários para economizar recursos.

Guards Disponíveis:
1. sepsis_early_detection - Detecção precoce de sepse (sinais vitais alterados, infecção suspeita)
2. stroke_time_window - Janela terapêutica AVC (suspeita de AVC, sinais neurológicos)
3. cardiac_ischemia_alert - Alerta de isquemia cardíaca (dor torácica, fatores de risco cardíaco)
4. critical_hypoxemia - Hipoxemia crítica (SpO2 baixo, dificuldade respiratória)
5. hypovolemic_shock - Choque hipovolêmico (hemorragia, hipotensão + taquicardia)
6. allergy_conflict_check - Conflito alérgico (sempre verificar se há medicações prescritas)
7. medication_interaction - Interação medicamentosa (sempre verificar se há medicações prescritas)
8. pediatric_dose_safety - Segurança de dose pediátrica (idade < 18 anos + medicações prescritas)
9. geriatric_fragility_alert - Fragilidade geriátrica (idade ≥ 65 anos)
10. pregnancy_contraindication - Contraindicação na gestação (sexo feminino + idade fértil)

Responda APENAS com JSON:
{
  "relevant_guards": ["guard_id1", "guard_id2", ...],
  "reasoning": "justificativa para seleção"
}`;

    const userPrompt = `CONTEXTO CLÍNICO:

Session ID: ${context.session_id}
Patient ID: ${context.patient_id || 'não informado'}
Timestamp: ${context.timestamp}

DADOS DO PACIENTE:

Queixa Principal: ${context.slot_state.chief_complaint || 'não informada'}

Sinais Vitais:
- PA: ${context.slot_state.systolic_bp}/${context.slot_state.diastolic_bp} mmHg
- FC: ${context.slot_state.heart_rate} bpm
- FR: ${context.slot_state.respiratory_rate} irpm
- Temp: ${context.slot_state.temperature}°C
- SpO2: ${context.slot_state.oxygen_saturation}%
- Consciência: ${context.slot_state.consciousness_level}

Demografia:
- Idade: ${context.slot_state.age || 'não informada'}
- Sexo: ${context.slot_state.gender || 'não informado'}
- Gestante: ${context.slot_state.is_pregnant ? 'SIM' : 'NÃO'}

Hemorragia: ${context.slot_state.bleeding_present ? 'SIM' : 'NÃO'}

Histórico Médico: ${JSON.stringify(context.slot_state.previous_medical_history || [])}
Medicações em Uso: ${JSON.stringify(context.slot_state.medications_in_use || [])}
Alergias: ${JSON.stringify(context.slot_state.allergy_history || [])}

OUTPUTS DE TAREFAS:
${JSON.stringify(context.task_outputs || {}, null, 2)}

Selecione os guards relevantes para este caso.`;

    try {
      const response = await this.ai.run(GUARD_AI_MODELS.REASONING, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 1000
      });

      // @ts-ignore - Workers AI types
      const responseText = response.response || '';

      // Parse JSON response
      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned) as {
        relevant_guards: string[];
        reasoning: string;
      };

      console.log(`[GuardOrchestrator] Selected guards: ${parsed.relevant_guards.join(', ')}`);
      console.log(`[GuardOrchestrator] Reasoning: ${parsed.reasoning}`);

      return parsed.relevant_guards;

    } catch (error) {
      console.error('[GuardOrchestrator] Failed to select guards intelligently, running all guards:', error);

      // Fallback: run all guards
      return Array.from(this.executors.keys());
    }
  }

  /**
   * Execute a single guard
   */
  private async executeGuard(
    guardId: string,
    context: GuardContext
  ): Promise<GuardResult> {
    const executor = this.executors.get(guardId);

    if (!executor) {
      return {
        guard_id: guardId,
        status: 'failed',
        triggered: false,
        context: {
          session_id: context.session_id,
          patient_id: context.patient_id,
          timestamp: context.timestamp
        },
        error: `No executor found for guard: ${guardId}`
      };
    }

    return await executor.execute(context);
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): GuardExecutionSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all triggered guards for a session
   */
  getTriggeredGuards(sessionId: string): GuardResult[] {
    const session = this.sessions.get(sessionId);
    if (!session || !session.results) return [];

    return session.guards_triggered
      .map(guardId => session.results![guardId])
      .filter(Boolean);
  }

  /**
   * Check if any critical alerts were triggered
   */
  hasCriticalAlerts(sessionId: string): boolean {
    const triggered = this.getTriggeredGuards(sessionId);
    return triggered.some(result =>
      result.action?.priority === 'critical'
    );
  }

  /**
   * Get summary of all alerts for a session
   */
  getAlertSummary(sessionId: string): {
    total_alerts: number;
    critical: number;
    high: number;
    medium: number;
    alerts: Array<{
      guard_id: string;
      priority: string;
      message: string;
      override_allowed: boolean;
    }>;
  } {
    const triggered = this.getTriggeredGuards(sessionId);

    const summary = {
      total_alerts: triggered.length,
      critical: 0,
      high: 0,
      medium: 0,
      alerts: [] as Array<{
        guard_id: string;
        priority: string;
        message: string;
        override_allowed: boolean;
      }>
    };

    for (const result of triggered) {
      if (!result.action) continue;

      const priority = result.action.priority;
      if (priority === 'critical') summary.critical++;
      else if (priority === 'high') summary.high++;
      else if (priority === 'medium') summary.medium++;

      summary.alerts.push({
        guard_id: result.guard_id,
        priority: result.action.priority,
        message: result.action.message,
        override_allowed: result.action.override_allowed
      });
    }

    // Sort by priority (critical > high > medium)
    summary.alerts.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority as keyof typeof priorityOrder] || 99) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] || 99);
    });

    return summary;
  }

  /**
   * Clear old sessions (cleanup)
   */
  clearOldSessions(maxAgeMs: number = 3600000): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionTime = new Date(session.started_at).getTime();
      if (now - sessionTime > maxAgeMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
