/**
 * PIR Manchester SP - FHIR Audit Event Collector
 *
 * Implements FHIR R4 AuditEvent collection for regulatory compliance.
 */

import {
  EvidenceEvent,
  FHIRAuditEvent,
  FHIRBundle,
  generateFHIRId,
  mapToFHIRAction
} from '../types/evidence';
import { BaseEvidenceCollector } from './base-collector';

/**
 * FHIR Audit Event collector (FHIR R4 compliant)
 */
export class FHIRAuditCollector extends BaseEvidenceCollector {
  protected isEnabled(): boolean {
    return this.config.fhir_audit.enabled;
  }

  async collect(event: EvidenceEvent): Promise<{
    success: boolean;
    storage_key?: string;
    error?: string;
  }> {
    if (!this.isEnabled()) {
      return { success: false, error: 'FHIR audit collection disabled' };
    }

    try {
      // Convert PIR event to FHIR AuditEvent
      const fhirEvent = this.convertToFHIRAuditEvent(event);

      // Store in KV
      const key = `fhir:audit:${fhirEvent.id}`;
      await this.storeInKV(key, fhirEvent);

      // If external endpoint configured, send to FHIR server
      if (this.config.fhir_audit.audit_endpoint) {
        await this.sendToFHIRServer(fhirEvent);
      }

      return {
        success: true,
        storage_key: key
      };

    } catch (error) {
      console.error('[FHIRAuditCollector] Error collecting evidence:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async retrieve(key: string): Promise<FHIRAuditEvent | null> {
    return await this.retrieveFromKV(key);
  }

  /**
   * Convert PIR event to FHIR R4 AuditEvent
   */
  private convertToFHIRAuditEvent(event: EvidenceEvent): FHIRAuditEvent {
    const fhirAction = mapToFHIRAction(event.action);

    const fhirEvent: FHIRAuditEvent = {
      resourceType: 'AuditEvent',
      id: generateFHIRId(),
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
        code: this.mapCategoryToFHIRCode(event.category),
        display: this.mapCategoryToFHIRDisplay(event.category)
      },
      subtype: [
        {
          system: 'http://voither.health/pir/audit-subtype',
          code: event.metadata.source_system,
          display: `PIR ${event.metadata.source_system}`
        }
      ],
      action: fhirAction,
      recorded: event.timestamp,
      outcome: '0', // Success (0 = Success, 4 = Minor failure, 8 = Serious failure, 12 = Major failure)
      outcomeDesc: undefined,

      agent: this.buildFHIRAgents(event),
      source: {
        observer: {
          reference: `Device/pir-${event.metadata.source_system}`,
          display: `PIR ${event.metadata.source_system.toUpperCase()}`
        },
        type: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/security-source-type',
            code: '4', // Application Server
            display: 'Application Server'
          }
        ]
      },
      entity: this.buildFHIREntities(event)
    };

    return fhirEvent;
  }

  /**
   * Build FHIR agent array
   */
  private buildFHIRAgents(event: EvidenceEvent): FHIRAuditEvent['agent'] {
    const agents: FHIRAuditEvent['agent'] = [];

    // System agent (PIR component)
    agents.push({
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
            code: 'datacollector',
            display: 'Data Collector'
          }
        ]
      },
      who: {
        reference: `Device/pir-${event.metadata.source_system}`,
        display: event.metadata.source_system
      },
      requestor: true
    });

    // User agent (if available)
    if (event.user_id) {
      agents.push({
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
              code: 'IRCP',
              display: 'information recipient'
            }
          ]
        },
        who: {
          reference: `Practitioner/${event.user_id}`,
          display: event.user_role || 'Healthcare Professional'
        },
        requestor: false,
        role: event.user_role ? [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0443',
                code: this.mapRoleToFHIRCode(event.user_role),
                display: event.user_role
              }
            ]
          }
        ] : undefined
      });
    }

    return agents;
  }

  /**
   * Build FHIR entity array
   */
  private buildFHIREntities(event: EvidenceEvent): FHIRAuditEvent['entity'] {
    const entities: FHIRAuditEvent['entity'] = [];

    // Patient entity (if available)
    if (event.patient_id) {
      entities.push({
        what: {
          reference: `Patient/${event.patient_id}`,
          display: 'Patient Record'
        },
        type: {
          system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
          code: '1', // Person
          display: 'Person'
        },
        role: {
          system: 'http://terminology.hl7.org/CodeSystem/object-role',
          code: '1', // Patient
          display: 'Patient'
        }
      });
    }

    // Session entity
    entities.push({
      what: {
        reference: `Encounter/${event.session_id}`,
        display: 'Triage Session'
      },
      type: {
        system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type',
        code: '2', // System Object
        display: 'System Object'
      },
      role: {
        system: 'http://terminology.hl7.org/CodeSystem/object-role',
        code: '13', // Security Resource
        display: 'Security Resource'
      },
      detail: [
        {
          type: 'session_id',
          valueString: event.session_id
        },
        {
          type: 'category',
          valueString: event.category
        },
        {
          type: 'source_system',
          valueString: event.metadata.source_system
        }
      ]
    });

    return entities;
  }

  /**
   * Map PIR category to FHIR event type code
   */
  private mapCategoryToFHIRCode(category: string): string {
    const mapping: Record<string, string> = {
      triage_session: 'rest',
      classification: 'execute',
      slot_extraction: 'access',
      task_execution: 'execute',
      guard_trigger: 'alert',
      deadline_check: 'execute',
      reward_calculation: 'execute',
      data_access: 'access',
      consent_change: 'update',
      override_action: 'execute'
    };

    return mapping[category] || 'rest';
  }

  /**
   * Map PIR category to FHIR display text
   */
  private mapCategoryToFHIRDisplay(category: string): string {
    const mapping: Record<string, string> = {
      triage_session: 'RESTful Operation',
      classification: 'Execute',
      slot_extraction: 'Access/View',
      task_execution: 'Execute',
      guard_trigger: 'Emergency/Alert',
      deadline_check: 'Execute',
      reward_calculation: 'Execute',
      data_access: 'Access/View',
      consent_change: 'Update',
      override_action: 'Execute'
    };

    return mapping[category] || 'RESTful Operation';
  }

  /**
   * Map user role to FHIR code
   */
  private mapRoleToFHIRCode(role: string): string {
    const mapping: Record<string, string> = {
      physician: 'MD',
      nurse: 'RN',
      attending_physician: 'ATTPHYS',
      charge_nurse: 'RN',
      medical_director: 'DIRMED',
      cardiologist: 'CARD',
      neurologist: 'NEUR',
      intensivist: 'INTENS',
      trauma_surgeon: 'SURG',
      supervisor: 'SUPV'
    };

    return mapping[role] || 'HPRF'; // Healthcare Professional
  }

  /**
   * Create FHIR Bundle from multiple AuditEvents
   */
  async createBundle(auditEventIds: string[]): Promise<FHIRBundle> {
    const entries: FHIRBundle['entry'] = [];

    for (const id of auditEventIds) {
      const key = `fhir:audit:${id}`;
      const event = await this.retrieveFromKV(key) as FHIRAuditEvent | null;

      if (event) {
        entries.push({
          fullUrl: `urn:uuid:${event.id}`,
          resource: event,
          request: {
            method: 'POST',
            url: 'AuditEvent'
          }
        });
      }
    }

    const bundle: FHIRBundle = {
      resourceType: 'Bundle',
      id: generateFHIRId(),
      type: 'transaction',
      timestamp: new Date().toISOString(),
      total: entries.length,
      entry: entries
    };

    return bundle;
  }

  /**
   * Send AuditEvent to external FHIR server
   */
  private async sendToFHIRServer(event: FHIRAuditEvent): Promise<void> {
    if (!this.config.fhir_audit.audit_endpoint) {
      return;
    }

    try {
      const response = await fetch(this.config.fhir_audit.audit_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        console.error(`[FHIRAuditCollector] Failed to send to FHIR server: ${response.status}`);
      }

    } catch (error) {
      console.error('[FHIRAuditCollector] Error sending to FHIR server:', error);
    }
  }

  /**
   * Export bundle to external FHIR server
   */
  async exportBundle(bundle: FHIRBundle): Promise<void> {
    if (!this.config.fhir_audit.audit_endpoint) {
      return;
    }

    try {
      const response = await fetch(this.config.fhir_audit.audit_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(bundle)
      });

      if (!response.ok) {
        console.error(`[FHIRAuditCollector] Failed to export bundle: ${response.status}`);
      }

    } catch (error) {
      console.error('[FHIRAuditCollector] Error exporting bundle:', error);
    }
  }
}
