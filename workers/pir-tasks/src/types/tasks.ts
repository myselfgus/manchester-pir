/**
 * PIR Task Types - Manchester SP Protocol
 *
 * Tipos TypeScript para sistema de execução de tasks (automação de processos)
 * Tasks automatizam decisões operacionais usando Workers AI (LLMs)
 */

export type TaskType = 'llm_reasoning' | 'local_inference' | 'api_call' | 'distributed';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PriorityLevel = 'EMERGENT' | 'VERY_URGENT' | 'URGENT' | 'LESS_URGENT' | 'NON_URGENT';

export type PriorityColor = 'vermelho' | 'laranja' | 'amarelo' | 'verde' | 'azul';

/**
 * Contexto de execução passado para cada task
 */
export interface TaskContext {
  task_id: string;
  session_id: string;
  patient_id?: string;

  // Estado dos slots preenchidos (vem do pir-slots)
  slot_state: Record<string, any>;

  // Outputs de tasks anteriores
  task_outputs: Record<string, any>;

  // Contexto adicional
  arrival_time?: string;
  nurse_identifier?: string;
  timestamp: string;
  attempt: number;
}

/**
 * Resultado da execução de uma task
 */
export interface TaskResult {
  task_id: string;
  status: TaskStatus;
  outputs: Record<string, any>;
  execution_time_ms: number;
  error?: string;
  fallback_triggered?: string;
  timestamp: string;
  reasoning?: string; // Explicação do LLM (quando aplicável)
}

/**
 * Definição de uma task (lida do PIR JSON)
 */
export interface Task {
  task_id: string;
  name: string;
  type: TaskType;
  description: string;

  execution: {
    local: boolean;
    sync: boolean;
    timeout?: string;
    model?: string; // LLM model para llm_reasoning
    max_tokens?: number;
    endpoint?: string; // Para api_call
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    distributed_nodes?: string[]; // Para distributed
  };

  inputs: string[]; // Slot IDs necessários
  outputs: string[]; // Outputs que produz

  condition?: string; // Condição para executar (ex: "selected_flowchart == 'dor_toracica'")

  prompt_template?: string; // Template para LLM

  rules?: Array<{
    if: string;
    then: string;
    discriminator?: string;
  }>;

  flowchart_rules?: Record<string, Array<{
    if: string;
    then: string;
    discriminator?: string;
  }>>;

  fallback?: {
    on_timeout?: string;
    on_error?: string;
  };

  priority?: 'critical' | 'high' | 'medium' | 'low';
  required_by_regulation?: boolean;
  legal_reference?: string;
}

/**
 * Discriminador (geral ou específico)
 */
export interface Discriminator {
  discriminator: string;
  priority: PriorityLevel;
}

/**
 * Classificação de prioridade final
 */
export interface PriorityClassification {
  final_priority_color: PriorityColor;
  final_priority_time: string;
  classification_reasoning: string;
}

/**
 * Configuração de executor
 */
export interface ExecutorConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  retry_on_failure: boolean;
  max_retries: number;
}

/**
 * Modelos Workers AI disponíveis (Outubro 2025)
 */
export const WORKERS_AI_MODELS = {
  // Reasoning models (melhores para decisões complexas)
  DEEPSEEK_R1: '@cf/deepseek/deepseek-r1-distill-qwen-32b', // Reasoning avançado
  QWQ_REASONING: '@cf/qwen/qwq-32b-preview', // Reasoning especializado

  // General LLMs
  LLAMA_4_SCOUT: '@cf/meta/llama-4-scout-17b-16e-instruct', // Multimodal MoE
  GPT_OSS_120B: '@cf/openai/gpt-oss-120b', // GPT Open Source (grande)
  GPT_OSS_20B: '@cf/openai/gpt-oss-20b', // GPT Open Source (rápido)
  LLAMA_3_1_8B: '@cf/meta/llama-3.1-8b-instruct', // Rápido edge

  // Specialized
  MISTRAL_SMALL: '@cf/mistral/mistral-small-3.1-2503', // 24B params, 128k context
  GEMMA_3: '@cf/google/gemma-3-27b-it', // Multimodal (texto + imagem)
} as const;

export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  // Usa QWQ Reasoning para decisões complexas de triagem
  model: WORKERS_AI_MODELS.QWQ_REASONING,
  temperature: 0.1,
  max_tokens: 800,
  retry_on_failure: true,
  max_retries: 2,
};
