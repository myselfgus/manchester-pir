/**
 * PIR Guard Types - Manchester SP
 *
 * Tipos para sistema de guards preditivos (barreiras de segurança)
 * Guards SUGEREM (não bloqueiam) usando Workers AI
 */

export type GuardType = 'predictive' | 'reactive' | 'continuous';

export type GuardActionType = 'suggest' | 'alert' | 'block' | 'notify';

export type GuardPriority = 'critical' | 'high' | 'medium' | 'low';

export type GuardStatus = 'active' | 'triggered' | 'overridden' | 'ignored' | 'resolved';

/**
 * Contexto para execução de guard
 */
export interface GuardContext {
  guard_id: string;
  session_id: string;
  patient_id?: string;

  // Estado dos slots (vem do pir-slots)
  slot_state: Record<string, any>;

  // Outputs das tasks (vem do pir-tasks)
  task_outputs: Record<string, any>;

  timestamp: string;
}

/**
 * Resultado da verificação de um guard
 */
export interface GuardResult {
  guard_id: string;
  status: GuardStatus;
  triggered: boolean;

  // Sugestão/alerta gerado
  action?: {
    type: GuardActionType;
    message: string;
    reasoning?: string;
    show_reasoning: boolean;
    priority: GuardPriority;
    override_allowed: boolean;
  };

  // Dados adicionais
  trigger_data?: Record<string, any>;
  countdown_timer?: {
    remaining_minutes: number;
    deadline: string;
  };

  // Auto-ativação de protocolos
  auto_activate_protocol?: string;

  // Escalation
  escalation?: {
    required: boolean;
    after_minutes: number;
    action: string;
  };

  execution_time_ms: number;
  timestamp: string;
}

/**
 * Definição de um guard (lida do PIR JSON)
 */
export interface Guard {
  guard_id: string;
  name: string;
  type: GuardType;
  description: string;

  trigger: {
    condition: string;
  };

  action: {
    type: GuardActionType;
    message: string;
    show_reasoning?: boolean;
    reasoning?: string;
    priority?: GuardPriority;
    override_allowed: boolean;
    log_override?: boolean;
  };

  escalation?: {
    if_ignored: string;
    after: string; // "15m", "30m", etc
  };

  countdown_timer?: boolean;
  auto_activate?: string; // protocol to activate
}

/**
 * Modelos Workers AI para guards
 */
export const GUARD_AI_MODELS = {
  REASONING: '@cf/qwen/qwq-32b-preview',
  DEEPSEEK: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
  LLAMA_4: '@cf/meta/llama-4-scout-17b-16e-instruct',
} as const;

/**
 * Configuração de executor de guard
 */
export interface GuardExecutorConfig {
  model: string;
  temperature: number;
  max_tokens: number;
}

export const DEFAULT_GUARD_CONFIG: GuardExecutorConfig = {
  model: GUARD_AI_MODELS.REASONING,
  temperature: 0.05, // Muito baixa - guards precisam ser conservadores
  max_tokens: 600,
};
