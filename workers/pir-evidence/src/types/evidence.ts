/**
 * PIR Manchester SP - Evidence Types
 *
 * Defines audit trail and evidence collection system for regulatory compliance.
 * Implements FHIR-compliant audit bundles and LGPD-compliant data handling.
 */

export type EvidenceType =
  | 'patient_local' // Patient-specific encrypted timeline (PHI)
  | 'system_aggregate' // De-identified system-level patterns (no PHI)
  | 'fhir_audit' // FHIR AuditEvent bundles for regulatory compliance
  | 'consent_log' // LGPD consent trail
  | 'access_log'; // Access control audit

export type EventCategory =
  | 'triage_session'
  | 'classification'
  | 'slot_extraction'
  | 'task_execution'
  | 'guard_trigger'
  | 'deadline_check'
  | 'reward_calculation'
  | 'data_access'
  | 'consent_change'
  | 'override_action';

export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'execute'
  | 'trigger'
  | 'override'
  | 'export';

/**
 * Evidence collection configuration from PIR JSON
 */
export interface EvidenceConfig {
  patient_local: {
    enabled: boolean;
    encryption: 'aes-256-gcm' | 'chacha20-poly1305';
    retention_days: number; // LGPD retention period
    auto_anonymize_after_days: number; // Auto-anonymize after N days
  };
  system_aggregate: {
    enabled: boolean;
    anonymization_level: 'high' | 'medium' | 'low';
    aggregation_window_hours: number;
    send_to_rre: boolean;
  };
  fhir_audit: {
    enabled: boolean;
    fhir_version: '4.0.1' | '5.0.0';
    include_provenance: boolean;
    audit_endpoint?: string; // External FHIR server
  };
  consent_tracking: {
    enabled: boolean;
    require_explicit_consent: boolean;
    consent_version: string;
  };
}

/**
 * Base evidence event
 */
export interface EvidenceEvent {
  event_id: string;
  event_type: EvidenceType;
  category: EventCategory;
  action: AuditAction;
  timestamp: string;
  session_id: string;
  patient_id?: string; // Only for patient_local
  user_id?: string;
  user_role?: string;

  // Event-specific data
  data: Record<string, any>;

  // Metadata
  metadata: {
    source_system: 'pir-slots' | 'pir-tasks' | 'pir-guards' | 'pir-deadlines' | 'pir-rewards';
    version: string;
    environment: 'production' | 'staging' | 'development';
  };
}

/**
 * Patient-local encrypted timeline (PHI)
 */
export interface PatientTimeline {
  patient_id: string;
  timeline_id: string;
  created_at: string;
  updated_at: string;
  encryption_key_id: string; // Reference to encryption key (patient-controlled)
  consent_status: ConsentStatus;

  events: PatientTimelineEvent[];

  // Retention and anonymization
  retention_until: string; // ISO timestamp
  anonymize_after: string; // ISO timestamp
  anonymized: boolean;
}

export interface PatientTimelineEvent {
  event_id: string;
  timestamp: string;
  category: EventCategory;
  action: AuditAction;
  description: string;
  encrypted_data: string; // AES-256-GCM encrypted JSON
  encryption_iv: string; // Initialization vector
  encryption_tag: string; // Authentication tag
}

/**
 * System-aggregate de-identified data (no PHI)
 */
export interface SystemAggregateEvent {
  aggregate_id: string;
  aggregation_window: {
    start: string;
    end: string;
  };
  event_count: number;

  // Aggregated metrics (no PHI)
  metrics: {
    total_sessions: number;
    classifications: Record<string, number>; // { "vermelho": 12, "laranja": 45, ... }
    flowcharts: Record<string, number>;
    guards_triggered: Record<string, number>;
    deadlines_met: number;
    deadlines_missed: number;
    average_triage_time_ms: number;
    patterns_detected: Record<string, number>;
  };

  // For RRE learning
  learning_patterns: Array<{
    pattern_type: string;
    frequency: number;
    success_rate: number;
    context: Record<string, any>; // De-identified context
  }>;

  anonymization_level: 'high' | 'medium' | 'low';
  send_to_rre: boolean;
}

/**
 * FHIR R4 AuditEvent (simplified)
 * Full spec: http://hl7.org/fhir/R4/auditevent.html
 */
export interface FHIRAuditEvent {
  resourceType: 'AuditEvent';
  id: string;
  type: {
    system: 'http://terminology.hl7.org/CodeSystem/audit-event-type';
    code: string;
    display: string;
  };
  subtype?: Array<{
    system: string;
    code: string;
    display: string;
  }>;
  action: 'C' | 'R' | 'U' | 'D' | 'E'; // Create, Read, Update, Delete, Execute
  recorded: string; // ISO timestamp
  outcome: '0' | '4' | '8' | '12'; // Success, Minor failure, Serious failure, Major failure
  outcomeDesc?: string;

  agent: Array<{
    type?: {
      coding: Array<{
        system: string;
        code: string;
        display: string;
      }>;
    };
    who?: {
      reference: string;
      display?: string;
    };
    requestor: boolean;
    role?: Array<{
      coding: Array<{
        system: string;
        code: string;
        display: string;
      }>;
    }>;
  }>;

  source: {
    observer: {
      reference: string;
      display?: string;
    };
    type?: Array<{
      system: string;
      code: string;
      display: string;
    }>;
  };

  entity?: Array<{
    what?: {
      reference: string;
      display?: string;
    };
    type?: {
      system: string;
      code: string;
      display: string;
    };
    role?: {
      system: string;
      code: string;
      display: string;
    };
    lifecycle?: {
      system: string;
      code: string;
      display: string;
    };
    detail?: Array<{
      type: string;
      valueString?: string;
      valueBase64Binary?: string;
    }>;
  }>;
}

/**
 * FHIR R4 Bundle for batch audit events
 */
export interface FHIRBundle {
  resourceType: 'Bundle';
  id: string;
  type: 'transaction' | 'batch' | 'collection';
  timestamp: string;
  total?: number;
  entry: Array<{
    fullUrl?: string;
    resource: FHIRAuditEvent;
    request?: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      url: string;
    };
  }>;
}

/**
 * LGPD Consent tracking
 */
export interface ConsentStatus {
  consent_id: string;
  patient_id: string;
  consent_version: string;
  granted_at: string;
  revoked_at?: string;
  status: 'granted' | 'revoked' | 'expired';

  permissions: {
    collect_phi: boolean; // Collect Protected Health Information
    store_timeline: boolean; // Store patient timeline
    share_anonymized: boolean; // Share de-identified data for system learning
    export_fhir: boolean; // Export to external FHIR servers
  };

  // LGPD Article 9 - Rights
  rights_exercised?: Array<{
    right_type: 'access' | 'rectification' | 'deletion' | 'portability' | 'revocation';
    exercised_at: string;
    fulfilled_at?: string;
    status: 'pending' | 'fulfilled' | 'rejected';
  }>;
}

/**
 * Access log for data access audit
 */
export interface AccessLog {
  access_id: string;
  timestamp: string;
  user_id: string;
  user_role: string;
  patient_id?: string;
  action: 'read' | 'write' | 'export' | 'delete';
  resource_type: string;
  resource_id: string;
  ip_address?: string;
  user_agent?: string;
  justification?: string; // Why was data accessed?
  authorized: boolean;
  authorization_method?: 'role_based' | 'consent_based' | 'emergency_override';
}

/**
 * Evidence collection result
 */
export interface EvidenceCollectionResult {
  session_id: string;
  timestamp: string;
  events_collected: number;
  storage_locations: {
    patient_timeline?: string; // KV key
    system_aggregate?: string; // KV key
    fhir_bundle?: string; // KV key or external URL
  };
  encryption_applied: boolean;
  fhir_compliant: boolean;
  lgpd_compliant: boolean;
  errors?: string[];
}

/**
 * Workers AI models for evidence processing
 */
export const EVIDENCE_AI_MODELS = {
  ANONYMIZATION: '@cf/qwen/qwq-32b-preview',
  PATTERN_EXTRACTION: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
} as const;

/**
 * Helper: Generate FHIR-compliant ID
 */
export function generateFHIRId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Helper: Map PIR action to FHIR action code
 */
export function mapToFHIRAction(action: AuditAction): 'C' | 'R' | 'U' | 'D' | 'E' {
  switch (action) {
    case 'create': return 'C';
    case 'read': return 'R';
    case 'update': return 'U';
    case 'delete': return 'D';
    case 'execute':
    case 'trigger':
    case 'override':
    case 'export':
      return 'E';
    default: return 'R';
  }
}

/**
 * Helper: Check if consent is valid
 */
export function isConsentValid(consent: ConsentStatus): boolean {
  if (consent.status !== 'granted') return false;
  if (consent.revoked_at) return false;
  return true;
}

/**
 * Helper: Calculate retention deadline
 */
export function calculateRetentionDeadline(createdAt: string, retentionDays: number): string {
  const created = new Date(createdAt);
  const deadline = new Date(created.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  return deadline.toISOString();
}
