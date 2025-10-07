/**
 * PIR Tasks Executor - Cloudflare Worker Entry Point
 *
 * Worker que executa as 12 tasks do Protocolo Manchester usando Workers AI
 * Recebe slot_state do pir-slots e executa automação de processos
 */

import { TaskOrchestrator } from './orchestrator/task-orchestrator';

export interface Env {
  AI: any; // Cloudflare Workers AI binding
}

/**
 * Cloudflare Worker Handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const orchestrator = new TaskOrchestrator(env.AI);

      // ====================================================================
      // POST /api/tasks/execute - Executa todas as 12 tasks
      // ====================================================================
      if (url.pathname === '/api/tasks/execute' && request.method === 'POST') {
        const body = await request.json();

        // Valida payload
        if (!body.session_id || !body.slot_state) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Missing required fields: session_id, slot_state',
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        console.log(`[WORKER] Starting task execution for session ${body.session_id}`);

        // Inicia sessão
        const session = orchestrator.startSession(
          body.session_id,
          body.slot_state,
          body.patient_id,
          body.arrival_time,
          body.nurse_identifier
        );

        // Executa todas as tasks em paralelo rizomático
        const result = await orchestrator.executeTasks(body.session_id);

        return new Response(
          JSON.stringify({
            success: true,
            session: result,
            progress: orchestrator.getProgress(body.session_id),
            execution_summary: {
              total_tasks: result.task_results.length,
              completed: result.task_results.filter(r => r.status === 'completed').length,
              failed: result.task_results.filter(r => r.status === 'failed').length,
              skipped: result.task_results.filter(r => r.status === 'skipped').length,
              final_priority_color: result.task_outputs.final_priority_color,
              final_priority_time: result.task_outputs.final_priority_time,
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ====================================================================
      // GET /api/tasks/status/:sessionId - Obtém status de execução
      // ====================================================================
      if (url.pathname.startsWith('/api/tasks/status/') && request.method === 'GET') {
        const sessionId = url.pathname.split('/').pop();

        if (!sessionId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Session ID required' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const session = orchestrator.getSession(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ success: false, error: 'Session not found' }),
            {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            session,
            progress: orchestrator.getProgress(sessionId),
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ====================================================================
      // GET /api/tasks/results/:sessionId - Obtém resultados finais
      // ====================================================================
      if (url.pathname.startsWith('/api/tasks/results/') && request.method === 'GET') {
        const sessionId = url.pathname.split('/').pop();

        if (!sessionId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Session ID required' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const session = orchestrator.getSession(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ success: false, error: 'Session not found' }),
            {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Monta resposta com resultados consolidados
        const response = {
          success: true,
          session_id: session.session_id,
          patient_id: session.patient_id,
          status: session.status,
          started_at: session.started_at,

          // Classificação final
          classification: {
            priority_color: session.task_outputs.final_priority_color,
            priority_time: session.task_outputs.final_priority_time,
            manchester_code: session.task_outputs.manchester_code,
            reasoning: session.task_outputs.classification_reasoning,
            flowchart: session.task_outputs.selected_flowchart,
          },

          // Discriminadores
          discriminators: {
            general: session.task_outputs.general_discriminator_score || [],
            specific: session.task_outputs.specific_discriminator_matches || [],
            highest_priority: session.task_outputs.highest_priority_discriminator,
          },

          // Protocolos ativados
          protocols_activated: {
            chest_pain: session.task_outputs.protocol_activated_chest_pain || false,
            stroke: session.task_outputs.stroke_protocol_activated || false,
            sepsis: session.task_outputs.sepsis_protocol_activated || false,
            trauma: session.task_outputs.trauma_protocol_activated || false,
          },

          // Fila
          queue: {
            position: session.task_outputs.queue_position,
            estimated_wait_time: session.task_outputs.estimated_wait_time,
            physician_notified: session.task_outputs.physician_notified,
          },

          // Pulseira
          wristband: {
            color: session.task_outputs.final_priority_color,
            instruction: session.task_outputs.wristband_instruction,
            applied: session.task_outputs.wristband_applied,
          },

          // Registro
          record: {
            record_id: session.task_outputs.record_id,
            confirmation: session.task_outputs.confirmation,
          },

          // Detalhes de execução
          execution_details: {
            task_results: session.task_results,
            total_execution_time_ms: session.task_results.reduce(
              (sum, r) => sum + r.execution_time_ms,
              0
            ),
          },
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ====================================================================
      // GET /health - Health check
      // ====================================================================
      if (url.pathname === '/health' && request.method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            service: 'pir-tasks-executor',
            version: '1.0.0',
            workers_ai: 'enabled',
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ====================================================================
      // GET / - API documentation
      // ====================================================================
      if (url.pathname === '/' && request.method === 'GET') {
        const docs = {
          service: 'PIR Tasks Executor - Manchester SP',
          description:
            'Executa 12 tasks automatizadas do Protocolo Manchester usando Cloudflare Workers AI',
          version: '1.0.0',
          endpoints: {
            'POST /api/tasks/execute': {
              description: 'Executa todas as 12 tasks em paralelo rizomático',
              body: {
                session_id: 'string (required)',
                slot_state: 'object (required) - 19 slots do pir-slots',
                patient_id: 'string (optional)',
                arrival_time: 'ISO 8601 timestamp (optional)',
                nurse_identifier: 'string (optional)',
              },
              response: {
                success: true,
                session: '...',
                progress: '...',
                execution_summary: '...',
              },
            },
            'GET /api/tasks/status/:sessionId': {
              description: 'Obtém status de execução em tempo real',
              response: {
                success: true,
                session: '...',
                progress: '...',
              },
            },
            'GET /api/tasks/results/:sessionId': {
              description: 'Obtém resultados finais consolidados',
              response: {
                classification: '...',
                discriminators: '...',
                protocols_activated: '...',
                queue: '...',
                wristband: '...',
                record: '...',
              },
            },
            'GET /health': {
              description: 'Health check do worker',
            },
          },
          architecture: {
            workers_ai_models: [
              '@cf/qwen/qwq-32b-preview (reasoning)',
              '@cf/deepseek/deepseek-r1-distill-qwen-32b (reasoning)',
            ],
            execution: 'Paralelo rizomático (não-hierárquico)',
            tasks: 12,
          },
        };

        return new Response(JSON.stringify(docs, null, 2), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ====================================================================
      // 404 Not Found
      // ====================================================================
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Endpoint not found',
          available_endpoints: [
            'POST /api/tasks/execute',
            'GET /api/tasks/status/:sessionId',
            'GET /api/tasks/results/:sessionId',
            'GET /health',
            'GET /',
          ],
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('[WORKER] Fatal error:', error);

      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
