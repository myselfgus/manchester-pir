/**
 * PIR Manchester SP - Reward Calculators
 *
 * Implements 5 reward calculators for different performance aspects.
 */

import { AIRewardCalculator } from './base-calculator';
import { RewardContext, CategoryScore } from '../types/rewards';

// ============================================================================
// CALCULATOR 1: Classification Accuracy
// ============================================================================

export class ClassificationAccuracyCalculator extends AIRewardCalculator {
  protected getSystemPrompt(): string {
    return `Você é um sistema de AVALIAÇÃO DE ACURÁCIA DE TRIAGEM Manchester.

Avalie se a classificação de prioridade foi CORRETA baseado no desfecho clínico.

Score:
+1.0: Classificação perfeita, diagnóstico confirmou prioridade
+0.5: Classificação apropriada, pequenas divergências aceitáveis
0.0: Classificação neutra, sem desfecho claro
-0.5: Classificação subótima, poderia ser mais precisa
-1.0: Classificação incorreta, risco à segurança do paciente

Responda APENAS com JSON:
{
  "raw_score": number,
  "reasoning": "justificativa detalhada",
  "positive_factors": ["fator1", "fator2"],
  "negative_factors": ["fator1"]
}`;
  }

  protected getUserPrompt(context: RewardContext): string {
    return `AVALIAÇÃO DE TRIAGEM:

Classificação Inicial: ${context.initial_classification || 'não definida'}
Classificação Final: ${context.final_classification || 'não definida'}
Diagnóstico Real: ${context.actual_diagnosis || 'não disponível'}
Acurácia Clínica: ${context.clinical_accuracy ? 'CORRETA' : 'INCORRETA'}
Desfecho: ${context.treatment_outcome || 'desconhecido'}

Fluxograma: ${context.initial_flowchart || 'não definido'}
Fluxo Prioritário: ${context.priority_flow_activated || 'nenhum'}

Guards Disparados: ${context.guards_triggered.join(', ') || 'nenhum'}

Avalie a acurácia da classificação de triagem.`;
  }

  protected calculateRuleBased(context: RewardContext): CategoryScore {
    let rawScore = 0;
    const positiveFactors: string[] = [];
    const negativeFactors: string[] = [];

    if (context.clinical_accuracy) {
      rawScore += 1.0;
      positiveFactors.push('Classificação clinicamente correta');
    } else {
      rawScore -= 1.0;
      negativeFactors.push('Classificação clinicamente incorreta');
    }

    return {
      category: 'classification_accuracy',
      weight: this.component.weight,
      raw_score: rawScore,
      weighted_score: rawScore * this.component.weight,
      reasoning: 'Cálculo baseado em regras (AI não disponível)',
      positive_factors: positiveFactors,
      negative_factors: negativeFactors
    };
  }
}

// ============================================================================
// CALCULATOR 2: Deadline Adherence
// ============================================================================

export class DeadlineAdherenceCalculator extends AIRewardCalculator {
  protected getSystemPrompt(): string {
    return `Você é um sistema de AVALIAÇÃO DE ADERÊNCIA A DEADLINES.

Avalie o cumprimento de prazos de atendimento (Manchester + fluxos prioritários).

Score:
+1.0: Todos deadlines cumpridos
+0.5: Maioria cumprida, atrasos justificados por alta carga
0.0: Metade cumprida
-0.5: Maioria perdida, mas sem risco ao paciente
-1.0: Deadlines críticos perdidos, risco à segurança

Responda APENAS com JSON:
{
  "raw_score": number,
  "reasoning": "justificativa",
  "positive_factors": ["fator1"],
  "negative_factors": ["fator1"]
}`;
  }

  protected getUserPrompt(context: RewardContext): string {
    return `ADERÊNCIA A DEADLINES:

Deadlines Cumpridos: ${context.deadlines_met.length}
${context.deadlines_met.join(', ') || 'nenhum'}

Deadlines Perdidos: ${context.deadlines_missed.length}
${context.deadlines_missed.join(', ') || 'nenhum'}

Classificação: ${context.initial_classification}
Fluxo Prioritário: ${context.priority_flow_activated || 'nenhum'}

Tempo Total de Triagem: ${context.total_triage_time_ms}ms
Tempo até Médico: ${context.time_to_physician_ms || 'não medido'}ms

Avalie a aderência aos deadlines.`;
  }

  protected calculateRuleBased(context: RewardContext): CategoryScore {
    const totalDeadlines = context.deadlines_met.length + context.deadlines_missed.length;
    const rawScore = totalDeadlines > 0
      ? (context.deadlines_met.length / totalDeadlines) * 2 - 1
      : 0;

    return {
      category: 'deadline_adherence',
      weight: this.component.weight,
      raw_score: rawScore,
      weighted_score: rawScore * this.component.weight,
      reasoning: `${context.deadlines_met.length}/${totalDeadlines} deadlines cumpridos`,
      positive_factors: context.deadlines_met,
      negative_factors: context.deadlines_missed
    };
  }
}

// ============================================================================
// CALCULATOR 3: Patient Safety
// ============================================================================

export class PatientSafetyCalculator extends AIRewardCalculator {
  protected getSystemPrompt(): string {
    return `Você é um sistema de AVALIAÇÃO DE SEGURANÇA DO PACIENTE.

Avalie a segurança do atendimento baseado em eventos adversos, near-misses e guards.

Score:
+1.0: Nenhum evento adverso, guards funcionaram perfeitamente
+0.5: Sem eventos, alguns near-misses detectados e prevenidos
0.0: Near-misses sem consequências
-0.5: Eventos adversos leves, guards overrides questionáveis
-1.0: Eventos adversos graves, falhas de segurança

Responda APENAS com JSON:
{
  "raw_score": number,
  "reasoning": "justificativa",
  "positive_factors": ["fator1"],
  "negative_factors": ["fator1"]
}`;
  }

  protected getUserPrompt(context: RewardContext): string {
    return `SEGURANÇA DO PACIENTE:

Eventos Adversos: ${context.adverse_events?.length || 0}
${context.adverse_events?.join(', ') || 'nenhum'}

Near-Misses: ${context.near_misses?.length || 0}
${context.near_misses?.join(', ') || 'nenhum'}

Guards Disparados: ${context.guards_triggered.length}
${context.guards_triggered.join(', ') || 'nenhum'}

Guard Overrides: ${context.guard_overrides?.length || 0}
${context.guard_overrides?.map(o => `${o.guard_id}: ${o.outcome}`).join(', ') || 'nenhum'}

Desfecho: ${context.treatment_outcome}

Avalie a segurança do atendimento.`;
  }

  protected calculateRuleBased(context: RewardContext): CategoryScore {
    let rawScore = 1.0;

    if (context.adverse_events && context.adverse_events.length > 0) {
      rawScore -= 0.5 * context.adverse_events.length;
    }

    if (context.guard_overrides) {
      const errors = context.guard_overrides.filter(o => o.outcome === 'error').length;
      rawScore -= 0.3 * errors;
    }

    return {
      category: 'patient_safety',
      weight: this.component.weight,
      raw_score: Math.max(-1, rawScore),
      weighted_score: Math.max(-1, rawScore) * this.component.weight,
      reasoning: 'Cálculo baseado em eventos adversos e overrides',
      positive_factors: context.guards_triggered,
      negative_factors: context.adverse_events || []
    };
  }
}

// ============================================================================
// CALCULATOR 4: Resource Efficiency
// ============================================================================

export class ResourceEfficiencyCalculator extends AIRewardCalculator {
  protected getSystemPrompt(): string {
    return `Você é um sistema de AVALIAÇÃO DE EFICIÊNCIA DE RECURSOS.

Avalie o uso de recursos (exames, medicações, especialistas) vs necessidade clínica.

Score:
+1.0: Recursos usados de forma ótima, nada em excesso ou faltando
+0.5: Uso apropriado com pequenas ineficiências
0.0: Uso médio de recursos
-0.5: Uso excessivo de recursos sem justificativa clínica
-1.0: Desperdício grave ou falta crítica de recursos

Responda APENAS com JSON:
{
  "raw_score": number,
  "reasoning": "justificativa",
  "positive_factors": ["fator1"],
  "negative_factors": ["fator1"]
}`;
  }

  protected getUserPrompt(context: RewardContext): string {
    return `EFICIÊNCIA DE RECURSOS:

Exames Solicitados: ${context.resources_used?.exams_requested?.length || 0}
${context.resources_used?.exams_requested?.join(', ') || 'nenhum'}

Medicações Prescritas: ${context.resources_used?.medications_prescribed?.length || 0}
${context.resources_used?.medications_prescribed?.join(', ') || 'nenhuma'}

Especialistas Consultados: ${context.resources_used?.specialists_consulted?.length || 0}
${context.resources_used?.specialists_consulted?.join(', ') || 'nenhum'}

Classificação: ${context.initial_classification}
Diagnóstico: ${context.actual_diagnosis}
Desfecho: ${context.treatment_outcome}

Avalie a eficiência do uso de recursos.`;
  }

  protected calculateRuleBased(context: RewardContext): CategoryScore {
    // Heurística simples: score neutro se não há dados
    return {
      category: 'resource_efficiency',
      weight: this.component.weight,
      raw_score: 0,
      weighted_score: 0,
      reasoning: 'Dados insuficientes para avaliação (requer AI)',
      positive_factors: [],
      negative_factors: []
    };
  }
}

// ============================================================================
// CALCULATOR 5: Pattern Detection
// ============================================================================

export class PatternDetectionCalculator extends AIRewardCalculator {
  protected getSystemPrompt(): string {
    return `Você é um sistema de AVALIAÇÃO DE DETECÇÃO DE PADRÕES.

Avalie se padrões críticos foram detectados corretamente (sepse, AVC, IAM, trauma).

Score:
+1.0: Todos padrões críticos detectados precocemente
+0.5: Maioria detectada, pequenos atrasos aceitáveis
0.0: Nenhum padrão crítico no caso
-0.5: Padrões detectados tardiamente
-1.0: Padrões críticos perdidos, risco ao paciente

Responda APENAS com JSON:
{
  "raw_score": number,
  "reasoning": "justificativa",
  "positive_factors": ["padrão detectado"],
  "negative_factors": ["padrão perdido"]
}`;
  }

  protected getUserPrompt(context: RewardContext): string {
    return `DETECÇÃO DE PADRÕES:

Guards Disparados: ${context.guards_triggered.length}
${context.guards_triggered.join(', ') || 'nenhum'}

Fluxo Prioritário Ativado: ${context.priority_flow_activated || 'nenhum'}

Diagnóstico Final: ${context.actual_diagnosis}
Desfecho: ${context.treatment_outcome}

Tasks Executadas: ${context.tasks_executed.join(', ')}

Avalie a qualidade da detecção de padrões clínicos críticos.`;
  }

  protected calculateRuleBased(context: RewardContext): CategoryScore {
    const criticalPatterns = ['sepsis', 'stroke', 'chest_pain', 'trauma'];
    const detectedPatterns = context.guards_triggered.filter(g =>
      criticalPatterns.some(p => g.includes(p))
    );

    const rawScore = detectedPatterns.length > 0 ? 0.8 : 0;

    return {
      category: 'pattern_detection',
      weight: this.component.weight,
      raw_score: rawScore,
      weighted_score: rawScore * this.component.weight,
      reasoning: `${detectedPatterns.length} padrões críticos detectados`,
      positive_factors: detectedPatterns,
      negative_factors: []
    };
  }
}
