/**
 * PIR Manchester SP - Deadlines Types
 *
 * Defines adaptive time windows for clinical workflows.
 * Deadlines relax under high load and escalate when missed.
 */

export type DeadlineStatus = 'pending' | 'active' | 'met' | 'missed' | 'escalated' | 'relaxed';
export type DeadlinePriority = 'critical' | 'high' | 'medium' | 'low';
export type LoadCondition = 'normal' | 'high' | 'critical';

/**
 * Deadline definition from PIR JSON
 */
export interface Deadline {
  id: string;
  name: string;
  description: string;
  target_time: string; // ISO duration (e.g., "PT10M" = 10 minutes)
  priority: DeadlinePriority;
  adaptive: boolean;
  relaxes_to?: string; // ISO duration for relaxed deadline
  load_threshold?: number; // Queue length to trigger relaxation
  escalation: {
    enabled: boolean;
    notify: string[]; // Roles to notify (e.g., ["supervisor", "medical_director"])
    actions: string[]; // Actions to take (e.g., ["alert_team", "reallocate_resources"])
  };
  applies_to: {
    classification?: string[]; // Manchester colors (e.g., ["vermelho", "laranja"])
    flowchart?: string[]; // Specific flowcharts
    priority_flow?: string[]; // Priority flows (e.g., ["chest_pain", "stroke"])
  };
}

/**
 * Deadline instance being tracked
 */
export interface DeadlineInstance {
  instance_id: string;
  deadline_id: string;
  session_id: string;
  patient_id?: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  started_at: string; // ISO timestamp
  target_deadline: string; // ISO timestamp (started_at + target_time)
  relaxed_deadline?: string; // ISO timestamp (if relaxed)
  met_at?: string; // ISO timestamp
  time_remaining_ms?: number;
  time_elapsed_ms: number;
  is_overdue: boolean;
  load_condition: LoadCondition;
  escalation_triggered: boolean;
  escalation_actions_taken?: string[];
  context: {
    classification?: string;
    flowchart?: string;
    priority_flow?: string;
  };
}

/**
 * Context for deadline evaluation
 */
export interface DeadlineContext {
  session_id: string;
  patient_id?: string;
  classification?: string; // Manchester color
  flowchart?: string;
  priority_flow?: string;
  current_queue_length: number;
  timestamp: string;
  slot_state?: Record<string, any>;
  task_outputs?: Record<string, any>;
}

/**
 * Result of deadline check
 */
export interface DeadlineCheckResult {
  instance_id: string;
  deadline_id: string;
  status: DeadlineStatus;
  time_remaining_ms: number;
  time_elapsed_ms: number;
  is_overdue: boolean;
  urgency_level: 'normal' | 'warning' | 'critical';
  should_escalate: boolean;
  should_relax: boolean;
  load_condition: LoadCondition;
  recommendation?: {
    action: string;
    reasoning: string;
    priority: DeadlinePriority;
  };
}

/**
 * Deadline monitoring session
 */
export interface DeadlineMonitoringSession {
  session_id: string;
  status: 'active' | 'completed' | 'failed';
  deadlines_tracked: DeadlineInstance[];
  deadlines_met: string[];
  deadlines_missed: string[];
  deadlines_escalated: string[];
  started_at: string;
  completed_at?: string;
  context: {
    patient_id?: string;
    classification?: string;
  };
}

/**
 * Load assessment from Workers AI
 */
export interface LoadAssessment {
  load_condition: LoadCondition;
  queue_length: number;
  should_relax_deadlines: boolean;
  deadlines_to_relax: string[];
  reasoning: string;
}

/**
 * Escalation action result
 */
export interface EscalationResult {
  instance_id: string;
  deadline_id: string;
  actions_taken: string[];
  notifications_sent: Array<{
    role: string;
    sent_at: string;
    status: 'sent' | 'failed';
  }>;
  timestamp: string;
}

/**
 * Workers AI models for deadline management
 */
export const DEADLINE_AI_MODELS = {
  REASONING: '@cf/qwen/qwq-32b-preview',
  DEEPSEEK: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
} as const;

/**
 * Helper: Parse ISO duration to milliseconds
 */
export function parseDuration(isoDuration: string): number {
  // Parse ISO 8601 duration format (e.g., PT10M, PT1H, PT4H)
  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const match = isoDuration.match(regex);

  if (!match) {
    throw new Error(`Invalid ISO duration format: ${isoDuration}`);
  }

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Helper: Format milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return 'overdue';

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Helper: Calculate urgency level based on time remaining
 */
export function calculateUrgency(
  timeRemainingMs: number,
  totalTimeMs: number
): 'normal' | 'warning' | 'critical' {
  if (timeRemainingMs < 0) return 'critical'; // Overdue

  const percentRemaining = (timeRemainingMs / totalTimeMs) * 100;

  if (percentRemaining <= 10) return 'critical';
  if (percentRemaining <= 30) return 'warning';
  return 'normal';
}
