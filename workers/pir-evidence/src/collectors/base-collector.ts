/**
 * PIR Manchester SP - Evidence Collectors Base Classes
 *
 * Base abstractions for evidence collectors that handle different types
 * of audit trails and compliance requirements.
 */

import {
  EvidenceEvent,
  EvidenceType,
  EvidenceConfig,
  PatientTimeline,
  PatientTimelineEvent,
  SystemAggregateEvent,
  FHIRAuditEvent,
  ConsentStatus,
  AccessLog,
  isConsentValid,
  calculateRetentionDeadline,
  EVIDENCE_AI_MODELS
} from '../types/evidence';

export interface EvidenceCollectorConfig {
  config: EvidenceConfig;
  storage: KVNamespace;
}

/**
 * Abstract base class for all evidence collectors
 */
export abstract class BaseEvidenceCollector {
  protected ai: Ai;
  protected config: EvidenceConfig;
  protected storage: KVNamespace;

  constructor(ai: Ai, collectorConfig: EvidenceCollectorConfig) {
    this.ai = ai;
    this.config = collectorConfig.config;
    this.storage = collectorConfig.storage;
  }

  /**
   * Collect evidence event
   */
  abstract collect(event: EvidenceEvent): Promise<{
    success: boolean;
    storage_key?: string;
    error?: string;
  }>;

  /**
   * Retrieve evidence
   */
  abstract retrieve(key: string): Promise<any>;

  /**
   * Check if collection is enabled
   */
  protected abstract isEnabled(): boolean;

  /**
   * Validate consent before collecting PHI
   */
  protected async validateConsent(patientId: string): Promise<boolean> {
    if (!this.config.consent_tracking.enabled) {
      return true; // Consent not required
    }

    try {
      const consentKey = `consent:${patientId}`;
      const consentData = await this.storage.get(consentKey);

      if (!consentData) {
        console.warn(`[BaseEvidenceCollector] No consent found for patient: ${patientId}`);
        return false;
      }

      const consent = JSON.parse(consentData) as ConsentStatus;
      return isConsentValid(consent);

    } catch (error) {
      console.error('[BaseEvidenceCollector] Error validating consent:', error);
      return false;
    }
  }

  /**
   * Encrypt data using Web Crypto API
   */
  protected async encryptData(
    data: string,
    keyId: string
  ): Promise<{
    encrypted: string;
    iv: string;
    tag: string;
  }> {
    // In production, retrieve encryption key from secure key management
    // For now, use a derived key (DEMO ONLY - DO NOT USE IN PRODUCTION)
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Import key (DEMO - in production, use proper key management)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(keyId.padEnd(32, '0')),
      'AES-GCM',
      false,
      ['encrypt']
    );

    // Encrypt
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      keyMaterial,
      dataBuffer
    );

    // Convert to base64
    const encryptedArray = new Uint8Array(encryptedBuffer);
    const encrypted = btoa(String.fromCharCode(...encryptedArray));
    const ivBase64 = btoa(String.fromCharCode(...iv));

    return {
      encrypted,
      iv: ivBase64,
      tag: '' // Tag is included in encryptedBuffer for AES-GCM
    };
  }

  /**
   * Decrypt data using Web Crypto API
   */
  protected async decryptData(
    encrypted: string,
    iv: string,
    keyId: string
  ): Promise<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Decode base64
    const encryptedBuffer = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const ivBuffer = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

    // Import key
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(keyId.padEnd(32, '0')),
      'AES-GCM',
      false,
      ['decrypt']
    );

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuffer
      },
      keyMaterial,
      encryptedBuffer
    );

    return decoder.decode(decryptedBuffer);
  }

  /**
   * Anonymize data using Workers AI
   */
  protected async anonymizeData(data: Record<string, any>): Promise<Record<string, any>> {
    // Remove obvious PHI fields
    const anonymized = { ...data };
    delete anonymized.patient_id;
    delete anonymized.patient_name;
    delete anonymized.cpf;
    delete anonymized.address;
    delete anonymized.phone;
    delete anonymized.email;

    // Use AI to detect and remove additional PHI
    try {
      const systemPrompt = `Você é um sistema de ANONIMIZAÇÃO DE DADOS para LGPD compliance.

Analise os dados e REMOVA todos os identificadores pessoais (PHI):
- Nomes, CPF, RG, endereços, telefones, emails
- Datas de nascimento exatas (substitua por faixa etária)
- Dados clínicos muito específicos que possam identificar

MANTENHA apenas:
- Classificação de triagem (vermelho/laranja/amarelo/verde/azul)
- Fluxograma usado
- Guards disparados
- Tempos de atendimento
- Desfechos agregados

Responda APENAS com JSON anonimizado.`;

      const userPrompt = `Dados para anonimizar:\n${JSON.stringify(data, null, 2)}`;

      const response = await this.ai.run(EVIDENCE_AI_MODELS.ANONYMIZATION, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      });

      // @ts-ignore - Workers AI types
      const responseText = response.response || '';

      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(cleaned);

    } catch (error) {
      console.error('[BaseEvidenceCollector] AI anonymization failed, using rule-based:', error);
      return anonymized;
    }
  }

  /**
   * Store data in KV with expiration
   */
  protected async storeInKV(
    key: string,
    data: any,
    expirationTtl?: number
  ): Promise<void> {
    const options: any = {};
    if (expirationTtl) {
      options.expirationTtl = expirationTtl;
    }

    await this.storage.put(key, JSON.stringify(data), options);
  }

  /**
   * Retrieve data from KV
   */
  protected async retrieveFromKV(key: string): Promise<any | null> {
    const data = await this.storage.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Delete data from KV
   */
  protected async deleteFromKV(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  /**
   * List keys by prefix
   */
  protected async listKeys(prefix: string): Promise<string[]> {
    const list = await this.storage.list({ prefix });
    return list.keys.map(k => k.name);
  }
}

/**
 * Patient timeline collector (PHI, encrypted)
 */
export class PatientTimelineCollector extends BaseEvidenceCollector {
  protected isEnabled(): boolean {
    return this.config.patient_local.enabled;
  }

  async collect(event: EvidenceEvent): Promise<{
    success: boolean;
    storage_key?: string;
    error?: string;
  }> {
    if (!this.isEnabled()) {
      return { success: false, error: 'Patient timeline collection disabled' };
    }

    if (!event.patient_id) {
      return { success: false, error: 'Patient ID required for timeline collection' };
    }

    // Validate consent
    const hasConsent = await this.validateConsent(event.patient_id);
    if (!hasConsent) {
      return { success: false, error: 'Patient consent not granted' };
    }

    try {
      // Get or create timeline
      const timelineKey = `timeline:${event.patient_id}`;
      let timeline = await this.retrieveFromKV(timelineKey) as PatientTimeline | null;

      if (!timeline) {
        timeline = this.createNewTimeline(event.patient_id);
      }

      // Encrypt event data
      const encrypted = await this.encryptData(
        JSON.stringify(event.data),
        timeline.encryption_key_id
      );

      // Add event to timeline
      const timelineEvent: PatientTimelineEvent = {
        event_id: event.event_id,
        timestamp: event.timestamp,
        category: event.category,
        action: event.action,
        description: this.generateEventDescription(event),
        encrypted_data: encrypted.encrypted,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag
      };

      timeline.events.push(timelineEvent);
      timeline.updated_at = event.timestamp;

      // Store with TTL based on retention policy
      const retentionTtl = this.config.patient_local.retention_days * 24 * 60 * 60;
      await this.storeInKV(timelineKey, timeline, retentionTtl);

      return {
        success: true,
        storage_key: timelineKey
      };

    } catch (error) {
      console.error('[PatientTimelineCollector] Error collecting evidence:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async retrieve(key: string): Promise<PatientTimeline | null> {
    return await this.retrieveFromKV(key);
  }

  /**
   * Create new patient timeline
   */
  private createNewTimeline(patientId: string): PatientTimeline {
    const now = new Date().toISOString();
    const encryptionKeyId = `key:${patientId}:${Date.now()}`;

    return {
      patient_id: patientId,
      timeline_id: `timeline:${patientId}:${Date.now()}`,
      created_at: now,
      updated_at: now,
      encryption_key_id: encryptionKeyId,
      consent_status: {
        consent_id: `consent:${patientId}`,
        patient_id: patientId,
        consent_version: this.config.consent_tracking.consent_version || '1.0',
        granted_at: now,
        status: 'granted',
        permissions: {
          collect_phi: true,
          store_timeline: true,
          share_anonymized: true,
          export_fhir: true
        }
      },
      events: [],
      retention_until: calculateRetentionDeadline(now, this.config.patient_local.retention_days),
      anonymize_after: calculateRetentionDeadline(now, this.config.patient_local.auto_anonymize_after_days),
      anonymized: false
    };
  }

  /**
   * Generate human-readable event description
   */
  private generateEventDescription(event: EvidenceEvent): string {
    const categoryDescriptions: Record<string, string> = {
      triage_session: 'Sessão de triagem',
      classification: 'Classificação de prioridade',
      slot_extraction: 'Extração de dados clínicos',
      task_execution: 'Execução de tarefa',
      guard_trigger: 'Alerta de segurança disparado',
      deadline_check: 'Verificação de prazo',
      reward_calculation: 'Cálculo de desempenho',
      data_access: 'Acesso aos dados',
      consent_change: 'Alteração de consentimento',
      override_action: 'Ação de override'
    };

    return categoryDescriptions[event.category] || event.category;
  }

  /**
   * Anonymize old timeline (LGPD compliance)
   */
  async anonymizeTimeline(patientId: string): Promise<void> {
    const timelineKey = `timeline:${patientId}`;
    const timeline = await this.retrieveFromKV(timelineKey) as PatientTimeline | null;

    if (!timeline) return;

    // Remove all encrypted data, keep only metadata
    timeline.events = timeline.events.map(e => ({
      ...e,
      encrypted_data: '[ANONYMIZED]',
      encryption_iv: '',
      encryption_tag: ''
    }));

    timeline.anonymized = true;
    timeline.patient_id = `[ANONYMIZED:${Date.now()}]`;

    await this.storeInKV(timelineKey, timeline);
  }
}

/**
 * System aggregate collector (no PHI, de-identified)
 */
export class SystemAggregateCollector extends BaseEvidenceCollector {
  protected isEnabled(): boolean {
    return this.config.system_aggregate.enabled;
  }

  async collect(event: EvidenceEvent): Promise<{
    success: boolean;
    storage_key?: string;
    error?: string;
  }> {
    if (!this.isEnabled()) {
      return { success: false, error: 'System aggregate collection disabled' };
    }

    try {
      // Anonymize event data
      const anonymized = await this.anonymizeData(event.data);

      // Get current aggregation window
      const windowKey = this.getCurrentWindowKey();
      let aggregate = await this.retrieveFromKV(windowKey) as SystemAggregateEvent | null;

      if (!aggregate) {
        aggregate = this.createNewAggregate();
      }

      // Update aggregate metrics
      this.updateAggregateMetrics(aggregate, event, anonymized);

      // Store aggregate
      await this.storeInKV(windowKey, aggregate);

      return {
        success: true,
        storage_key: windowKey
      };

    } catch (error) {
      console.error('[SystemAggregateCollector] Error collecting evidence:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async retrieve(key: string): Promise<SystemAggregateEvent | null> {
    return await this.retrieveFromKV(key);
  }

  /**
   * Get current aggregation window key
   */
  private getCurrentWindowKey(): string {
    const now = new Date();
    const windowHours = this.config.system_aggregate.aggregation_window_hours;
    const windowStart = new Date(now.getTime() - (now.getTime() % (windowHours * 3600000)));
    const windowStartStr = windowStart.toISOString().split('.')[0]; // Remove milliseconds

    return `aggregate:${windowStartStr}`;
  }

  /**
   * Create new aggregate
   */
  private createNewAggregate(): SystemAggregateEvent {
    const now = new Date();
    const windowHours = this.config.system_aggregate.aggregation_window_hours;
    const windowStart = new Date(now.getTime() - (now.getTime() % (windowHours * 3600000)));
    const windowEnd = new Date(windowStart.getTime() + windowHours * 3600000);

    return {
      aggregate_id: `agg:${Date.now()}`,
      aggregation_window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString()
      },
      event_count: 0,
      metrics: {
        total_sessions: 0,
        classifications: {},
        flowcharts: {},
        guards_triggered: {},
        deadlines_met: 0,
        deadlines_missed: 0,
        average_triage_time_ms: 0,
        patterns_detected: {}
      },
      learning_patterns: [],
      anonymization_level: this.config.system_aggregate.anonymization_level,
      send_to_rre: this.config.system_aggregate.send_to_rre
    };
  }

  /**
   * Update aggregate metrics
   */
  private updateAggregateMetrics(
    aggregate: SystemAggregateEvent,
    event: EvidenceEvent,
    anonymized: Record<string, any>
  ): void {
    aggregate.event_count++;

    // Update based on event category
    if (event.category === 'triage_session') {
      aggregate.metrics.total_sessions++;
    }

    if (event.category === 'classification' && anonymized.classification) {
      aggregate.metrics.classifications[anonymized.classification] =
        (aggregate.metrics.classifications[anonymized.classification] || 0) + 1;
    }

    if (anonymized.flowchart) {
      aggregate.metrics.flowcharts[anonymized.flowchart] =
        (aggregate.metrics.flowcharts[anonymized.flowchart] || 0) + 1;
    }

    if (event.category === 'guard_trigger' && anonymized.guard_id) {
      aggregate.metrics.guards_triggered[anonymized.guard_id] =
        (aggregate.metrics.guards_triggered[anonymized.guard_id] || 0) + 1;
    }

    if (event.category === 'deadline_check') {
      if (anonymized.met) {
        aggregate.metrics.deadlines_met++;
      } else {
        aggregate.metrics.deadlines_missed++;
      }
    }
  }
}
