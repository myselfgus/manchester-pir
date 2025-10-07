/**
 * PIR Manchester SP - Guards Executor Worker
 *
 * Cloudflare Worker que executa guards preditivos usando Workers AI.
 * Guards SUGEREM (não bloqueiam) e fornecem raciocínio transparente.
 *
 * Endpoints:
 * - POST /api/guards/execute - Executa guards para uma sessão
 * - GET /api/guards/status/:sessionId - Status da execução
 * - GET /api/guards/alerts/:sessionId - Alertas disparados
 * - GET /health - Health check
 */

import { GuardOrchestrator } from './orchestrator/guard-orchestrator';
import { Guard, GuardContext } from './types/guards';

export interface Env {
  AI: Ai;
}

// Define all 10 guards from manchester-sp-protocol.pir.json
const MANCHESTER_GUARDS: Guard[] = [
  {
    id: 'sepsis_early_detection',
    name: 'Detecção Precoce de Sepse',
    description: 'Detecta sinais precoces de sepse (qSOFA, SIRS) e sugere investigação',
    type: 'continuous',
    priority: 'critical',
    conditions: [],
    inputs: [
      'systolic_bp',
      'respiratory_rate',
      'consciousness_level',
      'temperature',
      'heart_rate'
    ],
    action: {
      type: 'suggest',
      show_reasoning: true,
      override_allowed: true,
      log_override: true
    }
  },
  {
    id: 'stroke_time_window',
    name: 'Janela Terapêutica - AVC',
    description: 'Monitora janela para trombólise/trombectomia em casos de AVC',
    type: 'continuous',
    priority: 'critical',
    conditions: [
      { slot: 'chief_complaint', operator: 'in', value: ['stroke', 'neuro', 'weakness'] }
    ],
    inputs: ['symptom_onset', 'chief_complaint', 'consciousness_level'],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: false,
      log_override: true
    }
  },
  {
    id: 'cardiac_ischemia_alert',
    name: 'Alerta de Isquemia Cardíaca',
    description: 'Detecta padrões de síndrome coronariana aguda',
    type: 'predictive',
    priority: 'critical',
    conditions: [],
    inputs: [
      'chief_complaint',
      'pain_score',
      'systolic_bp',
      'heart_rate',
      'age',
      'previous_medical_history'
    ],
    action: {
      type: 'suggest',
      show_reasoning: true,
      override_allowed: true,
      log_override: true
    }
  },
  {
    id: 'critical_hypoxemia',
    name: 'Hipoxemia Crítica',
    description: 'Monitora SpO2 e alerta para hipoxemia grave',
    type: 'continuous',
    priority: 'critical',
    conditions: [
      { slot: 'oxygen_saturation', operator: 'lt', value: 90 }
    ],
    inputs: ['oxygen_saturation', 'respiratory_rate', 'consciousness_level'],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: false,
      log_override: true
    }
  },
  {
    id: 'hypovolemic_shock',
    name: 'Choque Hipovolêmico',
    description: 'Detecta sinais de choque hipovolêmico (Classes III-IV)',
    type: 'predictive',
    priority: 'critical',
    conditions: [],
    inputs: [
      'systolic_bp',
      'heart_rate',
      'consciousness_level',
      'bleeding_present',
      'bleeding_severity'
    ],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: false,
      log_override: true
    }
  },
  {
    id: 'allergy_conflict_check',
    name: 'Verificação de Conflito Alérgico',
    description: 'Verifica conflitos entre alergias e medicações prescritas',
    type: 'predictive',
    priority: 'high',
    conditions: [
      { slot: 'allergy_history', operator: 'exists', value: true }
    ],
    inputs: ['allergy_history', 'medications_in_use'],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: true,
      log_override: true
    }
  },
  {
    id: 'medication_interaction',
    name: 'Interação Medicamentosa',
    description: 'Verifica interações entre medicações em uso e prescritas',
    type: 'predictive',
    priority: 'high',
    conditions: [
      { slot: 'medications_in_use', operator: 'exists', value: true }
    ],
    inputs: ['medications_in_use', 'previous_medical_history'],
    action: {
      type: 'suggest',
      show_reasoning: true,
      override_allowed: true,
      log_override: true
    }
  },
  {
    id: 'pediatric_dose_safety',
    name: 'Segurança de Dose Pediátrica',
    description: 'Verifica segurança de doses em pacientes pediátricos',
    type: 'predictive',
    priority: 'critical',
    conditions: [
      { slot: 'age', operator: 'lt', value: 18 }
    ],
    inputs: ['age', 'weight', 'height'],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: false,
      log_override: true
    }
  },
  {
    id: 'geriatric_fragility_alert',
    name: 'Alerta de Fragilidade Geriátrica',
    description: 'Avalia fragilidade e medicações inadequadas em idosos',
    type: 'predictive',
    priority: 'high',
    conditions: [
      { slot: 'age', operator: 'gte', value: 65 }
    ],
    inputs: ['age', 'medications_in_use', 'previous_medical_history'],
    action: {
      type: 'suggest',
      show_reasoning: true,
      override_allowed: true,
      log_override: true
    }
  },
  {
    id: 'pregnancy_contraindication',
    name: 'Contraindicação na Gestação',
    description: 'Verifica contraindicações de medicações/procedimentos em gestantes',
    type: 'predictive',
    priority: 'critical',
    conditions: [
      { slot: 'gender', operator: 'eq', value: 'female' },
      { slot: 'age', operator: 'gte', value: 12 },
      { slot: 'age', operator: 'lte', value: 55 }
    ],
    inputs: ['is_pregnant', 'pregnancy_trimester', 'age', 'gender'],
    action: {
      type: 'alert',
      show_reasoning: true,
      override_allowed: false,
      log_override: true
    }
  }
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Initialize orchestrator
      const orchestrator = new GuardOrchestrator(env.AI, MANCHESTER_GUARDS);

      // ========================================================================
      // POST /api/guards/execute
      // ========================================================================
      if (path === '/api/guards/execute' && request.method === 'POST') {
        const body = await request.json() as {
          session_id: string;
          patient_id?: string;
          slot_state: Record<string, any>;
          task_outputs?: Record<string, any>;
        };

        const context: Omit<GuardContext, 'guard_id'> = {
          session_id: body.session_id,
          patient_id: body.patient_id,
          slot_state: body.slot_state,
          task_outputs: body.task_outputs || {},
          timestamp: new Date().toISOString()
        };

        const session = await orchestrator.executeGuards(body.session_id, context);

        return new Response(JSON.stringify({
          success: true,
          session
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/guards/status/:sessionId
      // ========================================================================
      if (path.startsWith('/api/guards/status/') && request.method === 'GET') {
        const sessionId = path.split('/').pop()!;
        const session = orchestrator.getSession(sessionId);

        if (!session) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Session not found'
          }), {
            status: 404,
            headers: corsHeaders
          });
        }

        return new Response(JSON.stringify({
          success: true,
          session
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/guards/alerts/:sessionId
      // ========================================================================
      if (path.startsWith('/api/guards/alerts/') && request.method === 'GET') {
        const sessionId = path.split('/').pop()!;
        const summary = orchestrator.getAlertSummary(sessionId);

        return new Response(JSON.stringify({
          success: true,
          summary
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
          service: 'pir-guards-executor',
          timestamp: new Date().toISOString(),
          guards_available: MANCHESTER_GUARDS.length
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET / - Service Info
      // ========================================================================
      if (path === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          service: 'PIR Guards Executor',
          version: '1.0.0',
          description: 'Cloudflare Worker para executar guards preditivos usando Workers AI',
          guards: MANCHESTER_GUARDS.map(g => ({
            id: g.id,
            name: g.name,
            type: g.type,
            priority: g.priority
          })),
          endpoints: [
            'POST /api/guards/execute',
            'GET /api/guards/status/:sessionId',
            'GET /api/guards/alerts/:sessionId',
            'GET /health'
          ]
        }), {
          headers: corsHeaders
        });
      }

      // 404 - Not Found
      return new Response(JSON.stringify({
        success: false,
        error: 'Endpoint not found'
      }), {
        status: 404,
        headers: corsHeaders
      });

    } catch (error) {
      console.error('[PIR-Guards] Error:', error);

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
