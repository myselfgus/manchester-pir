/**
 * PIR Task Orchestrator - Manchester SP
 *
 * Orquestra execução paralela rizomática das 12 tasks
 * Usa Workers AI para coordenação inteligente de execução
 * Arquitetura não-hierárquica: tasks executam simultaneamente quando condições atendidas
 */

import type { Task, TaskContext, TaskResult, TaskStatus, WORKERS_AI_MODELS } from '../types/tasks';
import { Ai } from '@cloudflare/ai';

// Import all task executors
import {
  InitialTriageAssessmentExecutor,
  FlowchartSelectionExecutor,
  ApplyGeneralDiscriminatorsExecutor,
  ApplySpecificDiscriminatorsExecutor,
  PriorityClassificationExecutor,
  ActivatePriorityFlowChestPainExecutor,
  ActivatePriorityFlowStrokeExecutor,
  ActivatePriorityFlowSepsisExecutor,
  ActivatePriorityFlowTraumaExecutor,
  QueueManagementExecutor,
} from '../executors/llm-tasks';

import {
  AssignWristbandExecutor,
  RecordClassificationExecutor,
} from '../executors/operational-tasks';

export interface TaskExecutionSession {
  session_id: string;
  patient_id?: string;
  started_at: string;
  slot_state: Record<string, any>; // Vem do pir-slots
  task_outputs: Record<string, any>; // Acumula outputs das tasks
  task_results: TaskResult[];
  status: 'running' | 'completed' | 'failed' | 'partial';
  arrival_time?: string;
  nurse_identifier?: string;
}

export interface TaskExecutionProgress {
  total_tasks: number;
  completed_tasks: number;
  running_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  execution_percentage: number;
  estimated_completion_time?: string;
}

/**
 * Orquestrador Principal de Tasks
 *
 * Coordena execução paralela rizomática usando Workers AI para:
 * - Decidir ordem ótima de execução
 * - Detectar dependências entre tasks
 * - Executar tasks em paralelo máximo
 * - Gerenciar estado compartilhado
 */
export class TaskOrchestrator {
  private ai: Ai;
  private aiBinding: any;
  private sessions: Map<string, TaskExecutionSession> = new Map();
  private executors: Map<string, any>;

  constructor(aiBinding: any) {
    this.ai = new Ai(aiBinding);
    this.aiBinding = aiBinding;

    // Registra todos os 12 executors
    this.executors = new Map([
      ['initial_triage_assessment', new InitialTriageAssessmentExecutor(aiBinding)],
      ['flowchart_selection', new FlowchartSelectionExecutor(aiBinding)],
      ['apply_general_discriminators', new ApplyGeneralDiscriminatorsExecutor(aiBinding)],
      ['apply_specific_discriminators', new ApplySpecificDiscriminatorsExecutor(aiBinding)],
      ['priority_classification', new PriorityClassificationExecutor(aiBinding)],
      ['assign_wristband', new AssignWristbandExecutor(aiBinding)],
      ['record_classification', new RecordClassificationExecutor(aiBinding)],
      ['activate_priority_flow_chest_pain', new ActivatePriorityFlowChestPainExecutor(aiBinding)],
      ['activate_priority_flow_stroke', new ActivatePriorityFlowStrokeExecutor(aiBinding)],
      ['activate_priority_flow_sepsis', new ActivatePriorityFlowSepsisExecutor(aiBinding)],
      ['activate_priority_flow_trauma', new ActivatePriorityFlowTraumaExecutor(aiBinding)],
      ['queue_management', new QueueManagementExecutor(aiBinding)],
    ]);
  }

  /**
   * Inicia nova sessão de execução de tasks
   */
  startSession(
    sessionId: string,
    slotState: Record<string, any>,
    patientId?: string,
    arrivalTime?: string,
    nurseIdentifier?: string
  ): TaskExecutionSession {
    const session: TaskExecutionSession = {
      session_id: sessionId,
      patient_id: patientId,
      started_at: new Date().toISOString(),
      slot_state: slotState,
      task_outputs: {},
      task_results: [],
      status: 'running',
      arrival_time: arrivalTime,
      nurse_identifier: nurseIdentifier,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Executa todas as tasks em paralelo rizomático
   *
   * ARQUITETURA RIZOMÁTICA:
   * - Tasks executam simultaneamente quando condições atendidas
   * - Não há hierarquia fixa de execução
   * - Workers AI coordena execução inteligente
   * - Tasks com dependências aguardam outputs necessários
   */
  async executeTasks(sessionId: string): Promise<TaskExecutionSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log(`[ORCHESTRATOR] Starting rhizomatic execution for session ${sessionId}`);
    console.log(`[ORCHESTRATOR] Slot state:`, JSON.stringify(session.slot_state, null, 2));

    // FASE 1: Usa Workers AI para planejar ordem ótima de execução
    const executionPlan = await this.planExecution(session);
    console.log(`[ORCHESTRATOR] Execution plan:`, executionPlan);

    // FASE 2: Execução em ondas paralelas (tasks sem dependências juntas)
    try {
      const waves = executionPlan.execution_waves;

      for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
        const wave = waves[waveIndex];
        console.log(`[ORCHESTRATOR] Executing wave ${waveIndex + 1}/${waves.length}: ${wave.join(', ')}`);

        // Executa tasks da onda em paralelo
        const wavePromises = wave.map(taskId => this.executeTask(taskId, session));
        const waveResults = await Promise.allSettled(wavePromises);

        // Processa resultados
        waveResults.forEach((result, index) => {
          const taskId = wave[index];

          if (result.status === 'fulfilled') {
            const taskResult = result.value;
            session.task_results.push(taskResult);

            // Merge outputs para próximas tasks
            if (taskResult.status === 'completed') {
              Object.assign(session.task_outputs, taskResult.outputs);
            }

            console.log(`[ORCHESTRATOR] Task ${taskId}: ${taskResult.status}`);
          } else {
            console.error(`[ORCHESTRATOR] Task ${taskId} failed:`, result.reason);
            session.task_results.push({
              task_id: taskId,
              status: 'failed',
              outputs: {},
              execution_time_ms: 0,
              error: result.reason?.message || 'Unknown error',
              timestamp: new Date().toISOString(),
            });
          }
        });
      }

      session.status = 'completed';
      console.log(`[ORCHESTRATOR] All waves completed for session ${sessionId}`);
    } catch (error) {
      console.error(`[ORCHESTRATOR] Fatal error during execution:`, error);
      session.status = 'failed';
    }

    return session;
  }

  /**
   * Usa Workers AI para planejar ordem ótima de execução
   * LLM analisa dependências e cria ondas de execução paralela
   */
  private async planExecution(session: TaskExecutionSession): Promise<{
    execution_waves: string[][];
    reasoning: string;
  }> {
    const prompt = `PLANEJAMENTO DE EXECUÇÃO DE TASKS - TRIAGEM MANCHESTER

Dados disponíveis (slots preenchidos):
${JSON.stringify(session.slot_state, null, 2)}

12 TASKS DISPONÍVEIS:
1. initial_triage_assessment - Precisa: chief_complaint, sinais vitais
2. flowchart_selection - Precisa: chief_complaint, initial_discriminators
3. apply_general_discriminators - Precisa: sinais vitais, dor, sangramento
4. apply_specific_discriminators - Precisa: selected_flowchart, todos slots
5. priority_classification - Precisa: general_discriminators, specific_discriminators
6. assign_wristband - Precisa: final_priority_color
7. record_classification - Precisa: classificação completa
8. activate_priority_flow_chest_pain - Condicional: flowchart=='dor_toracica' AND priority IN ['vermelho','laranja']
9. activate_priority_flow_stroke - Condicional: flowchart=='avc' AND deficit neurológico
10. activate_priority_flow_sepsis - Condicional: qSOFA>=2 AND infecção suspeitada
11. activate_priority_flow_trauma - Condicional: flowchart=='trauma' AND priority crítica
12. queue_management - Precisa: final_priority_color, final_priority_time

ARQUITETURA RIZOMÁTICA:
- Executar tasks em ONDAS PARALELAS
- Onda 1: Tasks sem dependências (podem rodar juntas)
- Onda 2: Tasks que dependem de outputs da Onda 1
- Onda 3: Tasks finais

TAREFA: Organize as 12 tasks em ondas de execução paralela máxima.

Retorne JSON:
{
  "execution_waves": [
    ["task1", "task3"],  // Onda 1: paralelas
    ["task2", "task4"],  // Onda 2: dependem da onda 1
    ["task5"],           // Onda 3: depende da onda 2
    ["task6", "task7", "task8", "task9", "task10", "task11", "task12"]  // Onda final: todas paralelas
  ],
  "reasoning": "explicação da estratégia"
}`;

    try {
      const response = await this.ai.run('@cf/qwen/qwq-32b-preview', {
        messages: [
          {
            role: 'system',
            content: 'Você é um orquestrador de processos paralelos. Analise dependências e otimize execução.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 800,
      });

      const parsed = this.parseJSON((response as any).response);

      // Valida estrutura
      if (!parsed.execution_waves || !Array.isArray(parsed.execution_waves)) {
        throw new Error('Invalid execution plan structure');
      }

      return parsed as { execution_waves: string[][]; reasoning: string };
    } catch (error) {
      console.error('[ORCHESTRATOR] Failed to plan execution with AI, using default:', error);

      // Fallback: ordem padrão conhecida
      return {
        execution_waves: [
          ['initial_triage_assessment', 'apply_general_discriminators'],
          ['flowchart_selection'],
          ['apply_specific_discriminators'],
          ['priority_classification'],
          [
            'assign_wristband',
            'record_classification',
            'activate_priority_flow_chest_pain',
            'activate_priority_flow_stroke',
            'activate_priority_flow_sepsis',
            'activate_priority_flow_trauma',
            'queue_management',
          ],
        ],
        reasoning: 'Default execution plan (AI planning failed)',
      };
    }
  }

  /**
   * Executa uma task individual
   */
  private async executeTask(taskId: string, session: TaskExecutionSession): Promise<TaskResult> {
    const executor = this.executors.get(taskId);
    if (!executor) {
      throw new Error(`Executor not found for task ${taskId}`);
    }

    const context: TaskContext = {
      task_id: taskId,
      session_id: session.session_id,
      patient_id: session.patient_id,
      slot_state: session.slot_state,
      task_outputs: session.task_outputs,
      arrival_time: session.arrival_time,
      nurse_identifier: session.nurse_identifier,
      timestamp: new Date().toISOString(),
      attempt: 1,
    };

    return await executor.execute(context);
  }

  /**
   * Obtém progresso de execução
   */
  getProgress(sessionId: string): TaskExecutionProgress | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const total = this.executors.size;
    const completed = session.task_results.filter(r => r.status === 'completed').length;
    const running = session.status === 'running' ? total - completed : 0;
    const failed = session.task_results.filter(r => r.status === 'failed').length;
    const skipped = session.task_results.filter(r => r.status === 'skipped').length;

    return {
      total_tasks: total,
      completed_tasks: completed,
      running_tasks: running,
      failed_tasks: failed,
      skipped_tasks: skipped,
      execution_percentage: Math.floor((completed / total) * 100),
    };
  }

  /**
   * Obtém sessão
   */
  getSession(sessionId: string): TaskExecutionSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Parse JSON de resposta LLM
   */
  private parseJSON(text: string): Record<string, any> {
    try {
      return JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Continue
        }
      }

      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Continue
        }
      }

      throw new Error('Failed to parse JSON from LLM response');
    }
  }

  /**
   * Limpa sessões antigas
   */
  cleanup(olderThanHours: number = 24): number {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionTime = new Date(session.started_at).getTime();
      if (sessionTime < cutoff) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}
