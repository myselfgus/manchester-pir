/**
 * PIR Slot Extractor - Cloudflare Worker Entry Point
 *
 * AI-Native Healthcare Operating System
 * Sistema operacional de saúde baseado em LLMs
 *
 * Endpoints:
 * - POST /api/triage/start - Inicia sessão de triagem
 * - POST /api/triage/:sessionId/audio - Processa áudio conversacional
 * - POST /api/triage/:sessionId/text - Processa texto
 * - GET /api/triage/:sessionId/status - Status da extração
 * - GET /api/triage/:sessionId/next-question - Próxima pergunta
 * - POST /api/triage/:sessionId/complete - Finaliza triagem
 * - PUT /api/triage/:sessionId/slots/:slotId - Atualiza slot manual
 */

import { RhizomaticOrchestrator } from './orchestrator/rhizomatic-orchestrator';
import type { PatientContext } from './types/slots';

export interface Env {
  AI: any; // Cloudflare Workers AI binding
  SESSIONS_KV: KVNamespace; // KV para persistir sessões
  ANTHROPIC_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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
      // Initialize orchestrator
      const orchestrator = new RhizomaticOrchestrator(env.AI);

      // ========================================================================
      // POST /api/triage/start - Inicia nova sessão
      // ========================================================================
      if (path === '/api/triage/start' && request.method === 'POST') {
        const body = await request.json<{
          patient_id?: string;
          patient_context?: PatientContext;
        }>();

        const sessionId = crypto.randomUUID();
        const session = orchestrator.startSession(sessionId, body.patient_context);

        // Persiste em KV
        await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), {
          expirationTtl: 3600, // 1 hora
        });

        return new Response(
          JSON.stringify({
            success: true,
            session_id: sessionId,
            session,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // POST /api/triage/:sessionId/audio - Processa áudio STT + extração
      // ========================================================================
      const audioMatch = path.match(/^\/api\/triage\/([^/]+)\/audio$/);
      if (audioMatch && request.method === 'POST') {
        const sessionId = audioMatch[1];

        // Recebe áudio como ArrayBuffer
        const contentType = request.headers.get('Content-Type') || '';
        let audioBuffer: ArrayBuffer;

        if (contentType.includes('multipart/form-data')) {
          const formData = await request.formData();
          const audioFile = formData.get('audio') as File;
          if (!audioFile) {
            return new Response(
              JSON.stringify({ error: 'No audio file provided' }),
              { status: 400, headers: corsHeaders }
            );
          }
          audioBuffer = await audioFile.arrayBuffer();
        } else {
          audioBuffer = await request.arrayBuffer();
        }

        const speaker = url.searchParams.get('speaker') as 'nurse' | 'patient' || 'patient';

        // Processa áudio + extração rizomática paralela
        const result = await orchestrator.processAudioAndExtractSlots(sessionId, audioBuffer, speaker);

        // Atualiza KV
        await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(result.session_state));

        return new Response(
          JSON.stringify({
            success: true,
            transcription: result.transcription.text,
            extracted_slots: result.extraction_results,
            progress: result.progress,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // POST /api/triage/:sessionId/text - Processa texto + extração
      // ========================================================================
      const textMatch = path.match(/^\/api\/triage\/([^/]+)\/text$/);
      if (textMatch && request.method === 'POST') {
        const sessionId = textMatch[1];
        const body = await request.json<{
          text: string;
          speaker: 'nurse' | 'patient' | 'system';
        }>();

        const result = await orchestrator.processTextAndExtractSlots(sessionId, body.text, body.speaker);

        // Atualiza KV
        await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(result.session_state));

        return new Response(
          JSON.stringify({
            success: true,
            extracted_slots: result.extraction_results,
            progress: result.progress,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // GET /api/triage/:sessionId/status - Status da sessão
      // ========================================================================
      const statusMatch = path.match(/^\/api\/triage\/([^/]+)\/status$/);
      if (statusMatch && request.method === 'GET') {
        const sessionId = statusMatch[1];
        const session = orchestrator.getSession(sessionId);

        if (!session) {
          // Tenta recuperar do KV
          const stored = await env.SESSIONS_KV.get(`session:${sessionId}`);
          if (!stored) {
            return new Response(
              JSON.stringify({ error: 'Session not found' }),
              { status: 404, headers: corsHeaders }
            );
          }

          return new Response(stored, {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            session,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // GET /api/triage/:sessionId/next-question - Próxima pergunta inteligente
      // ========================================================================
      const nextQuestionMatch = path.match(/^\/api\/triage\/([^/]+)\/next-question$/);
      if (nextQuestionMatch && request.method === 'GET') {
        const sessionId = nextQuestionMatch[1];
        const nextQuestion = await orchestrator.generateNextQuestion(sessionId);

        return new Response(
          JSON.stringify({
            success: true,
            next_question: nextQuestion,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // POST /api/triage/:sessionId/complete - Finaliza triagem
      // ========================================================================
      const completeMatch = path.match(/^\/api\/triage\/([^/]+)\/complete$/);
      if (completeMatch && request.method === 'POST') {
        const sessionId = completeMatch[1];
        const result = orchestrator.completeSession(sessionId);

        // Exporta para formato PIR
        const pirData = orchestrator.exportToPIR(sessionId);

        return new Response(
          JSON.stringify({
            success: true,
            session: result.session,
            filled_slots: result.filled_slots,
            progress: result.progress,
            pir_export: pirData,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // PUT /api/triage/:sessionId/slots/:slotId - Atualiza slot manualmente
      // ========================================================================
      const updateSlotMatch = path.match(/^\/api\/triage\/([^/]+)\/slots\/([^/]+)$/);
      if (updateSlotMatch && request.method === 'PUT') {
        const sessionId = updateSlotMatch[1];
        const slotId = updateSlotMatch[2];
        const body = await request.json<{ value: any }>();

        orchestrator.updateSlotManually(sessionId, slotId as any, body.value);

        const session = orchestrator.getSession(sessionId);
        await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session));

        return new Response(
          JSON.stringify({
            success: true,
            message: `Slot ${slotId} updated`,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // POST /api/triage/:sessionId/slots/:slotId/extract - Força re-extração
      // ========================================================================
      const forceExtractMatch = path.match(/^\/api\/triage\/([^/]+)\/slots\/([^/]+)\/extract$/);
      if (forceExtractMatch && request.method === 'POST') {
        const sessionId = forceExtractMatch[1];
        const slotId = forceExtractMatch[2];

        const result = await orchestrator.forceExtractSlot(sessionId, slotId as any);

        return new Response(
          JSON.stringify({
            success: true,
            slot_id: slotId,
            extraction_result: result,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // ========================================================================
      // GET / - Health check
      // ========================================================================
      if (path === '/' && request.method === 'GET') {
        return new Response(
          JSON.stringify({
            service: 'PIR Slot Extractor',
            version: '1.0.0',
            status: 'operational',
            architecture: 'rhizomatic-parallel',
            extractors: 18,
            models: ['@cf/openai/whisper', '@cf/meta/llama-3.1-8b-instruct'],
            endpoints: [
              'POST /api/triage/start',
              'POST /api/triage/:sessionId/audio',
              'POST /api/triage/:sessionId/text',
              'GET /api/triage/:sessionId/status',
              'GET /api/triage/:sessionId/next-question',
              'POST /api/triage/:sessionId/complete',
              'PUT /api/triage/:sessionId/slots/:slotId',
              'POST /api/triage/:sessionId/slots/:slotId/extract',
            ],
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Not found
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error) {
      console.error('PIR Error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: corsHeaders,
        }
      );
    }
  },
};
