/**
 * PIR Manchester SP - Evidence Executor Worker
 *
 * Cloudflare Worker que coleta evidence/audit trail usando Workers AI.
 * Implementa FHIR R4 compliance + LGPD compliance.
 *
 * Endpoints:
 * - POST /api/evidence/collect - Coleta evento de evidence
 * - POST /api/evidence/batch - Coleta batch de eventos
 * - GET /api/evidence/timeline/:patientId - Timeline do paciente (requer consentimento)
 * - POST /api/consent/grant - Concede consentimento LGPD
 * - POST /api/consent/revoke - Revoga consentimento LGPD
 * - GET /api/consent/:patientId - Verifica consentimento
 * - POST /api/access/log - Registra acesso a dados
 * - POST /api/rights/exercise - Exercer direito LGPD (Art. 9)
 * - GET /api/export/:patientId - Exporta dados do paciente (FHIR)
 * - POST /api/cleanup - Limpa evidence antigos (retention policy)
 * - GET /health - Health check
 */

import { EvidenceOrchestrator } from './orchestrator/evidence-orchestrator';
import { EvidenceEvent, EvidenceConfig, ConsentStatus, AccessLog } from './types/evidence';

export interface Env {
  AI: Ai;
  EVIDENCE_KV: KVNamespace;
}

// Manchester Protocol Evidence Configuration
const MANCHESTER_EVIDENCE_CONFIG: EvidenceConfig = {
  patient_local: {
    enabled: true,
    encryption: 'aes-256-gcm',
    retention_days: 1825, // 5 years (LGPD Article 16)
    auto_anonymize_after_days: 365 // 1 year
  },
  system_aggregate: {
    enabled: true,
    anonymization_level: 'high',
    aggregation_window_hours: 24,
    send_to_rre: true
  },
  fhir_audit: {
    enabled: true,
    fhir_version: '4.0.1',
    include_provenance: true,
    audit_endpoint: undefined // Configure external FHIR server if needed
  },
  consent_tracking: {
    enabled: true,
    require_explicit_consent: true,
    consent_version: '1.0.0'
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const orchestrator = new EvidenceOrchestrator(env.AI, env.EVIDENCE_KV, MANCHESTER_EVIDENCE_CONFIG);

      // ========================================================================
      // POST /api/evidence/collect
      // ========================================================================
      if (path === '/api/evidence/collect' && request.method === 'POST') {
        const event = await request.json() as EvidenceEvent;
        const result = await orchestrator.collectEvidence(event);

        return new Response(JSON.stringify({
          success: true,
          result
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/evidence/batch
      // ========================================================================
      if (path === '/api/evidence/batch' && request.method === 'POST') {
        const body = await request.json() as { events: EvidenceEvent[] };
        const results = await orchestrator.collectBatch(body.events);

        return new Response(JSON.stringify({
          success: true,
          results,
          total: results.length
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/evidence/timeline/:patientId
      // ========================================================================
      if (path.startsWith('/api/evidence/timeline/') && request.method === 'GET') {
        const patientId = path.split('/').pop()!;

        // Check consent
        const consent = await orchestrator.checkConsent(patientId);
        if (!consent || consent.status !== 'granted') {
          return new Response(JSON.stringify({
            success: false,
            error: 'Patient consent required'
          }), {
            status: 403,
            headers: corsHeaders
          });
        }

        // Retrieve timeline
        const timelineKey = `timeline:${patientId}`;
        const timeline = await env.EVIDENCE_KV.get(timelineKey);

        if (!timeline) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Timeline not found'
          }), {
            status: 404,
            headers: corsHeaders
          });
        }

        // Log access
        await orchestrator.logAccess({
          access_id: `access:${Date.now()}`,
          timestamp: new Date().toISOString(),
          user_id: 'system',
          user_role: 'system',
          patient_id: patientId,
          action: 'read',
          resource_type: 'PatientTimeline',
          resource_id: timelineKey,
          authorized: true,
          authorization_method: 'consent_based'
        });

        return new Response(JSON.stringify({
          success: true,
          timeline: JSON.parse(timeline)
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/consent/grant
      // ========================================================================
      if (path === '/api/consent/grant' && request.method === 'POST') {
        const consent = await request.json() as ConsentStatus;
        await orchestrator.grantConsent(consent);

        return new Response(JSON.stringify({
          success: true,
          message: 'Consent granted successfully',
          consent_id: consent.consent_id
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/consent/revoke
      // ========================================================================
      if (path === '/api/consent/revoke' && request.method === 'POST') {
        const body = await request.json() as { patient_id: string; reason?: string };
        await orchestrator.revokeConsent(body.patient_id, body.reason);

        return new Response(JSON.stringify({
          success: true,
          message: 'Consent revoked successfully'
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/consent/:patientId
      // ========================================================================
      if (path.startsWith('/api/consent/') && request.method === 'GET' && !path.includes('/grant') && !path.includes('/revoke')) {
        const patientId = path.split('/').pop()!;
        const consent = await orchestrator.checkConsent(patientId);

        if (!consent) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No consent found for patient'
          }), {
            status: 404,
            headers: corsHeaders
          });
        }

        return new Response(JSON.stringify({
          success: true,
          consent
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/access/log
      // ========================================================================
      if (path === '/api/access/log' && request.method === 'POST') {
        const access = await request.json() as AccessLog;
        await orchestrator.logAccess(access);

        return new Response(JSON.stringify({
          success: true,
          message: 'Access logged successfully',
          access_id: access.access_id
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/rights/exercise
      // ========================================================================
      if (path === '/api/rights/exercise' && request.method === 'POST') {
        const body = await request.json() as {
          patient_id: string;
          right_type: 'access' | 'rectification' | 'deletion' | 'portability' | 'revocation';
        };

        await orchestrator.exerciseRight(body.patient_id, body.right_type);

        return new Response(JSON.stringify({
          success: true,
          message: `LGPD right "${body.right_type}" exercised successfully`
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/export/:patientId
      // ========================================================================
      if (path.startsWith('/api/export/') && request.method === 'GET') {
        const patientId = path.split('/').pop()!;

        try {
          const exportData = await orchestrator.exportPatientData(patientId);

          return new Response(JSON.stringify({
            success: true,
            export: exportData
          }), {
            headers: corsHeaders
          });

        } catch (error) {
          return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Export failed'
          }), {
            status: 403,
            headers: corsHeaders
          });
        }
      }

      // ========================================================================
      // POST /api/cleanup
      // ========================================================================
      if (path === '/api/cleanup' && request.method === 'POST') {
        const result = await orchestrator.cleanupOldEvidence();

        return new Response(JSON.stringify({
          success: true,
          cleanup_result: result
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /health
      // ========================================================================
      if (path === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'pir-evidence-executor',
          timestamp: new Date().toISOString(),
          config: {
            patient_local_enabled: MANCHESTER_EVIDENCE_CONFIG.patient_local.enabled,
            system_aggregate_enabled: MANCHESTER_EVIDENCE_CONFIG.system_aggregate.enabled,
            fhir_audit_enabled: MANCHESTER_EVIDENCE_CONFIG.fhir_audit.enabled,
            consent_tracking_enabled: MANCHESTER_EVIDENCE_CONFIG.consent_tracking.enabled
          }
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET / - Service Info
      // ========================================================================
      if (path === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          service: 'PIR Evidence Executor',
          version: '1.0.0',
          description: 'Cloudflare Worker para evidence/audit trail com FHIR R4 + LGPD compliance',
          features: {
            patient_timelines: {
              enabled: MANCHESTER_EVIDENCE_CONFIG.patient_local.enabled,
              encryption: MANCHESTER_EVIDENCE_CONFIG.patient_local.encryption,
              retention_days: MANCHESTER_EVIDENCE_CONFIG.patient_local.retention_days,
              auto_anonymize_after_days: MANCHESTER_EVIDENCE_CONFIG.patient_local.auto_anonymize_after_days
            },
            system_aggregates: {
              enabled: MANCHESTER_EVIDENCE_CONFIG.system_aggregate.enabled,
              anonymization_level: MANCHESTER_EVIDENCE_CONFIG.system_aggregate.anonymization_level,
              send_to_rre: MANCHESTER_EVIDENCE_CONFIG.system_aggregate.send_to_rre
            },
            fhir_audit: {
              enabled: MANCHESTER_EVIDENCE_CONFIG.fhir_audit.enabled,
              version: MANCHESTER_EVIDENCE_CONFIG.fhir_audit.fhir_version,
              compliant: true
            },
            lgpd_compliance: {
              consent_tracking: MANCHESTER_EVIDENCE_CONFIG.consent_tracking.enabled,
              rights_supported: ['access', 'rectification', 'deletion', 'portability', 'revocation'],
              encryption: 'AES-256-GCM',
              anonymization: 'AI-driven + rule-based'
            }
          },
          endpoints: [
            'POST /api/evidence/collect',
            'POST /api/evidence/batch',
            'GET /api/evidence/timeline/:patientId',
            'POST /api/consent/grant',
            'POST /api/consent/revoke',
            'GET /api/consent/:patientId',
            'POST /api/access/log',
            'POST /api/rights/exercise',
            'GET /api/export/:patientId',
            'POST /api/cleanup',
            'GET /health'
          ]
        }), {
          headers: corsHeaders
        });
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'Endpoint not found'
      }), {
        status: 404,
        headers: corsHeaders
      });

    } catch (error) {
      console.error('[PIR-Evidence] Error:', error);

      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
