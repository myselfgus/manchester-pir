/**
 * PIR Manchester SP - Deadlines Executor Worker
 *
 * Cloudflare Worker que monitora deadlines adaptativos usando Workers AI.
 * Deadlines relaxam sob alta carga e escalam quando perdidos.
 *
 * Endpoints:
 * - POST /api/deadlines/start - Inicia monitoramento de deadlines
 * - POST /api/deadlines/check - Verifica status de deadlines
 * - POST /api/deadlines/mark-met - Marca deadline como cumprido
 * - GET /api/deadlines/session/:sessionId - Obtém sessão de monitoramento
 * - GET /api/deadlines/summary/:sessionId - Resumo estatístico
 * - GET /health - Health check
 */

import { DeadlineOrchestrator } from './orchestrator/deadline-orchestrator';
import { Deadline, DeadlineContext, parseDuration } from './types/deadlines';

export interface Env {
  AI: Ai;
}

// Manchester Protocol Deadlines (from PIR JSON)
const MANCHESTER_DEADLINES: Deadline[] = [
  {
    id: 'initial_assessment_red',
    name: 'Avaliação Inicial - VERMELHO',
    description: 'Atendimento imediato para casos de emergência (vermelho)',
    target_time: 'PT0M', // Immediate
    priority: 'critical',
    adaptive: false, // Never relax red cases
    escalation: {
      enabled: true,
      notify: ['attending_physician', 'medical_director'],
      actions: ['alert_team', 'reallocate_resources']
    },
    applies_to: {
      classification: ['vermelho']
    }
  },
  {
    id: 'initial_assessment_orange',
    name: 'Avaliação Inicial - LARANJA',
    description: 'Atendimento muito urgente (laranja) em até 10 minutos',
    target_time: 'PT10M',
    priority: 'critical',
    adaptive: true,
    relaxes_to: 'PT15M',
    load_threshold: 15,
    escalation: {
      enabled: true,
      notify: ['charge_nurse', 'attending_physician'],
      actions: ['alert_team']
    },
    applies_to: {
      classification: ['laranja']
    }
  },
  {
    id: 'initial_assessment_yellow',
    name: 'Avaliação Inicial - AMARELO',
    description: 'Atendimento urgente (amarelo) em até 1 hora',
    target_time: 'PT1H',
    priority: 'high',
    adaptive: true,
    relaxes_to: 'PT90M',
    load_threshold: 20,
    escalation: {
      enabled: true,
      notify: ['charge_nurse'],
      actions: ['notify_supervisor']
    },
    applies_to: {
      classification: ['amarelo']
    }
  },
  {
    id: 'initial_assessment_green',
    name: 'Avaliação Inicial - VERDE',
    description: 'Atendimento pouco urgente (verde) em até 2 horas',
    target_time: 'PT2H',
    priority: 'medium',
    adaptive: true,
    relaxes_to: 'PT3H',
    load_threshold: 25,
    escalation: {
      enabled: true,
      notify: ['charge_nurse'],
      actions: ['notify_supervisor']
    },
    applies_to: {
      classification: ['verde']
    }
  },
  {
    id: 'initial_assessment_blue',
    name: 'Avaliação Inicial - AZUL',
    description: 'Atendimento não urgente (azul) em até 4 horas',
    target_time: 'PT4H',
    priority: 'low',
    adaptive: true,
    relaxes_to: 'PT6H',
    load_threshold: 30,
    escalation: {
      enabled: true,
      notify: ['charge_nurse'],
      actions: ['notify_supervisor']
    },
    applies_to: {
      classification: ['azul']
    }
  },
  {
    id: 'chest_pain_door_to_ecg',
    name: 'Dor Torácica - ECG',
    description: 'ECG em paciente com dor torácica (Door-to-ECG ≤10 min)',
    target_time: 'PT10M',
    priority: 'critical',
    adaptive: false, // Never relax
    escalation: {
      enabled: true,
      notify: ['cardiologist', 'medical_director'],
      actions: ['alert_team', 'escalate_priority']
    },
    applies_to: {
      priority_flow: ['chest_pain']
    }
  },
  {
    id: 'stroke_door_to_ct',
    name: 'AVC - Tomografia',
    description: 'TC de crânio em suspeita de AVC (Door-to-CT ≤25 min)',
    target_time: 'PT25M',
    priority: 'critical',
    adaptive: false,
    escalation: {
      enabled: true,
      notify: ['neurologist', 'medical_director'],
      actions: ['alert_team', 'escalate_priority']
    },
    applies_to: {
      priority_flow: ['stroke']
    }
  },
  {
    id: 'stroke_door_to_needle',
    name: 'AVC - Trombólise',
    description: 'Início de trombólise em AVC (Door-to-needle ≤60 min)',
    target_time: 'PT1H',
    priority: 'critical',
    adaptive: false,
    escalation: {
      enabled: true,
      notify: ['neurologist', 'medical_director'],
      actions: ['alert_team', 'reallocate_resources']
    },
    applies_to: {
      priority_flow: ['stroke']
    }
  },
  {
    id: 'sepsis_antibiotic_administration',
    name: 'Sepse - Antibiótico',
    description: 'Administração de antibiótico em sepse (bundle 1 hora)',
    target_time: 'PT1H',
    priority: 'critical',
    adaptive: false,
    escalation: {
      enabled: true,
      notify: ['intensivist', 'medical_director'],
      actions: ['alert_team', 'escalate_priority']
    },
    applies_to: {
      priority_flow: ['sepsis']
    }
  },
  {
    id: 'trauma_primary_survey',
    name: 'Trauma - Avaliação Primária',
    description: 'Avaliação primária ATLS em trauma (≤2 min)',
    target_time: 'PT2M',
    priority: 'critical',
    adaptive: false,
    escalation: {
      enabled: true,
      notify: ['trauma_surgeon', 'medical_director'],
      actions: ['alert_team', 'reallocate_resources']
    },
    applies_to: {
      priority_flow: ['trauma']
    }
  }
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const orchestrator = new DeadlineOrchestrator(env.AI, MANCHESTER_DEADLINES);

      // ========================================================================
      // POST /api/deadlines/start
      // ========================================================================
      if (path === '/api/deadlines/start' && request.method === 'POST') {
        const body = await request.json() as DeadlineContext;

        const session = await orchestrator.startMonitoring(body.session_id, body);

        return new Response(JSON.stringify({
          success: true,
          session
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/deadlines/check
      // ========================================================================
      if (path === '/api/deadlines/check' && request.method === 'POST') {
        const body = await request.json() as DeadlineContext;

        const results = await orchestrator.checkDeadlines(body.session_id, body);

        return new Response(JSON.stringify({
          success: true,
          results
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/deadlines/mark-met
      // ========================================================================
      if (path === '/api/deadlines/mark-met' && request.method === 'POST') {
        const body = await request.json() as {
          session_id: string;
          deadline_id: string;
          timestamp: string;
        };

        orchestrator.markDeadlineMet(body.session_id, body.deadline_id, body.timestamp);

        return new Response(JSON.stringify({
          success: true,
          message: `Deadline ${body.deadline_id} marked as met`
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/deadlines/session/:sessionId
      // ========================================================================
      if (path.startsWith('/api/deadlines/session/') && request.method === 'GET') {
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
      // GET /api/deadlines/summary/:sessionId
      // ========================================================================
      if (path.startsWith('/api/deadlines/summary/') && request.method === 'GET') {
        const sessionId = path.split('/').pop()!;
        const summary = orchestrator.getSummary(sessionId);

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
          service: 'pir-deadlines-executor',
          timestamp: new Date().toISOString(),
          deadlines_available: MANCHESTER_DEADLINES.length
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET / - Service Info
      // ========================================================================
      if (path === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          service: 'PIR Deadlines Executor',
          version: '1.0.0',
          description: 'Cloudflare Worker para monitorar deadlines adaptativos usando Workers AI',
          deadlines: MANCHESTER_DEADLINES.map(d => ({
            id: d.id,
            name: d.name,
            target_time: d.target_time,
            priority: d.priority,
            adaptive: d.adaptive
          })),
          endpoints: [
            'POST /api/deadlines/start',
            'POST /api/deadlines/check',
            'POST /api/deadlines/mark-met',
            'GET /api/deadlines/session/:sessionId',
            'GET /api/deadlines/summary/:sessionId',
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
      console.error('[PIR-Deadlines] Error:', error);

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
