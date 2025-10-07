/**
 * PIR Manchester SP - LLM-Based Guards
 *
 * Implements all 10 predictive guards using Cloudflare Workers AI.
 * All guards SUGGEST (not block) and provide transparent reasoning.
 *
 * Guards:
 * 1. sepsis_early_detection - Detect sepsis signs early (SUGGEST)
 * 2. stroke_time_window - Monitor stroke thrombolysis window
 * 3. cardiac_ischemia_alert - Detect cardiac ischemia patterns
 * 4. critical_hypoxemia - Monitor oxygen saturation critically
 * 5. hypovolemic_shock - Detect hypovolemic shock signs
 * 6. allergy_conflict_check - Check allergy conflicts
 * 7. medication_interaction - Check medication interactions
 * 8. pediatric_dose_safety - Pediatric dosage safety
 * 9. geriatric_fragility_alert - Geriatric fragility assessment
 * 10. pregnancy_contraindication - Pregnancy contraindication check
 */

import {
  GuardContext,
  GuardResult,
  GuardActionType,
  GuardPriority,
  GUARD_AI_MODELS
} from '../types/guards';
import { LLMReasoningGuard, ContinuousMonitoringGuard } from './base-guard';

// ============================================================================
// GUARD 1: Sepsis Early Detection
// ============================================================================

export class SepsisEarlyDetectionGuard extends ContinuousMonitoringGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    // Check every 5 minutes
    if (!this.shouldCheckNow(context, 5 * 60 * 1000)) {
      return this.createResult(context, {
        status: 'skipped',
        triggered: false,
        reason: 'Not enough time since last check'
      });
    }

    const stateChanges = this.getStateChanges(context);
    this.recordState(context.timestamp, context.slot_state);
    this.updateLastCheck(context.timestamp);

    const systemPrompt = `Você é um sistema de detecção precoce de SEPSE para triagem de emergência.

Analise os sinais vitais e apresentação clínica para identificar PRECOCEMENTE sinais de sepse (qSOFA, SIRS).

Critérios qSOFA (≥2 = alto risco):
- PAS < 100 mmHg
- FR ≥ 22 irpm
- Alteração do estado mental

Critérios SIRS (≥2 = sepse possível):
- Temperatura > 38°C ou < 36°C
- FC > 90 bpm
- FR > 20 irpm
- Leucócitos > 12.000 ou < 4.000

Você deve SUGERIR (não bloquear) investigação de sepse quando detectar padrões.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "qsofa_score": number,
  "sirs_score": number,
  "action": {
    "type": "suggest" | "alert",
    "message": "mensagem clara para equipe",
    "reasoning": "raciocínio clínico transparente",
    "priority": "critical" | "high" | "medium",
    "override_allowed": true
  }
}`;

    const userPrompt = `DADOS DO PACIENTE:

Sinais Vitais:
- PA: ${context.slot_state.systolic_bp}/${context.slot_state.diastolic_bp} mmHg
- FC: ${context.slot_state.heart_rate} bpm
- FR: ${context.slot_state.respiratory_rate} irpm
- Temp: ${context.slot_state.temperature}°C
- SpO2: ${context.slot_state.oxygen_saturation}%
- Consciência: ${context.slot_state.consciousness_level}

Queixa Principal: ${context.slot_state.chief_complaint || 'não informada'}
Dor: ${context.slot_state.pain_score || 'não avaliada'}/10

Histórico: ${JSON.stringify(context.slot_state.previous_medical_history || [])}

${stateChanges.changes.length > 0 ? `MUDANÇAS RECENTES: ${stateChanges.changes.join(', ')}` : ''}

Analise se há sinais precoces de sepse.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.2);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        qsofa_score: number;
        sirs_score: number;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 2: Stroke Time Window
// ============================================================================

export class StrokeTimeWindowGuard extends ContinuousMonitoringGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.DEEPSEEK);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    // Check every 2 minutes for stroke cases
    if (!this.shouldCheckNow(context, 2 * 60 * 1000)) {
      return this.createResult(context, {
        status: 'skipped',
        triggered: false,
        reason: 'Not enough time since last check'
      });
    }

    this.updateLastCheck(context.timestamp);

    const systemPrompt = `Você é um sistema de monitoramento de JANELA TERAPÊUTICA para AVC.

Janelas críticas:
- Trombólise (rtPA): até 4.5h do início dos sintomas
- Trombectomia mecânica: até 6h (até 24h em casos selecionados)

Você deve ALERTAR a equipe sobre o tempo restante e SUGERIR ações urgentes.

ESCALA FAST:
- Face: paralisia facial
- Arms: fraqueza em membros
- Speech: alteração da fala
- Time: tempo é crítico

Responda APENAS com JSON:
{
  "triggered": boolean,
  "time_since_symptom_onset_minutes": number,
  "thrombolysis_window_remaining_minutes": number,
  "action": {
    "type": "alert" | "suggest",
    "message": "mensagem urgente com tempo restante",
    "reasoning": "justificativa baseada em tempo",
    "priority": "critical" | "high",
    "override_allowed": false
  }
}`;

    const userPrompt = `CASO SUSPEITO DE AVC:

Queixa Principal: ${context.slot_state.chief_complaint}
Início dos Sintomas: ${context.slot_state.symptom_onset || 'não documentado'}
Hora Atual: ${context.timestamp}

Sinais Vitais:
- PA: ${context.slot_state.systolic_bp}/${context.slot_state.diastolic_bp} mmHg
- Consciência: ${context.slot_state.consciousness_level}

Sinais Neurológicos:
${JSON.stringify(context.slot_state)}

Calcule o tempo desde o início dos sintomas e monitore a janela terapêutica.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 3: Cardiac Ischemia Alert
// ============================================================================

export class CardiacIschemiaAlertGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de detecção de ISQUEMIA CARDÍACA para triagem de emergência.

Sinais de alerta (Síndrome Coronariana Aguda):
- Dor torácica típica: opressiva, retroesternal, irradiação para braço/mandíbula
- Dor atípica em diabéticos/idosos/mulheres
- Dispneia súbita sem causa aparente
- Náuseas/vômitos + dor epigástrica
- Sudorese fria + palidez

Fatores de risco:
- Idade > 45 anos (homens), > 55 anos (mulheres)
- HAS, DM, dislipidemia, tabagismo
- História familiar de DAC precoce
- IAM prévio

Você deve SUGERIR investigação de SCA quando detectar padrões de risco.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "risk_score": "baixo" | "intermediário" | "alto",
  "action": {
    "type": "suggest" | "alert",
    "message": "mensagem para equipe",
    "reasoning": "raciocínio baseado em padrões clínicos",
    "priority": "critical" | "high" | "medium",
    "override_allowed": true
  }
}`;

    const userPrompt = `PACIENTE COM DOR TORÁCICA:

Queixa: ${context.slot_state.chief_complaint}
Dor: ${context.slot_state.pain_score}/10
Localização: ${context.slot_state.pain_location || 'não especificada'}

Sinais Vitais:
- PA: ${context.slot_state.systolic_bp}/${context.slot_state.diastolic_bp} mmHg
- FC: ${context.slot_state.heart_rate} bpm
- SpO2: ${context.slot_state.oxygen_saturation}%

Idade: ${context.slot_state.age || 'não informada'}
Sexo: ${context.slot_state.gender || 'não informado'}

Histórico Médico: ${JSON.stringify(context.slot_state.previous_medical_history || [])}
Medicações: ${JSON.stringify(context.slot_state.medications_in_use || [])}

Analise o risco de isquemia cardíaca.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.2);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 4: Critical Hypoxemia
// ============================================================================

export class CriticalHypoxemiaGuard extends ContinuousMonitoringGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    // Check every minute for hypoxemia
    if (!this.shouldCheckNow(context, 60 * 1000)) {
      return this.createResult(context, {
        status: 'skipped',
        triggered: false,
        reason: 'Not enough time since last check'
      });
    }

    this.updateLastCheck(context.timestamp);

    const systemPrompt = `Você é um sistema de monitoramento de HIPOXEMIA CRÍTICA.

Classificação:
- SpO2 < 90%: Hipoxemia
- SpO2 < 85%: Hipoxemia grave
- SpO2 < 80%: Hipoxemia crítica (risco de morte)

Considere:
- Tendência: queda rápida é mais grave
- Contexto: DPOC compensado vs insuficiência respiratória aguda
- Resposta ao O2 suplementar

Você deve ALERTAR imediatamente para SpO2 < 85%.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "severity": "leve" | "moderada" | "grave" | "crítica",
  "trend": "estável" | "piorando" | "melhorando",
  "action": {
    "type": "alert" | "notify",
    "message": "mensagem urgente com SpO2 atual",
    "reasoning": "contexto clínico",
    "priority": "critical" | "high" | "medium",
    "override_allowed": false
  }
}`;

    const stateChanges = this.getStateChanges(context);
    this.recordState(context.timestamp, context.slot_state);

    const userPrompt = `MONITORAMENTO DE SpO2:

SpO2 Atual: ${context.slot_state.oxygen_saturation}%
FR: ${context.slot_state.respiratory_rate} irpm
FC: ${context.slot_state.heart_rate} bpm
Consciência: ${context.slot_state.consciousness_level}

${stateChanges.previous ? `SpO2 Anterior: ${stateChanges.previous.oxygen_saturation}%` : ''}
${stateChanges.changes.includes('oxygen_saturation') ? 'ATENÇÃO: SpO2 mudou recentemente' : ''}

Queixa: ${context.slot_state.chief_complaint}
Histórico Respiratório: ${JSON.stringify(context.slot_state.previous_medical_history || [])}

Analise a gravidade e tendência da hipoxemia.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 5: Hypovolemic Shock
// ============================================================================

export class HypovolemicShockGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.DEEPSEEK);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de detecção de CHOQUE HIPOVOLÊMICO.

Classificação do Choque Hemorrágico:
- Classe I: < 15% perda volêmica - compensado
- Classe II: 15-30% - FC > 100, PA normal
- Classe III: 30-40% - FC > 120, PAS < 90, oligúria
- Classe IV: > 40% - FC > 140, PAS < 70, confusão mental

Sinais:
- Taquicardia + hipotensão
- Extremidades frias, palidez, sudorese
- Alteração do nível de consciência
- Oligúria (< 0.5 mL/kg/h)

Causas: hemorragia (trauma, GI, ginecológica), desidratação grave, queimaduras extensas.

Você deve ALERTAR para sinais de choque Classe III ou IV.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "shock_class": "I" | "II" | "III" | "IV" | "nenhum",
  "action": {
    "type": "alert" | "suggest",
    "message": "mensagem urgente",
    "reasoning": "sinais detectados",
    "priority": "critical" | "high" | "medium",
    "override_allowed": false
  }
}`;

    const userPrompt = `AVALIAÇÃO DE CHOQUE:

Sinais Vitais:
- PA: ${context.slot_state.systolic_bp}/${context.slot_state.diastolic_bp} mmHg
- FC: ${context.slot_state.heart_rate} bpm
- FR: ${context.slot_state.respiratory_rate} irpm
- Temp: ${context.slot_state.temperature}°C
- Consciência: ${context.slot_state.consciousness_level}

Queixa: ${context.slot_state.chief_complaint}
Hemorragia Presente: ${context.slot_state.bleeding_present ? 'SIM' : 'NÃO'}
${context.slot_state.bleeding_severity ? `Gravidade: ${context.slot_state.bleeding_severity}` : ''}

Sinais de Hipoperfusão:
- Pele: ${context.slot_state.skin_condition || 'não avaliada'}
- Enchimento Capilar: ${context.slot_state.capillary_refill || 'não avaliado'}

Analise se há sinais de choque hipovolêmico.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 6: Allergy Conflict Check
// ============================================================================

export class AllergyConflictCheckGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de verificação de CONFLITOS ALÉRGICOS.

Verifique se há conflito entre:
- Alergias documentadas do paciente
- Medicações que o paciente já usa
- Medicações prescritas no atendimento atual

Tipos de reação alérgica:
- Leve: rash cutâneo, prurido
- Moderada: urticária, angioedema
- Grave: broncoespasmo, anafilaxia

Reações cruzadas comuns:
- Penicilinas ↔ Cefalosporinas (10% cross-reactivity)
- AINEs ↔ Aspirina
- Contraste iodado ↔ Frutos do mar (mito, não há relação)

Você deve BLOQUEAR prescrições com risco de anafilaxia e SUGERIR alternativas.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "conflicts": [
    {
      "allergen": "substância",
      "medication": "medicação conflitante",
      "severity": "leve" | "moderada" | "grave",
      "cross_reaction": boolean
    }
  ],
  "action": {
    "type": "alert" | "suggest",
    "message": "conflito detectado + alternativas",
    "reasoning": "explicação farmacológica",
    "priority": "critical" | "high" | "medium",
    "override_allowed": boolean
  }
}`;

    const userPrompt = `VERIFICAÇÃO DE ALERGIAS:

Alergias Documentadas:
${JSON.stringify(context.slot_state.allergy_history || [], null, 2)}

Medicações em Uso:
${JSON.stringify(context.slot_state.medications_in_use || [], null, 2)}

Medicações Prescritas (do contexto da tarefa):
${JSON.stringify(context.task_outputs?.prescribed_medications || [], null, 2)}

Verifique conflitos alérgicos e sugira alternativas seguras.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 7: Medication Interaction
// ============================================================================

export class MedicationInteractionGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.DEEPSEEK);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de verificação de INTERAÇÕES MEDICAMENTOSAS.

Classifique interações:
- Contraindicadas: nunca usar junto (ex: IMAO + ISRS)
- Graves: usar com extrema cautela (ex: Warfarina + AAS)
- Moderadas: monitorar efeitos (ex: Estatina + Fibratos)
- Leves: geralmente seguras

Mecanismos:
- Farmacocinéticos: CYP450, P-glicoproteína
- Farmacodinâmicos: sinergismo, antagonismo
- Efeitos aditivos: sedação, QT longo, sangramento

Você deve ALERTAR para interações contraindicadas/graves e SUGERIR alternativas ou ajustes de dose.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "interactions": [
    {
      "drug_a": "medicação 1",
      "drug_b": "medicação 2",
      "severity": "contraindicada" | "grave" | "moderada" | "leve",
      "mechanism": "mecanismo da interação",
      "clinical_effect": "efeito clínico esperado"
    }
  ],
  "action": {
    "type": "alert" | "suggest",
    "message": "interação detectada + recomendação",
    "reasoning": "explicação farmacológica",
    "priority": "critical" | "high" | "medium",
    "override_allowed": boolean
  }
}`;

    const userPrompt = `VERIFICAÇÃO DE INTERAÇÕES:

Medicações em Uso Atual:
${JSON.stringify(context.slot_state.medications_in_use || [], null, 2)}

Medicações Recém-Prescritas:
${JSON.stringify(context.task_outputs?.prescribed_medications || [], null, 2)}

Condições Clínicas:
${JSON.stringify(context.slot_state.previous_medical_history || [], null, 2)}

Verifique interações medicamentosas e sugira ajustes.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.2);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 8: Pediatric Dose Safety
// ============================================================================

export class PediatricDoseSafetyGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de verificação de SEGURANÇA DE DOSES PEDIÁTRICAS.

Princípios:
- Doses pediátricas são calculadas por PESO (mg/kg) ou SUPERFÍCIE CORPORAL (mg/m²)
- NUNCA use doses de adulto em crianças
- Verifique dose máxima diária
- Considere idade, peso, função renal/hepática

Faixas etárias:
- Neonato: 0-28 dias
- Lactente: 29 dias - 2 anos
- Pré-escolar: 2-6 anos
- Escolar: 6-12 anos
- Adolescente: 12-18 anos

Medicações de alta vigilância em pediatria:
- Opioides (risco de depressão respiratória)
- Sedativos (paradoxical agitation)
- Dipirona (agranulocitose)
- Aspirina < 12 anos (Síndrome de Reye)

Você deve BLOQUEAR doses acima do limite seguro e SUGERIR dose correta.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "dose_errors": [
    {
      "medication": "medicação",
      "prescribed_dose": "dose prescrita",
      "safe_dose_range": "faixa segura mg/kg",
      "max_daily_dose": "dose máxima diária",
      "error_type": "overdose" | "underdose" | "contraindicada"
    }
  ],
  "action": {
    "type": "alert" | "suggest",
    "message": "erro de dose + dose correta",
    "reasoning": "cálculo baseado em peso/idade",
    "priority": "critical" | "high",
    "override_allowed": boolean
  }
}`;

    const userPrompt = `VERIFICAÇÃO DE DOSE PEDIÁTRICA:

Paciente:
- Idade: ${context.slot_state.age} anos
- Peso: ${context.slot_state.weight || 'não informado'} kg
- Altura: ${context.slot_state.height || 'não informada'} cm

Medicações Prescritas:
${JSON.stringify(context.task_outputs?.prescribed_medications || [], null, 2)}

Função Renal/Hepática: ${context.slot_state.renal_function || 'não avaliada'}

Verifique se as doses estão seguras para esta criança.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 9: Geriatric Fragility Alert
// ============================================================================

export class GeriatricFragilityAlertGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.REASONING);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de avaliação de FRAGILIDADE GERIÁTRICA.

Critérios de Beers (medicações potencialmente inapropriadas em idosos):
- Benzodiazepínicos (quedas, confusão mental)
- Anticolinérgicos (delirium)
- AINEs (sangramento GI, lesão renal)
- Antipsicóticos (AVC, mortalidade)

Síndrome Geriátrica (5 Is):
- Imobilidade
- Instabilidade postural (quedas)
- Incontinência
- Iatrogenia (polifarmácia)
- Insuficiência cognitiva (demência)

Fragilidade (Fenótipo de Fried):
- Perda de peso não intencional
- Exaustão
- Fraqueza muscular
- Lentidão da marcha
- Baixa atividade física

Você deve SUGERIR cautela com medicações de risco e avaliar fragilidade.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "fragility_indicators": string[],
  "beers_medications": string[],
  "action": {
    "type": "suggest" | "alert",
    "message": "alerta de fragilidade + recomendações",
    "reasoning": "fatores de risco identificados",
    "priority": "high" | "medium",
    "override_allowed": true
  }
}`;

    const userPrompt = `AVALIAÇÃO GERIÁTRICA:

Paciente:
- Idade: ${context.slot_state.age} anos
- Peso: ${context.slot_state.weight || 'não informado'} kg
- Consciência: ${context.slot_state.consciousness_level}

Medicações em Uso:
${JSON.stringify(context.slot_state.medications_in_use || [], null, 2)}

Medicações Prescritas:
${JSON.stringify(context.task_outputs?.prescribed_medications || [], null, 2)}

Histórico Médico:
${JSON.stringify(context.slot_state.previous_medical_history || [], null, 2)}

Mobilidade/Quedas: ${context.slot_state.mobility_status || 'não avaliada'}

Avalie fragilidade e adequação das medicações para idoso.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.2);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}

// ============================================================================
// GUARD 10: Pregnancy Contraindication
// ============================================================================

export class PregnancyContraindicationGuard extends LLMReasoningGuard {
  constructor(ai: Ai, config: any) {
    super(ai, config, GUARD_AI_MODELS.DEEPSEEK);
  }

  protected async executeGuard(context: GuardContext): Promise<GuardResult> {
    const systemPrompt = `Você é um sistema de verificação de CONTRAINDICAÇÕES NA GESTAÇÃO.

Classificação FDA (uso na gravidez):
- Categoria X: Contraindicada (teratogênico comprovado)
- Categoria D: Evidência de risco (usar só se benefício > risco)
- Categoria C: Risco não pode ser descartado
- Categoria B: Sem evidência de risco em humanos
- Categoria A: Segura

Medicações CONTRAINDICADAS (Categoria X):
- IECA/BRA (malformações renais)
- Estatinas (malformações SNC)
- Isotretinoína (teratogenia múltipla)
- Misoprostol (abortivo)
- Varfarina (embriopatia)
- Metotrexato (abortivo)

Procedimentos de risco:
- Raio-X (especialmente 1º trimestre)
- TC com contraste
- RM com gadolínio

Você deve BLOQUEAR medicações Categoria X e ALERTAR para Categoria D.

Responda APENAS com JSON:
{
  "triggered": boolean,
  "pregnancy_status": "confirmada" | "possível" | "não se aplica",
  "contraindications": [
    {
      "item": "medicação ou procedimento",
      "category": "X" | "D" | "C",
      "risk": "descrição do risco fetal",
      "alternative": "alternativa segura"
    }
  ],
  "action": {
    "type": "alert" | "suggest",
    "message": "contraindicação + alternativa",
    "reasoning": "risco para o feto",
    "priority": "critical" | "high",
    "override_allowed": boolean
  }
}`;

    const userPrompt = `VERIFICAÇÃO DE GESTAÇÃO:

Paciente:
- Idade: ${context.slot_state.age} anos
- Sexo: ${context.slot_state.gender}
- Gestante: ${context.slot_state.is_pregnant ? 'SIM' : context.slot_state.pregnancy_possible ? 'POSSÍVEL' : 'NÃO'}
- Trimestre: ${context.slot_state.pregnancy_trimester || 'não aplicável'}

Medicações Prescritas:
${JSON.stringify(context.task_outputs?.prescribed_medications || [], null, 2)}

Procedimentos Solicitados:
${JSON.stringify(context.task_outputs?.requested_procedures || [], null, 2)}

Verifique contraindicações para gestação.`;

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, 0.1);
      const result = this.parseLLMResponse<{
        triggered: boolean;
        action?: any;
      }>(response);

      return this.createResult(context, {
        status: 'completed',
        triggered: result.triggered,
        action: result.action
      });

    } catch (error) {
      return this.createResult(context, {
        status: 'failed',
        triggered: false,
        error: error instanceof Error ? error.message : 'LLM call failed'
      });
    }
  }
}
