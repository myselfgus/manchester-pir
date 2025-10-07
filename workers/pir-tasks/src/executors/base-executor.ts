/**
 * PIR Base Task Executor - Manchester SP
 *
 * Classes base para execução de tasks usando Cloudflare Workers AI
 * Arquitetura rizomática: tasks executam em paralelo, não-hierárquico
 */

import { Ai } from '@cloudflare/ai';
import type {
  Task,
  TaskContext,
  TaskResult,
  TaskStatus,
  ExecutorConfig,
  DEFAULT_EXECUTOR_CONFIG,
} from '../types/tasks';

/**
 * Classe base abstrata para todos os executors
 */
export abstract class BaseTaskExecutor {
  protected ai: Ai;
  protected config: ExecutorConfig;
  protected task: Task;

  constructor(aiBinding: any, task: Task, config: Partial<ExecutorConfig> = {}) {
    this.ai = new Ai(aiBinding);
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.task = task;
  }

  /**
   * Executa a task com timeout e fallback
   */
  async execute(context: TaskContext): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // Verifica condição de execução
      if (!this.shouldExecute(context)) {
        return {
          task_id: this.task.task_id,
          status: 'skipped',
          outputs: {},
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Valida inputs necessários
      const missingInputs = this.validateInputs(context);
      if (missingInputs.length > 0) {
        throw new Error(`Missing required inputs: ${missingInputs.join(', ')}`);
      }

      // Executa task com timeout se especificado
      const executePromise = this.executeTask(context);
      const outputs = this.task.execution.timeout
        ? await this.withTimeout(executePromise, this.parseTimeout(this.task.execution.timeout))
        : await executePromise;

      return {
        task_id: this.task.task_id,
        status: 'completed',
        outputs,
        execution_time_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Task ${this.task.task_id} failed:`, error);

      // Tenta fallback se configurado
      const fallbackResult = await this.handleFallback(error, context, Date.now() - startTime);
      if (fallbackResult) {
        return fallbackResult;
      }

      return {
        task_id: this.task.task_id,
        status: 'failed',
        outputs: {},
        execution_time_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Implementação específica da task (sobrescrito por cada executor)
   */
  protected abstract executeTask(context: TaskContext): Promise<Record<string, any>>;

  /**
   * Verifica se deve executar baseado em condição
   */
  protected shouldExecute(context: TaskContext): boolean {
    if (!this.task.condition) return true;

    return this.evaluateCondition(this.task.condition, context);
  }

  /**
   * Avalia condição de execução
   */
  protected evaluateCondition(condition: string, context: TaskContext): boolean {
    try {
      const { slot_state, task_outputs } = context;
      const allData = { ...slot_state, ...task_outputs };

      // CONTAINS operator
      if (condition.includes(' CONTAINS ')) {
        const match = condition.match(/(\w+)\s+CONTAINS\s+'([^']+)'/);
        if (match) {
          const [, key, value] = match;
          const actual = allData[key];
          return typeof actual === 'string' && actual.includes(value);
        }
      }

      // IN operator: "flowchart IN ['dor_toracica', 'dispneia']"
      if (condition.includes(' IN ')) {
        const match = condition.match(/(\w+)\s+IN\s+\[([^\]]+)\]/);
        if (match) {
          const [, key, arrayStr] = match;
          const value = allData[key];
          const array = arrayStr.split(',').map(s => s.trim().replace(/['"]/g, ''));
          return array.includes(value);
        }
      }

      // Equality: "flowchart == 'dor_toracica'"
      if (condition.includes(' == ')) {
        const [left, right] = condition.split(' == ').map(s => s.trim());
        const leftValue = allData[left];
        const rightValue = right.replace(/['"]/g, '');
        return leftValue == rightValue;
      }

      // Inequality
      if (condition.includes(' != ')) {
        const [left, right] = condition.split(' != ').map(s => s.trim());
        const leftValue = allData[left];
        const rightValue = right.replace(/['"]/g, '');
        return leftValue != rightValue;
      }

      // AND
      if (condition.includes(' AND ')) {
        const conditions = condition.split(' AND ');
        return conditions.every(cond => this.evaluateCondition(cond.trim(), context));
      }

      // OR
      if (condition.includes(' OR ')) {
        const conditions = condition.split(' OR ');
        return conditions.some(cond => this.evaluateCondition(cond.trim(), context));
      }

      // Default: check if variable exists and is truthy
      return Boolean(allData[condition]);
    } catch (error) {
      console.error(`Failed to evaluate condition "${condition}":`, error);
      return false;
    }
  }

  /**
   * Valida se todos inputs necessários estão presentes
   */
  protected validateInputs(context: TaskContext): string[] {
    const missing: string[] = [];

    for (const input of this.task.inputs) {
      const value = context.slot_state[input] || context.task_outputs[input];
      if (value === undefined || value === null) {
        missing.push(input);
      }
    }

    return missing;
  }

  /**
   * Executa com timeout
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Parse timeout string ("5m" -> 300000ms)
   */
  protected parseTimeout(timeout: string): number {
    const match = timeout.match(/^(\d+)(s|m|h)$/);
    if (!match) throw new Error(`Invalid timeout format: ${timeout}`);

    const [, value, unit] = match;
    const num = parseInt(value, 10);

    switch (unit) {
      case 's':
        return num * 1000;
      case 'm':
        return num * 60 * 1000;
      case 'h':
        return num * 60 * 60 * 1000;
      default:
        throw new Error(`Invalid timeout unit: ${unit}`);
    }
  }

  /**
   * Lida com fallback em caso de erro
   */
  protected async handleFallback(
    error: unknown,
    context: TaskContext,
    executionTime: number
  ): Promise<TaskResult | null> {
    if (!this.task.fallback) return null;

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Timeout fallback
    if (errorMessage.includes('timeout') && this.task.fallback.on_timeout) {
      console.log(`Task ${this.task.task_id} timeout, triggering fallback: ${this.task.fallback.on_timeout}`);
      return {
        task_id: this.task.task_id,
        status: 'completed',
        outputs: { fallback_action: this.task.fallback.on_timeout },
        execution_time_ms: executionTime,
        fallback_triggered: 'on_timeout',
        timestamp: new Date().toISOString(),
      };
    }

    // Error fallback
    if (this.task.fallback.on_error) {
      console.log(`Task ${this.task.task_id} error, triggering fallback: ${this.task.fallback.on_error}`);
      return {
        task_id: this.task.task_id,
        status: 'completed',
        outputs: { fallback_action: this.task.fallback.on_error },
        execution_time_ms: executionTime,
        fallback_triggered: 'on_error',
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Chama LLM (Cloudflare Workers AI)
   */
  protected async callLLM(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const model = this.task.execution.model || this.config.model;
    const maxTokens = this.task.execution.max_tokens || this.config.max_tokens;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.max_retries; attempt++) {
      try {
        const response = await this.ai.run(model, {
          messages,
          temperature: this.config.temperature,
          max_tokens: maxTokens,
        });

        if (response && typeof response === 'object' && 'response' in response) {
          return (response as { response: string }).response;
        }

        throw new Error('Invalid LLM response structure');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown LLM error');
        console.error(`LLM call attempt ${attempt + 1} failed:`, lastError);

        if (attempt < this.config.max_retries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('LLM execution failed after retries');
  }

  /**
   * Parse JSON de resposta LLM
   */
  protected parseJSON(text: string): Record<string, any> {
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
   * Helper: sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Executor para tasks com LLM reasoning
 */
export abstract class LLMReasoningExecutor extends BaseTaskExecutor {
  protected systemPrompt = `Você é um assistente de automação de processos de triagem hospitalar (Protocolo Manchester).
Sua função é processar dados clínicos e tomar decisões operacionais automatizadas.

IMPORTANTE:
- Seja preciso e objetivo
- Retorne sempre em formato JSON válido
- Baseie decisões nos dados fornecidos
- Use terminologia do Protocolo Manchester`;

  protected abstract executeTask(context: TaskContext): Promise<Record<string, any>>;
}

/**
 * Executor para tasks com inferência local (regras)
 */
export abstract class LocalInferenceExecutor extends BaseTaskExecutor {
  protected abstract executeTask(context: TaskContext): Promise<Record<string, any>>;
}

/**
 * Executor para tasks de API call
 */
export class APICallExecutor extends BaseTaskExecutor {
  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    if (!this.task.execution.endpoint) {
      throw new Error('API endpoint not specified');
    }

    const method = this.task.execution.method || 'POST';
    const url = this.task.execution.endpoint;

    const body: Record<string, any> = {};
    for (const inputKey of this.task.inputs) {
      body[inputKey] = context.slot_state[inputKey] || context.task_outputs[inputKey];
    }

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}

/**
 * Executor para tasks distribuídas
 */
export abstract class DistributedExecutor extends BaseTaskExecutor {
  /**
   * Notifica nós distribuídos
   */
  protected async notifyDistributedNodes(nodes: string[], payload: Record<string, any>): Promise<void> {
    const notifications = nodes.map(async node => {
      // TODO: Implementar notificação real (WebSocket/HTTP/Queue)
      console.log(`[MOCK] Notifying node ${node}:`, payload);
      return { node, status: 'notified', timestamp: new Date().toISOString() };
    });

    await Promise.all(notifications);
  }

  protected abstract executeTask(context: TaskContext): Promise<Record<string, any>>;
}
