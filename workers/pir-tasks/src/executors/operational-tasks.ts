/**
 * PIR Operational Tasks - Manchester SP
 *
 * Tasks 6-7: Tasks operacionais simples (sem LLM)
 * Executam ações diretas baseadas em outputs de tasks anteriores
 */

import { LocalInferenceExecutor, APICallExecutor } from './base-executor';
import type { Task, TaskContext } from '../types/tasks';

// =============================================================================
// TASK 6: Assign Wristband
// =============================================================================

export class AssignWristbandExecutor extends LocalInferenceExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'assign_wristband',
      name: 'Atribuir Pulseira de Classificação',
      type: 'local_inference',
      description: 'Instrui aplicação da pulseira colorida conforme prioridade',
      execution: {
        local: true,
        sync: true,
      },
      inputs: ['final_priority_color'],
      outputs: ['wristband_instruction', 'patient_identification'],
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const color = context.task_outputs.final_priority_color;

    // Mapeia cor para instruções específicas
    const wristbandInstructions: Record<string, string> = {
      vermelho: 'Aplicar PULSEIRA VERMELHA - Paciente prioridade EMERGENTE - Atendimento IMEDIATO',
      laranja: 'Aplicar PULSEIRA LARANJA - Paciente prioridade MUITO URGENTE - Atendimento em até 10 minutos',
      amarelo: 'Aplicar PULSEIRA AMARELA - Paciente prioridade URGENTE - Atendimento em até 60 minutos',
      verde: 'Aplicar PULSEIRA VERDE - Paciente prioridade POUCO URGENTE - Atendimento em até 120 minutos',
      azul: 'Aplicar PULSEIRA AZUL - Paciente prioridade NÃO URGENTE - Atendimento em até 240 minutos',
    };

    return {
      wristband_instruction: wristbandInstructions[color] || wristbandInstructions['amarelo'],
      patient_identification: {
        color: color,
        color_code: this.getColorCode(color),
        applied_at: new Date().toISOString(),
        session_id: context.session_id,
        nurse_identifier: context.nurse_identifier,
      },
      wristband_applied: true,
    };
  }

  private getColorCode(color: string): string {
    const codes: Record<string, string> = {
      vermelho: '1',
      laranja: '2',
      amarelo: '3',
      verde: '4',
      azul: '5',
    };
    return codes[color] || '3';
  }
}

// =============================================================================
// TASK 7: Record Classification
// =============================================================================

export class RecordClassificationExecutor extends APICallExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'record_classification',
      name: 'Registrar Classificação no Prontuário',
      type: 'api_call',
      description: 'Envia classificação para sistema de prontuário eletrônico',
      execution: {
        local: true,
        sync: true,
        endpoint: '/api/medical-records/triage',
        method: 'POST',
        timeout: '30s',
      },
      inputs: [
        'patient_id',
        'final_priority_color',
        'final_priority_time',
        'classification_reasoning',
        'nurse_identifier',
        'timestamp',
      ],
      outputs: ['record_id', 'confirmation', 'audit_trail_created'],
      fallback: {
        on_timeout: 'retry_later',
        on_error: 'log_to_backup_system',
      },
      required_by_regulation: true,
      legal_reference: 'Portaria SMS nº 82/2024 - Art. 15',
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const outputs = context.task_outputs;
    const slots = context.slot_state;

    // Prepara payload completo para o prontuário
    const payload = {
      // Identificação
      patient_id: context.patient_id,
      session_id: context.session_id,
      nurse_identifier: context.nurse_identifier,

      // Classificação Manchester
      priority_color: outputs.final_priority_color,
      priority_time: outputs.final_priority_time,
      manchester_code: outputs.manchester_code,
      classification_reasoning: outputs.classification_reasoning,

      // Discriminadores
      general_discriminators: outputs.general_discriminator_score || [],
      specific_discriminators: outputs.specific_discriminator_matches || [],
      highest_priority_discriminator: outputs.highest_priority_discriminator,

      // Fluxograma
      selected_flowchart: outputs.selected_flowchart,

      // Slots clínicos (dados do paciente)
      chief_complaint: slots.chief_complaint,
      vital_signs: {
        temperature: slots.temperature,
        heart_rate: slots.heart_rate,
        blood_pressure: slots.blood_pressure,
        oxygen_saturation: slots.oxygen_saturation,
        respiratory_rate: slots.respiratory_rate,
      },
      consciousness_level: slots.consciousness_level,
      pain_score: slots.pain_score,

      // Protocolos ativados
      protocols_activated: {
        chest_pain: outputs.protocol_activated_chest_pain || false,
        stroke: outputs.stroke_protocol_activated || false,
        sepsis: outputs.sepsis_protocol_activated || false,
        trauma: outputs.trauma_protocol_activated || false,
      },

      // Metadata
      classified_at: context.timestamp,
      arrival_time: context.arrival_time,
      classification_duration_seconds: this.calculateDuration(context.arrival_time, context.timestamp),

      // Conformidade regulatória
      regulation_compliance: {
        portaria: 'SMS nº 82/2024',
        manchester_protocol_version: '2024',
        classification_method: 'ai_native_automated',
      },
    };

    try {
      // Tenta enviar para API de prontuário
      const response = await fetch(this.task.execution.endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': context.session_id,
          'X-Worker-ID': 'pir-tasks',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      return {
        record_id: result.record_id || result.id,
        confirmation: true,
        confirmation_number: result.confirmation_number,
        audit_trail_created: result.audit_trail_created || true,
        stored_at: result.timestamp || new Date().toISOString(),
        api_response: result,
      };
    } catch (error) {
      console.error('[RECORD_CLASSIFICATION] Failed to record:', error);

      // Fallback: salva em sistema de backup
      await this.saveToBackupSystem(payload);

      return {
        record_id: `BACKUP_${context.session_id}`,
        confirmation: false,
        audit_trail_created: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback_storage: 'backup_system',
        stored_at: new Date().toISOString(),
      };
    }
  }

  private calculateDuration(arrivalTime?: string, classificationTime?: string): number {
    if (!arrivalTime || !classificationTime) return 0;

    try {
      const arrival = new Date(arrivalTime).getTime();
      const classification = new Date(classificationTime).getTime();
      return Math.floor((classification - arrival) / 1000);
    } catch {
      return 0;
    }
  }

  private async saveToBackupSystem(payload: Record<string, any>): Promise<void> {
    // TODO: Implementar sistema de backup real
    // Poderia usar: Cloudflare Durable Objects, KV, ou fila para retry posterior
    console.log('[BACKUP] Saving classification to backup system:', {
      patient_id: payload.patient_id,
      session_id: payload.session_id,
      priority: payload.priority_color,
      timestamp: new Date().toISOString(),
    });
  }
}
