/**
 * PIR Manchester SP - Guards Executors Base Classes
 *
 * Base abstractions for guard executors that use Cloudflare Workers AI
 * to perform predictive safety checks.
 *
 * All guards are PREDICTIVE (suggest, not block) and transparent.
 */

import {
  Guard,
  GuardContext,
  GuardResult,
  GuardStatus,
  GuardPriority,
  GuardActionType,
  GUARD_AI_MODELS
} from '../types/guards';

export interface GuardExecutorConfig {
  guard: Guard;
  maxRetries?: number;
  timeoutMs?: number;
  logOverrides?: boolean;
}

/**
 * Abstract base class for all guard executors
 */
export abstract class BaseGuardExecutor {
  protected ai: Ai;
  protected config: GuardExecutorConfig;
  protected guard: Guard;

  constructor(ai: Ai, config: GuardExecutorConfig) {
    this.ai = ai;
    this.config = {
      maxRetries: 2,
      timeoutMs: 15000,
      logOverrides: true,
      ...config
    };
    this.guard = config.guard;
  }

  /**
   * Main execution entry point
   * Checks conditions, validates inputs, and executes guard logic
   */
  async execute(context: GuardContext): Promise<GuardResult> {
    const startTime = Date.now();

    try {
      // Check if guard should run based on conditions
      if (!this.shouldExecute(context)) {
        return this.createResult(context, {
          status: 'skipped',
          triggered: false,
          reason: 'Conditions not met for guard execution'
        });
      }

      // Validate required inputs
      const validation = this.validateInputs(context);
      if (!validation.valid) {
        return this.createResult(context, {
          status: 'failed',
          triggered: false,
          error: `Input validation failed: ${validation.error}`
        });
      }

      // Execute guard logic with timeout
      const executePromise = this.executeGuard(context);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Guard execution timeout')), this.config.timeoutMs)
      );

      const result = await Promise.race([executePromise, timeoutPromise]);

      return {
        ...result,
        execution_time_ms: Date.now() - startTime,
        model_used: this.getModelUsed()
      };

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_time_ms: Date.now() - startTime
      });
    }
  }

  /**
   * Check if guard should execute based on conditions
   */
  protected shouldExecute(context: GuardContext): boolean {
    if (!this.guard.conditions || this.guard.conditions.length === 0) {
      return true;
    }

    return this.guard.conditions.every(condition => {
      const value = this.resolveValue(condition.slot, context);
      return this.evaluateCondition(value, condition.operator, condition.value);
    });
  }

  /**
   * Resolve slot value from context
   */
  protected resolveValue(slotPath: string, context: GuardContext): any {
    // Support nested paths like "vital_signs.heart_rate"
    const parts = slotPath.split('.');
    let value: any = context.slot_state;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }

    return value;
  }

  /**
   * Evaluate condition operator
   */
  protected evaluateCondition(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'eq': return value === expected;
      case 'neq': return value !== expected;
      case 'gt': return value > expected;
      case 'gte': return value >= expected;
      case 'lt': return value < expected;
      case 'lte': return value <= expected;
      case 'in': return Array.isArray(expected) && expected.includes(value);
      case 'not_in': return Array.isArray(expected) && !expected.includes(value);
      case 'exists': return value !== undefined && value !== null;
      case 'not_exists': return value === undefined || value === null;
      default: return false;
    }
  }

  /**
   * Validate required inputs are present
   */
  protected validateInputs(context: GuardContext): { valid: boolean; error?: string } {
    const missingInputs = this.guard.inputs.filter(input => {
      const value = this.resolveValue(input, context);
      return value === undefined || value === null;
    });

    if (missingInputs.length > 0) {
      return {
        valid: false,
        error: `Missing required inputs: ${missingInputs.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Create standardized guard result
   */
  protected createResult(
    context: GuardContext,
    partial: Partial<GuardResult>
  ): GuardResult {
    return {
      guard_id: this.guard.id,
      status: partial.status || 'completed',
      triggered: partial.triggered || false,
      action: partial.action,
      context: {
        session_id: context.session_id,
        patient_id: context.patient_id,
        timestamp: context.timestamp
      },
      execution_time_ms: partial.execution_time_ms,
      model_used: partial.model_used,
      error: partial.error,
      reason: partial.reason
    };
  }

  /**
   * Abstract method: Execute guard-specific logic
   * Must be implemented by subclasses
   */
  protected abstract executeGuard(context: GuardContext): Promise<GuardResult>;

  /**
   * Get model identifier used by this guard (if any)
   */
  protected abstract getModelUsed(): string | undefined;
}

/**
 * Abstract class for guards that use Workers AI LLMs for reasoning
 */
export abstract class LLMReasoningGuard extends BaseGuardExecutor {
  protected model: string;

  constructor(ai: Ai, config: GuardExecutorConfig, model: string) {
    super(ai, config);
    this.model = model;
  }

  /**
   * Call Workers AI with structured prompt
   */
  protected async callLLM(
    systemPrompt: string,
    userPrompt: string,
    temperature: number = 0.3
  ): Promise<string> {
    const response = await this.ai.run(this.model, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: 2000
    });

    // @ts-ignore - Workers AI types
    return response.response || '';
  }

  /**
   * Parse LLM JSON response with error handling
   */
  protected parseLLMResponse<T>(response: string): T {
    try {
      // Remove markdown code blocks if present
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned) as T;
    } catch (error) {
      throw new Error(`Failed to parse LLM response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected getModelUsed(): string {
    return this.model;
  }
}

/**
 * Abstract class for continuous monitoring guards
 * These run repeatedly to monitor patient state changes
 */
export abstract class ContinuousMonitoringGuard extends LLMReasoningGuard {
  private lastCheckTimestamp?: string;
  private stateHistory: Array<{ timestamp: string; state: Record<string, any> }> = [];

  /**
   * Track state changes over time
   */
  protected recordState(timestamp: string, state: Record<string, any>): void {
    this.stateHistory.push({ timestamp, state });

    // Keep last 10 states
    if (this.stateHistory.length > 10) {
      this.stateHistory.shift();
    }
  }

  /**
   * Get state changes since last check
   */
  protected getStateChanges(context: GuardContext): {
    current: Record<string, any>;
    previous?: Record<string, any>;
    changes: string[];
  } {
    const current = context.slot_state;
    const previous = this.stateHistory[this.stateHistory.length - 1]?.state;

    const changes: string[] = [];
    if (previous) {
      for (const key in current) {
        if (current[key] !== previous[key]) {
          changes.push(key);
        }
      }
    }

    return { current, previous, changes };
  }

  /**
   * Check if enough time has passed since last check
   */
  protected shouldCheckNow(context: GuardContext, minIntervalMs: number): boolean {
    if (!this.lastCheckTimestamp) return true;

    const lastCheck = new Date(this.lastCheckTimestamp).getTime();
    const now = new Date(context.timestamp).getTime();

    return (now - lastCheck) >= minIntervalMs;
  }

  protected updateLastCheck(timestamp: string): void {
    this.lastCheckTimestamp = timestamp;
  }
}

/**
 * Abstract class for rule-based guards (no LLM)
 * Use for simple threshold checks that don't need reasoning
 */
export abstract class RuleBasedGuard extends BaseGuardExecutor {
  protected getModelUsed(): string | undefined {
    return undefined; // No model used
  }

  /**
   * Execute rule-based logic (no LLM call)
   */
  protected abstract evaluateRules(context: GuardContext): {
    triggered: boolean;
    action?: {
      type: GuardActionType;
      message: string;
      reasoning?: string;
      priority: GuardPriority;
      override_allowed: boolean;
    };
  };

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const evaluation = this.evaluateRules(context);

    return this.createResult(context, {
      status: 'completed',
      triggered: evaluation.triggered,
      action: evaluation.action
    });
  }
}
