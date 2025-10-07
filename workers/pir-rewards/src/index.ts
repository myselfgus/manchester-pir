/**
 * PIR Manchester SP - Rewards Executor Worker
 *
 * Cloudflare Worker que calcula rewards para sessões de triagem usando Workers AI.
 * Rewards alimentam o RRE (Rhizomatic Reasoning Engine) para aprendizado contínuo.
 *
 * Endpoints:
 * - POST /api/rewards/calculate - Calcula rewards para uma sessão
 * - GET /api/rewards/result/:sessionId - Obtém resultado de reward
 * - POST /api/rewards/metrics - Calcula métricas agregadas
 * - GET /health - Health check
 */

import { RewardOrchestrator } from './orchestrator/reward-orchestrator';
import { RewardComponent, RewardContext } from './types/rewards';

export interface Env {
  AI: Ai;
}

// Manchester Protocol Reward Components (from PIR JSON)
const MANCHESTER_REWARD_COMPONENTS: RewardComponent[] = [
  {
    category: 'classification_accuracy',
    weight: 0.35, // 35% - Most important for learning
    description: 'Acurácia da classificação de prioridade Manchester',
    metrics: {
      positive_indicators: [
        'Classificação correta confirmada por desfecho',
        'Cor Manchester apropriada para gravidade',
        'Fluxograma correto selecionado',
        'Reclassificação adequada quando necessária'
      ],
      negative_indicators: [
        'Subclassificação (classificou mais baixo que deveria)',
        'Sobreclassificação (classificou mais alto que necessário)',
        'Fluxograma incorreto',
        'Falha em reclassificar deterioração'
      ]
    }
  },
  {
    category: 'deadline_adherence',
    weight: 0.25, // 25% - Important for operational learning
    description: 'Aderência aos prazos de atendimento (cores Manchester + fluxos prioritários)',
    metrics: {
      positive_indicators: [
        'Todos deadlines cumpridos',
        'Deadlines críticos respeitados',
        'Tempo de triagem otimizado',
        'Fluxos prioritários dentro da janela terapêutica'
      ],
      negative_indicators: [
        'Deadlines críticos perdidos',
        'Atrasos em fluxos prioritários (dor torácica, AVC, sepse)',
        'Tempo de triagem excessivo',
        'Fila de espera prolongada'
      ]
    }
  },
  {
    category: 'patient_safety',
    weight: 0.30, // 30% - Critical for safety learning
    description: 'Segurança do paciente (eventos adversos, guards, near-misses)',
    metrics: {
      positive_indicators: [
        'Nenhum evento adverso',
        'Guards detectaram riscos precocemente',
        'Near-misses identificados e prevenidos',
        'Overrides de guards justificados e documentados',
        'Desfecho clínico positivo'
      ],
      negative_indicators: [
        'Eventos adversos ocorreram',
        'Guards não dispararam quando deveriam',
        'Overrides de guards inadequados',
        'Near-misses não detectados',
        'Deterioração clínica não identificada'
      ]
    }
  },
  {
    category: 'resource_efficiency',
    weight: 0.05, // 5% - Less critical for learning
    description: 'Eficiência no uso de recursos (exames, medicações, especialistas)',
    metrics: {
      positive_indicators: [
        'Exames solicitados apropriados',
        'Medicações prescritas adequadas',
        'Consultas a especialistas necessárias',
        'Sem desperdício de recursos',
        'Tempo de triagem otimizado'
      ],
      negative_indicators: [
        'Exames desnecessários solicitados',
        'Medicações inapropriadas',
        'Consultas desnecessárias',
        'Desperdício de recursos',
        'Tempo de triagem excessivo'
      ]
    }
  },
  {
    category: 'pattern_detection',
    weight: 0.05, // 5% - Pattern recognition bonus
    description: 'Detecção de padrões críticos (sepse, AVC, IAM, trauma)',
    metrics: {
      positive_indicators: [
        'Sepse detectada precocemente',
        'AVC identificado dentro da janela',
        'IAM reconhecido rapidamente',
        'Trauma grave identificado',
        'Fluxos prioritários ativados corretamente'
      ],
      negative_indicators: [
        'Sepse não detectada',
        'AVC perdido fora da janela terapêutica',
        'IAM não reconhecido',
        'Trauma grave subestimado',
        'Fluxos prioritários não ativados'
      ]
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
      const orchestrator = new RewardOrchestrator(env.AI, MANCHESTER_REWARD_COMPONENTS);

      // ========================================================================
      // POST /api/rewards/calculate
      // ========================================================================
      if (path === '/api/rewards/calculate' && request.method === 'POST') {
        const body = await request.json() as RewardContext;

        const result = await orchestrator.calculateRewards(body);

        return new Response(JSON.stringify({
          success: true,
          result
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET /api/rewards/result/:sessionId
      // ========================================================================
      if (path.startsWith('/api/rewards/result/') && request.method === 'GET') {
        const sessionId = path.split('/').pop()!;
        const result = orchestrator.getResult(sessionId);

        if (!result) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Result not found'
          }), {
            status: 404,
            headers: corsHeaders
          });
        }

        return new Response(JSON.stringify({
          success: true,
          result
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // POST /api/rewards/metrics
      // ========================================================================
      if (path === '/api/rewards/metrics' && request.method === 'POST') {
        const body = await request.json() as {
          session_ids: string[];
          time_period: { start: string; end: string };
        };

        const metrics = await orchestrator.calculatePerformanceMetrics(
          body.session_ids,
          body.time_period
        );

        return new Response(JSON.stringify({
          success: true,
          metrics
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
          service: 'pir-rewards-executor',
          timestamp: new Date().toISOString(),
          reward_components: MANCHESTER_REWARD_COMPONENTS.length
        }), {
          headers: corsHeaders
        });
      }

      // ========================================================================
      // GET / - Service Info
      // ========================================================================
      if (path === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          service: 'PIR Rewards Executor',
          version: '1.0.0',
          description: 'Cloudflare Worker para calcular rewards de sessões de triagem usando Workers AI',
          reward_components: MANCHESTER_REWARD_COMPONENTS.map(c => ({
            category: c.category,
            weight: c.weight,
            description: c.description
          })),
          endpoints: [
            'POST /api/rewards/calculate',
            'GET /api/rewards/result/:sessionId',
            'POST /api/rewards/metrics',
            'GET /health'
          ],
          learning: {
            description: 'Rewards são agregados para o RRE (Rhizomatic Reasoning Engine) para aprendizado contínuo',
            privacy: 'Features são anonimizadas (sem PHI) para compliance com LGPD',
            aggregation_criteria: [
              'Sessões com outcome positivo (aprender com sucesso)',
              'Sessões com outcome negativo (aprender com erros)',
              'Fluxos prioritários (sempre aprender de casos críticos)',
              'Sessões com guards disparados (padrões interessantes)'
            ]
          }
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
      console.error('[PIR-Rewards] Error:', error);

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
