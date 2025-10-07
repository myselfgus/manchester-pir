/**
 * PIR Manchester SP - Evidence Orchestrator
 *
 * Orchestrates collection of evidence across multiple collectors:
 * - Patient timelines (encrypted PHI)
 * - System aggregates (de-identified)
 * - FHIR audit events (compliance)
 * - Consent logs (LGPD)
 * - Access logs (security)
 */

import {
  EvidenceEvent,
  EvidenceConfig,
  EvidenceCollectionResult,
  ConsentStatus,
  AccessLog,
  isConsentValid
} from '../types/evidence';
import {
  PatientTimelineCollector,
  SystemAggregateCollector
} from '../collectors/base-collector';
import { FHIRAuditCollector } from '../collectors/fhir-collector';

export class EvidenceOrchestrator {
  private ai: Ai;
  private storage: KVNamespace;
  private config: EvidenceConfig;

  private patientCollector: PatientTimelineCollector;
  private aggregateCollector: SystemAggregateCollector;
  private fhirCollector: FHIRAuditCollector;

  constructor(ai: Ai, storage: KVNamespace, config: EvidenceConfig) {
    this.ai = ai;
    this.storage = storage;
    this.config = config;

    // Initialize collectors
    const collectorConfig = { config, storage };

    this.patientCollector = new PatientTimelineCollector(ai, collectorConfig);
    this.aggregateCollector = new SystemAggregateCollector(ai, collectorConfig);
    this.fhirCollector = new FHIRAuditCollector(ai, collectorConfig);
  }

  /**
   * Collect evidence event across all enabled collectors
   */
  async collectEvidence(event: EvidenceEvent): Promise<EvidenceCollectionResult> {
    const startTime = Date.now();
    const result: EvidenceCollectionResult = {
      session_id: event.session_id,
      timestamp: event.timestamp,
      events_collected: 0,
      storage_locations: {},
      encryption_applied: false,
      fhir_compliant: false,
      lgpd_compliant: false,
      errors: []
    };

    // Collect in parallel for performance
    const collectionPromises: Promise<any>[] = [];

    // Patient timeline (encrypted PHI)
    if (this.config.patient_local.enabled && event.patient_id) {
      collectionPromises.push(
        this.patientCollector.collect(event)
          .then(res => {
            if (res.success) {
              result.events_collected++;
              result.storage_locations.patient_timeline = res.storage_key;
              result.encryption_applied = true;
              result.lgpd_compliant = true;
            } else if (res.error) {
              result.errors?.push(`Patient timeline: ${res.error}`);
            }
          })
          .catch(err => {
            result.errors?.push(`Patient timeline error: ${err.message}`);
          })
      );
    }

    // System aggregate (de-identified)
    if (this.config.system_aggregate.enabled) {
      collectionPromises.push(
        this.aggregateCollector.collect(event)
          .then(res => {
            if (res.success) {
              result.events_collected++;
              result.storage_locations.system_aggregate = res.storage_key;
            } else if (res.error) {
              result.errors?.push(`System aggregate: ${res.error}`);
            }
          })
          .catch(err => {
            result.errors?.push(`System aggregate error: ${err.message}`);
          })
      );
    }

    // FHIR audit event
    if (this.config.fhir_audit.enabled) {
      collectionPromises.push(
        this.fhirCollector.collect(event)
          .then(res => {
            if (res.success) {
              result.events_collected++;
              result.storage_locations.fhir_bundle = res.storage_key;
              result.fhir_compliant = true;
            } else if (res.error) {
              result.errors?.push(`FHIR audit: ${res.error}`);
            }
          })
          .catch(err => {
            result.errors?.push(`FHIR audit error: ${err.message}`);
          })
      );
    }

    // Wait for all collections to complete
    await Promise.all(collectionPromises);

    return result;
  }

  /**
   * Batch collect multiple events
   */
  async collectBatch(events: EvidenceEvent[]): Promise<EvidenceCollectionResult[]> {
    const results: EvidenceCollectionResult[] = [];

    // Collect in parallel for better performance
    const promises = events.map(event => this.collectEvidence(event));
    const settled = await Promise.allSettled(promises);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error('[EvidenceOrchestrator] Batch collection error:', result.reason);
      }
    }

    return results;
  }

  /**
   * Grant patient consent
   */
  async grantConsent(consent: ConsentStatus): Promise<void> {
    const key = `consent:${consent.patient_id}`;
    await this.storage.put(key, JSON.stringify(consent));

    // Log consent event
    const consentEvent: EvidenceEvent = {
      event_id: `consent:${Date.now()}`,
      event_type: 'consent_log',
      category: 'consent_change',
      action: 'create',
      timestamp: consent.granted_at,
      session_id: `consent:${consent.patient_id}`,
      patient_id: consent.patient_id,
      data: {
        consent_id: consent.consent_id,
        permissions: consent.permissions,
        status: 'granted'
      },
      metadata: {
        source_system: 'pir-evidence' as any,
        version: '1.0.0',
        environment: 'production'
      }
    };

    await this.collectEvidence(consentEvent);
  }

  /**
   * Revoke patient consent
   */
  async revokeConsent(patientId: string, reason?: string): Promise<void> {
    const key = `consent:${patientId}`;
    const consentData = await this.storage.get(key);

    if (!consentData) {
      throw new Error(`No consent found for patient: ${patientId}`);
    }

    const consent = JSON.parse(consentData) as ConsentStatus;
    consent.status = 'revoked';
    consent.revoked_at = new Date().toISOString();

    await this.storage.put(key, JSON.stringify(consent));

    // Log revocation event
    const revocationEvent: EvidenceEvent = {
      event_id: `consent:revoke:${Date.now()}`,
      event_type: 'consent_log',
      category: 'consent_change',
      action: 'update',
      timestamp: consent.revoked_at,
      session_id: `consent:${patientId}`,
      patient_id: patientId,
      data: {
        consent_id: consent.consent_id,
        status: 'revoked',
        reason: reason || 'Patient request'
      },
      metadata: {
        source_system: 'pir-evidence' as any,
        version: '1.0.0',
        environment: 'production'
      }
    };

    await this.collectEvidence(revocationEvent);
  }

  /**
   * Check patient consent status
   */
  async checkConsent(patientId: string): Promise<ConsentStatus | null> {
    const key = `consent:${patientId}`;
    const consentData = await this.storage.get(key);

    if (!consentData) {
      return null;
    }

    return JSON.parse(consentData) as ConsentStatus;
  }

  /**
   * Log data access (LGPD Article 9 - Right to access)
   */
  async logAccess(access: AccessLog): Promise<void> {
    const key = `access:${access.access_id}`;
    await this.storage.put(key, JSON.stringify(access));

    // Create evidence event
    const accessEvent: EvidenceEvent = {
      event_id: access.access_id,
      event_type: 'access_log',
      category: 'data_access',
      action: access.action as any,
      timestamp: access.timestamp,
      session_id: `access:${access.access_id}`,
      patient_id: access.patient_id,
      user_id: access.user_id,
      user_role: access.user_role,
      data: {
        resource_type: access.resource_type,
        resource_id: access.resource_id,
        authorized: access.authorized,
        authorization_method: access.authorization_method,
        justification: access.justification,
        ip_address: access.ip_address
      },
      metadata: {
        source_system: 'pir-evidence' as any,
        version: '1.0.0',
        environment: 'production'
      }
    };

    await this.collectEvidence(accessEvent);
  }

  /**
   * Exercise LGPD right (Article 9)
   */
  async exerciseRight(
    patientId: string,
    rightType: 'access' | 'rectification' | 'deletion' | 'portability' | 'revocation'
  ): Promise<void> {
    const consent = await this.checkConsent(patientId);

    if (!consent) {
      throw new Error(`No consent found for patient: ${patientId}`);
    }

    // Add right to consent record
    if (!consent.rights_exercised) {
      consent.rights_exercised = [];
    }

    const rightExercise = {
      right_type: rightType,
      exercised_at: new Date().toISOString(),
      status: 'pending' as const
    };

    consent.rights_exercised.push(rightExercise);

    // Update consent
    const key = `consent:${patientId}`;
    await this.storage.put(key, JSON.stringify(consent));

    // Log right exercise
    const rightEvent: EvidenceEvent = {
      event_id: `right:${rightType}:${Date.now()}`,
      event_type: 'consent_log',
      category: 'consent_change',
      action: 'update',
      timestamp: rightExercise.exercised_at,
      session_id: `right:${patientId}`,
      patient_id: patientId,
      data: {
        right_type: rightType,
        status: 'pending'
      },
      metadata: {
        source_system: 'pir-evidence' as any,
        version: '1.0.0',
        environment: 'production'
      }
    };

    await this.collectEvidence(rightEvent);

    // Execute right
    await this.executeRight(patientId, rightType);
  }

  /**
   * Execute LGPD right
   */
  private async executeRight(
    patientId: string,
    rightType: 'access' | 'rectification' | 'deletion' | 'portability' | 'revocation'
  ): Promise<void> {
    switch (rightType) {
      case 'access':
        // Provide patient with their data
        // Implementation would export patient timeline
        break;

      case 'rectification':
        // Allow patient to correct their data
        break;

      case 'deletion':
        // Delete patient data (right to be forgotten)
        await this.deletePatientData(patientId);
        break;

      case 'portability':
        // Export data in machine-readable format
        // Implementation would export FHIR bundle
        break;

      case 'revocation':
        // Revoke consent
        await this.revokeConsent(patientId, 'LGPD Right Exercise');
        break;
    }
  }

  /**
   * Delete patient data (LGPD Right to Deletion)
   */
  private async deletePatientData(patientId: string): Promise<void> {
    // Delete patient timeline
    const timelineKey = `timeline:${patientId}`;
    await this.storage.delete(timelineKey);

    // Delete consent
    const consentKey = `consent:${patientId}`;
    await this.storage.delete(consentKey);

    // Note: FHIR audit events and system aggregates are preserved
    // (de-identified, required for regulatory compliance)
  }

  /**
   * Export patient data as FHIR bundle (LGPD Right to Portability)
   */
  async exportPatientData(patientId: string): Promise<any> {
    const consent = await this.checkConsent(patientId);

    if (!consent || !isConsentValid(consent)) {
      throw new Error('Invalid or missing consent');
    }

    if (!consent.permissions.export_fhir) {
      throw new Error('Patient has not granted FHIR export permission');
    }

    // Get patient timeline
    const timelineKey = `timeline:${patientId}`;
    const timeline = await this.patientCollector.retrieve(timelineKey);

    if (!timeline) {
      throw new Error('No timeline found for patient');
    }

    // Get FHIR audit events for this patient
    const auditKeys = await this.storage.list({ prefix: 'fhir:audit:' });
    const auditEventIds = auditKeys.keys
      .map(k => k.name.replace('fhir:audit:', ''))
      .slice(0, 100); // Limit to last 100 events

    // Create FHIR bundle
    const bundle = await this.fhirCollector.createBundle(auditEventIds);

    // Log export access
    await this.logAccess({
      access_id: `export:${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_id: patientId,
      user_role: 'patient',
      patient_id: patientId,
      action: 'export',
      resource_type: 'PatientTimeline',
      resource_id: timeline.timeline_id,
      authorized: true,
      authorization_method: 'consent_based'
    });

    return {
      patient_timeline: timeline,
      fhir_bundle: bundle
    };
  }

  /**
   * Cleanup old evidence (retention policy)
   */
  async cleanupOldEvidence(): Promise<{
    deleted_timelines: number;
    anonymized_timelines: number;
    deleted_aggregates: number;
  }> {
    const result = {
      deleted_timelines: 0,
      anonymized_timelines: 0,
      deleted_aggregates: 0
    };

    const now = Date.now();

    // Cleanup patient timelines
    const timelineKeys = await this.storage.list({ prefix: 'timeline:' });

    for (const key of timelineKeys.keys) {
      const timeline = await this.patientCollector.retrieve(key.name);

      if (!timeline) continue;

      const retentionDeadline = new Date(timeline.retention_until).getTime();
      const anonymizeDeadline = new Date(timeline.anonymize_after).getTime();

      // Delete if past retention period
      if (now > retentionDeadline) {
        await this.storage.delete(key.name);
        result.deleted_timelines++;
      }
      // Anonymize if past anonymization period
      else if (now > anonymizeDeadline && !timeline.anonymized) {
        await this.patientCollector.anonymizeTimeline(timeline.patient_id);
        result.anonymized_timelines++;
      }
    }

    return result;
  }
}
