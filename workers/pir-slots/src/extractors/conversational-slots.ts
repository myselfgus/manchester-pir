/**
 * PIR Conversational Slot Extractors - Manchester SP
 *
 * LLMs especializados para extração conversacional de dados clínicos
 * Cada extractor é um agente autônomo com prompt engineering específico
 * Arquitetura AI-native: LLM como sistema operacional de extração de slots
 */

import { ConversationalExtractor, DeviceExtractor, ComputedExtractor } from './base-extractor';
import type { PatientContext, SlotFillRequest, ConversationTurn, ConsciousnessLevel, BleedingSeverity, TraumaMechanism } from '../types/slots';

// ============================================================================
// SLOT 1: Chief Complaint (Queixa Principal)
// ============================================================================

export class ChiefComplaintExtractor extends ConversationalExtractor<string> {
  constructor(aiBinding: any) {
    super(aiBinding, 'chief_complaint', 'Queixa Principal');
  }

  protected buildExtractionPrompt(conversationText: string, patientContext?: PatientContext): string {
    return `Analise a conversa abaixo e extraia a QUEIXA PRINCIPAL do paciente - o motivo pelo qual ele veio ao serviço de emergência.

CONVERSA:
${conversationText}

INSTRUÇÕES:
- Extraia a queixa principal em 1-2 frases curtas
- Foque no sintoma/problema ATUAL, não histórico
- Use linguagem médica apropriada mas clara
- Se o paciente mencionar múltiplos problemas, identifique o PRINCIPAL

Retorne JSON no formato:
{
  "chief_complaint": "descrição da queixa",
  "keywords": ["palavra1", "palavra2"],
  "suspected_flowchart": "dor_toracica|dispneia|trauma|cefaleia|etc"
}`;
  }

  protected parseResponse(llmResponse: string): string | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed || typeof parsed.chief_complaint !== 'string') {
      // Fallback: usa o texto todo se não for JSON
      return llmResponse.trim().substring(0, 500);
    }
    return parsed.chief_complaint;
  }

  validate(value: string | null): boolean {
    return value !== null && value.length >= 3 && value.length <= 500;
  }

  generateFallbackQuestion(context: ConversationTurn[]): string {
    return 'Qual é o motivo principal da sua vinda ao serviço de emergência hoje?';
  }
}

// ============================================================================
// SLOT 2: Pain Score (Escala de Dor)
// ============================================================================

export class PainScoreExtractor extends ConversationalExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'pain_score', 'Escala de Dor');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Analise a conversa e extraia a INTENSIDADE DA DOR do paciente numa escala de 0 a 10.

CONVERSA:
${conversationText}

ESCALA DE DOR:
0 = Sem dor
1-3 = Dor leve
4-6 = Dor moderada
7-9 = Dor intensa
10 = Pior dor imaginável

INSTRUÇÕES:
- Se o paciente mencionou um número, use-o
- Se usou termos descritivos (leve/moderada/forte/insuportável), converta para número
- Se não mencionou dor, retorne null

Retorne JSON:
{
  "pain_score": <número 0-10 ou null>,
  "descriptive_terms": ["termo1", "termo2"],
  "body_location": "local da dor"
}`;
  }

  protected parseResponse(llmResponse: string): number | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    const score = parsed.pain_score;
    if (typeof score === 'number' && score >= 0 && score <= 10) {
      return Math.round(score);
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 0 && value <= 10);
  }

  generateFallbackQuestion(): string {
    return 'Numa escala de 0 a 10, sendo 0 sem dor e 10 a pior dor imaginável, qual o nível da sua dor agora?';
  }
}

// ============================================================================
// SLOT 7: Consciousness Level (Nível de Consciência)
// ============================================================================

export class ConsciousnessLevelExtractor extends ConversationalExtractor<ConsciousnessLevel> {
  constructor(aiBinding: any) {
    super(aiBinding, 'consciousness_level', 'Nível de Consciência');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Avalie o NÍVEL DE CONSCIÊNCIA do paciente baseado na conversa e observação do enfermeiro.

CONVERSA:
${conversationText}

NÍVEIS POSSÍVEIS (escala AVPU):
- alert: Alerta, orientado, conversando normalmente
- confused: Confuso, desorientado, mas responsivo
- responds_voice: Responde apenas a estímulos verbais
- responds_pain: Responde apenas a estímulos dolorosos
- unresponsive: Irresponsivo, inconsciente

INSTRUÇÕES:
- Se o paciente está conversando coerentemente = alert
- Se está conversando mas confuso/desorientado = confused
- Se enfermeiro relata não resposta = avaliar tipo de estímulo

Retorne JSON:
{
  "consciousness_level": "alert|confused|responds_voice|responds_pain|unresponsive",
  "avpu": "A|V|P|U",
  "reasoning": "justificativa"
}`;
  }

  protected parseResponse(llmResponse: string): ConsciousnessLevel | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    const level = parsed.consciousness_level;
    const validLevels: ConsciousnessLevel[] = ['alert', 'confused', 'responds_voice', 'responds_pain', 'unresponsive'];

    if (typeof level === 'string' && validLevels.includes(level as ConsciousnessLevel)) {
      return level as ConsciousnessLevel;
    }

    return null;
  }

  validate(value: ConsciousnessLevel | null): boolean {
    const validLevels: ConsciousnessLevel[] = ['alert', 'confused', 'responds_voice', 'responds_pain', 'unresponsive'];
    return value === null || validLevels.includes(value);
  }

  generateFallbackQuestion(): string {
    return 'O paciente está alerta e orientado? Como está respondendo?';
  }
}

// ============================================================================
// SLOT 8: Bleeding Present (Presença de Hemorragia)
// ============================================================================

export class BleedingPresentExtractor extends ConversationalExtractor<boolean> {
  constructor(aiBinding: any) {
    super(aiBinding, 'bleeding_present', 'Presença de Hemorragia');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Identifique se há SANGRAMENTO/HEMORRAGIA presente no paciente.

CONVERSA:
${conversationText}

INSTRUÇÕES:
- Procure menções de: sangramento, hemorragia, sangrando, sangue
- Observe inspeção visual mencionada pelo enfermeiro
- Se NÃO houver menção de sangramento: retorne false
- Se houver qualquer sangramento: retorne true

Retorne JSON:
{
  "bleeding_present": true|false,
  "location": "local do sangramento se mencionado ou null",
  "reasoning": "justificativa"
}`;
  }

  protected parseResponse(llmResponse: string): boolean | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;
    return parsed.bleeding_present === true;
  }

  validate(value: boolean | null): boolean {
    return typeof value === 'boolean';
  }

  generateFallbackQuestion(): string {
    return 'O paciente apresenta sangramento visível?';
  }
}

// ============================================================================
// SLOT 9: Bleeding Severity (Gravidade da Hemorragia)
// Condicional: só extrai se bleeding_present == true
// ============================================================================

export class BleedingSeverityExtractor extends ConversationalExtractor<BleedingSeverity> {
  constructor(aiBinding: any) {
    super(aiBinding, 'bleeding_severity', 'Gravidade da Hemorragia');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Determine a GRAVIDADE DA HEMORRAGIA do paciente.

CONVERSA:
${conversationText}

NÍVEIS DE GRAVIDADE (escolha exatamente 1):
- exsanguinating: Hemorragia exsanguinante (risco iminente de morte, perda massiva de sangue)
- uncontrollable_major: Sangramento incontrolável maior (artéria, órgão interno, grande volume)
- uncontrollable_minor: Sangramento incontrolável menor (venoso, epistaxe grave, moderado)
- controllable: Sangramento controlável (compressão resolve, pequeno volume)

INSTRUÇÕES:
- Considere: volume, localização, controle com compressão, sinais de choque
- Se não tiver informação suficiente: infira baseado no contexto
- IMPORTANTE: sempre retorne um dos 4 níveis (este slot só é chamado se bleeding_present == true)

Retorne JSON:
{
  "severity": "exsanguinating|uncontrollable_major|uncontrollable_minor|controllable",
  "reasoning": "justificativa da classificação"
}`;
  }

  protected parseResponse(llmResponse: string): BleedingSeverity | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed || !parsed.severity) return null;

    const validSeverities: BleedingSeverity[] = [
      'exsanguinating',
      'uncontrollable_major',
      'uncontrollable_minor',
      'controllable',
    ];

    if (validSeverities.includes(parsed.severity as BleedingSeverity)) {
      return parsed.severity as BleedingSeverity;
    }

    return null;
  }

  validate(value: BleedingSeverity | null): boolean {
    if (value === null) return false;
    const validSeverities: BleedingSeverity[] = [
      'exsanguinating',
      'uncontrollable_major',
      'uncontrollable_minor',
      'controllable',
    ];
    return validSeverities.includes(value);
  }

  generateFallbackQuestion(): string {
    return 'Qual a intensidade do sangramento? (Exsanguinante, Incontrolável maior, Incontrolável menor, Controlável)';
  }
}

// ============================================================================
// SLOT 10: Symptom Onset (Início dos Sintomas)
// ============================================================================

export class SymptomOnsetExtractor extends ConversationalExtractor<{ duration: number; unit: 'minutes' | 'hours' | 'days' }> {
  constructor(aiBinding: any) {
    super(aiBinding, 'symptom_onset', 'Início dos Sintomas');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Identifique HÁ QUANTO TEMPO começaram os sintomas.

CONVERSA:
${conversationText}

INSTRUÇÕES:
- Extraia a duração e unidade (minutos, horas ou dias)
- Se mencionar "há 2 horas" = {duration: 2, unit: "hours"}
- Se mencionar "desde ontem" = calcule horas aproximadas
- Se não especificado, retorne null

Retorne JSON:
{
  "duration": <número>,
  "unit": "minutes|hours|days",
  "sudden_onset": true|false,
  "exact_time_mentioned": "horário exato se mencionado"
}`;
  }

  protected parseResponse(llmResponse: string): { duration: number; unit: 'minutes' | 'hours' | 'days' } | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (typeof parsed.duration === 'number' && typeof parsed.unit === 'string') {
      const validUnits: Array<'minutes' | 'hours' | 'days'> = ['minutes', 'hours', 'days'];
      if (validUnits.includes(parsed.unit as 'minutes' | 'hours' | 'days')) {
        return {
          duration: parsed.duration,
          unit: parsed.unit as 'minutes' | 'hours' | 'days',
        };
      }
    }

    return null;
  }

  validate(value: { duration: number; unit: 'minutes' | 'hours' | 'days' } | null): boolean {
    if (value === null) return false;
    if (value.unit === 'days' && value.duration > 30) return false;
    if (value.unit === 'hours' && value.duration > 720) return false; // 30 days
    return value.duration > 0;
  }

  generateFallbackQuestion(): string {
    return 'Há quanto tempo começaram os sintomas? Quando exatamente iniciou?';
  }
}

// ============================================================================
// SLOT 15: Trauma Mechanism (Mecanismo do Trauma)
// ============================================================================

export class TraumaMechanismExtractor extends ConversationalExtractor<TraumaMechanism> {
  constructor(aiBinding: any) {
    super(aiBinding, 'trauma_mechanism', 'Mecanismo do Trauma');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Identifique o MECANISMO DO TRAUMA.

CONVERSA:
${conversationText}

MECANISMOS:
- high_energy_collision: Colisão alta energia (acidente de carro/moto alta velocidade)
- fall_from_height: Queda de altura (>1,5m)
- pedestrian_struck: Atropelamento
- penetrating_injury: Ferimento penetrante (facada, tiro)
- low_energy_mechanism: Baixa energia (queda da própria altura, etc)

Retorne JSON:
{
  "mechanism": "tipo_do_mecanismo",
  "details": {
    "speed": "velocidade estimada",
    "height": "altura da queda",
    "protective_equipment": "equipamento de proteção usado"
  }
}`;
  }

  protected parseResponse(llmResponse: string): TraumaMechanism | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    const validMechanisms: TraumaMechanism[] = [
      'high_energy_collision',
      'fall_from_height',
      'pedestrian_struck',
      'penetrating_injury',
      'low_energy_mechanism',
    ];

    if (typeof parsed.mechanism === 'string' && validMechanisms.includes(parsed.mechanism as TraumaMechanism)) {
      return parsed.mechanism as TraumaMechanism;
    }

    return null;
  }

  validate(value: TraumaMechanism | null): boolean {
    const validMechanisms: TraumaMechanism[] = [
      'high_energy_collision',
      'fall_from_height',
      'pedestrian_struck',
      'penetrating_injury',
      'low_energy_mechanism',
    ];
    return value !== null && validMechanisms.includes(value);
  }

  generateFallbackQuestion(): string {
    return 'Como ocorreu o trauma? Pode descrever o mecanismo - foi queda, acidente, agressão?';
  }
}

// ============================================================================
// SLOT 16: Neurological Deficit (Déficit Neurológico - FAST Protocol)
// ============================================================================

export class NeurologicalDeficitExtractor extends ConversationalExtractor<{
  facial_droop: boolean;
  arm_weakness: boolean;
  speech_difficulty: boolean;
  onset_time: { duration: number; unit: 'minutes' | 'hours' };
}> {
  constructor(aiBinding: any) {
    super(aiBinding, 'neurological_deficit', 'Déficit Neurológico');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Avalie sinais de AVC usando protocolo FAST.

CONVERSA:
${conversationText}

PROTOCOLO FAST:
- Face: Desvio de face / boca torta
- Arm: Fraqueza em braço/perna
- Speech: Dificuldade na fala / fala arrastada
- Time: Tempo de início

INSTRUÇÕES:
- Identifique cada componente (true/false)
- CRÍTICO: Extraia tempo de início (<4.5h = janela trombólise)

Retorne JSON:
{
  "facial_droop": true|false,
  "arm_weakness": true|false,
  "speech_difficulty": true|false,
  "onset_time": {
    "duration": <número>,
    "unit": "minutes|hours"
  },
  "any_deficit_present": true|false
}`;
  }

  protected parseResponse(llmResponse: string): {
    facial_droop: boolean;
    arm_weakness: boolean;
    speech_difficulty: boolean;
    onset_time: { duration: number; unit: 'minutes' | 'hours' };
  } | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (
      typeof parsed.facial_droop === 'boolean' &&
      typeof parsed.arm_weakness === 'boolean' &&
      typeof parsed.speech_difficulty === 'boolean' &&
      parsed.onset_time &&
      typeof parsed.onset_time.duration === 'number' &&
      (parsed.onset_time.unit === 'minutes' || parsed.onset_time.unit === 'hours')
    ) {
      return {
        facial_droop: parsed.facial_droop,
        arm_weakness: parsed.arm_weakness,
        speech_difficulty: parsed.speech_difficulty,
        onset_time: parsed.onset_time,
      };
    }

    return null;
  }

  validate(
    value: {
      facial_droop: boolean;
      arm_weakness: boolean;
      speech_difficulty: boolean;
      onset_time: { duration: number; unit: 'minutes' | 'hours' };
    } | null
  ): boolean {
    if (value === null) return false;

    // Valida tempo de início
    const { duration, unit } = value.onset_time;
    if (unit === 'hours' && duration > 24) return false;
    if (unit === 'minutes' && duration > 1440) return false;

    return true;
  }

  generateFallbackQuestion(): string {
    return 'O paciente apresenta desvio de face, fraqueza em algum membro ou dificuldade na fala? Quando iniciou?';
  }
}

// ============================================================================
// SLOT 19: Chest Pain Characteristics (Características da Dor Torácica)
// ============================================================================

export class ChestPainCharacteristicsExtractor extends ConversationalExtractor<{
  precordial: boolean;
  pleuritic: boolean;
  radiating: boolean;
  associated_dyspnea: boolean;
  associated_sweating: boolean;
  onset_exertion: boolean;
}> {
  constructor(aiBinding: any) {
    super(aiBinding, 'chest_pain_characteristics', 'Características da Dor Torácica');
  }

  protected buildExtractionPrompt(conversationText: string): string {
    return `Analise as CARACTERÍSTICAS DA DOR TORÁCICA para suspeita de IAM.

CONVERSA:
${conversationText}

CARACTERÍSTICAS IMPORTANTES:
- Precordial: Dor na região do coração/centro do peito
- Pleurítica: Dor que piora ao respirar
- Irradiação: Dor que irradia (braço, mandíbula, costas)
- Dispneia associada: Falta de ar junto
- Sudorese: Suor frio
- Início ao esforço: Começou durante atividade física

Retorne JSON com true/false para cada:
{
  "precordial": true|false,
  "pleuritic": true|false,
  "radiating": true|false,
  "radiation_sites": ["braço esquerdo", "mandíbula"],
  "associated_dyspnea": true|false,
  "associated_sweating": true|false,
  "onset_exertion": true|false,
  "quality": "aperto|queimação|peso|pontada"
}`;
  }

  protected parseResponse(llmResponse: string): {
    precordial: boolean;
    pleuritic: boolean;
    radiating: boolean;
    associated_dyspnea: boolean;
    associated_sweating: boolean;
    onset_exertion: boolean;
  } | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (
      typeof parsed.precordial === 'boolean' &&
      typeof parsed.pleuritic === 'boolean' &&
      typeof parsed.radiating === 'boolean' &&
      typeof parsed.associated_dyspnea === 'boolean' &&
      typeof parsed.associated_sweating === 'boolean' &&
      typeof parsed.onset_exertion === 'boolean'
    ) {
      return {
        precordial: parsed.precordial,
        pleuritic: parsed.pleuritic,
        radiating: parsed.radiating,
        associated_dyspnea: parsed.associated_dyspnea,
        associated_sweating: parsed.associated_sweating,
        onset_exertion: parsed.onset_exertion,
      };
    }

    return null;
  }

  validate(
    value: {
      precordial: boolean;
      pleuritic: boolean;
      radiating: boolean;
      associated_dyspnea: boolean;
      associated_sweating: boolean;
      onset_exertion: boolean;
    } | null
  ): boolean {
    return value !== null;
  }

  generateFallbackQuestion(): string {
    return 'Como é essa dor no peito? Ela irradia para algum lugar (braço, mandíbula)? Está acompanhada de falta de ar ou suor?';
  }
}
