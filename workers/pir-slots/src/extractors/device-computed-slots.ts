/**
 * PIR Device & Computed Slot Extractors - Manchester SP
 *
 * Device Slots: Sinais vitais de equipamentos médicos ou extração por LLM de áudio transcrito
 * Computed Slots: Cálculos derivados (ex: qSOFA score, sepsis criteria)
 * Usa Cloudflare Workers AI para inferência local-first
 */

import { DeviceExtractor, ComputedExtractor } from './base-extractor';
import type { SlotFillRequest, ConversationTurn } from '../types/slots';

// ============================================================================
// DEVICE SLOTS - Sinais Vitais
// ============================================================================

/**
 * SLOT 3: Temperature (Temperatura)
 */
export class TemperatureExtractor extends DeviceExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'temperature', 'Temperatura Corporal');
  }

  protected async extractFromConversation(conversationText: string): Promise<number | null> {
    // Regex patterns para temperatura em °C
    const patterns = [
      /temperatura.*?(\d{2}[.,]\d{1,2})\s*(?:graus|°|celsius)?/i,
      /(\d{2}[.,]\d{1,2})\s*(?:graus|°C|celsius)/i,
      /temp.*?(\d{2}[.,]\d{1,2})/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const temp = parseFloat(match[1].replace(',', '.'));
        if (temp >= 32 && temp <= 43) {
          return temp;
        }
      }
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 32.0 && value <= 43.0);
  }

  generateFallbackQuestion(): string {
    return 'Qual a temperatura do paciente?';
  }
}

/**
 * SLOT 4: Heart Rate (Frequência Cardíaca)
 */
export class HeartRateExtractor extends DeviceExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'heart_rate', 'Frequência Cardíaca');
  }

  protected async extractFromConversation(conversationText: string): Promise<number | null> {
    const patterns = [
      /frequência cardíaca.*?(\d{2,3})\s*(?:bpm)?/i,
      /FC.*?(\d{2,3})\s*(?:bpm)?/i,
      /pulso.*?(\d{2,3})\s*(?:bpm)?/i,
      /(\d{2,3})\s*batimentos/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const hr = parseInt(match[1], 10);
        if (hr >= 20 && hr <= 250) {
          return hr;
        }
      }
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 20 && value <= 250);
  }

  generateFallbackQuestion(): string {
    return 'Qual a frequência cardíaca do paciente?';
  }
}

/**
 * SLOT 5: Blood Pressure (Pressão Arterial)
 */
export class BloodPressureExtractor extends DeviceExtractor<{ systolic: number; diastolic: number }> {
  constructor(aiBinding: any) {
    super(aiBinding, 'blood_pressure', 'Pressão Arterial');
  }

  protected async extractFromConversation(conversationText: string): Promise<{ systolic: number; diastolic: number } | null> {
    const patterns = [
      /pressão arterial.*?(\d{2,3})\s*[x\/]\s*(\d{2,3})/i,
      /PA.*?(\d{2,3})\s*[x\/]\s*(\d{2,3})/i,
      /(\d{2,3})\s*[x\/]\s*(\d{2,3})\s*mmHg/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const systolic = parseInt(match[1], 10);
        const diastolic = parseInt(match[2], 10);

        if (
          systolic >= 50 &&
          systolic <= 300 &&
          diastolic >= 30 &&
          diastolic <= 200 &&
          systolic > diastolic
        ) {
          return { systolic, diastolic };
        }
      }
    }

    return null;
  }

  validate(value: { systolic: number; diastolic: number } | null): boolean {
    if (value === null) return false;
    return (
      value.systolic >= 50 &&
      value.systolic <= 300 &&
      value.diastolic >= 30 &&
      value.diastolic <= 200 &&
      value.systolic > value.diastolic
    );
  }

  generateFallbackQuestion(): string {
    return 'Qual a pressão arterial do paciente?';
  }
}

/**
 * SLOT 6: Oxygen Saturation (SpO2)
 */
export class OxygenSaturationExtractor extends DeviceExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'oxygen_saturation', 'Saturação de Oxigênio');
  }

  protected async extractFromConversation(conversationText: string): Promise<number | null> {
    const patterns = [
      /saturação.*?(\d{2,3})\s*%/i,
      /SpO2.*?(\d{2,3})\s*%?/i,
      /oximetria.*?(\d{2,3})\s*%/i,
      /sat.*?(\d{2,3})\s*%/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const spo2 = parseInt(match[1], 10);
        if (spo2 >= 50 && spo2 <= 100) {
          return spo2;
        }
      }
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 50 && value <= 100);
  }

  generateFallbackQuestion(): string {
    return 'Qual a saturação de oxigênio (SpO2) do paciente?';
  }
}

/**
 * SLOT 14: Glucose Level (Glicemia)
 */
export class GlucoseLevelExtractor extends DeviceExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'glucose_level', 'Glicemia Capilar');
  }

  protected async extractFromConversation(conversationText: string): Promise<number | null> {
    const patterns = [
      /glicemia.*?(\d{2,3})\s*(?:mg\/dL)?/i,
      /glicose.*?(\d{2,3})\s*(?:mg\/dL)?/i,
      /dextro.*?(\d{2,3})/i,
      /HGT.*?(\d{2,3})/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const glucose = parseInt(match[1], 10);
        if (glucose >= 10 && glucose <= 800) {
          return glucose;
        }
      }
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 10 && value <= 800);
  }

  generateFallbackQuestion(): string {
    return 'Qual a glicemia capilar do paciente?';
  }
}

/**
 * SLOT 18: Respiratory Rate (Frequência Respiratória)
 */
export class RespiratoryRateExtractor extends DeviceExtractor<number> {
  constructor(aiBinding: any) {
    super(aiBinding, 'respiratory_rate', 'Frequência Respiratória');
  }

  protected async extractFromConversation(conversationText: string): Promise<number | null> {
    const patterns = [
      /frequência respiratória.*?(\d{1,2})\s*(?:irpm)?/i,
      /FR.*?(\d{1,2})\s*(?:irpm)?/i,
      /respiração.*?(\d{1,2})\s*(?:irpm|por minuto)?/i,
      /(\d{1,2})\s*incursões/i,
    ];

    for (const pattern of patterns) {
      const match = conversationText.match(pattern);
      if (match) {
        const rr = parseInt(match[1], 10);
        if (rr >= 4 && rr <= 60) {
          return rr;
        }
      }
    }

    return null;
  }

  validate(value: number | null): boolean {
    return value === null || (value >= 4 && value <= 60);
  }

  generateFallbackQuestion(): string {
    return 'Qual a frequência respiratória do paciente?';
  }
}

// ============================================================================
// COMPUTED SLOTS - Calculados de outros slots
// ============================================================================

/**
 * SLOT 17: Sepsis Criteria (qSOFA Score)
 *
 * Computado de:
 * - blood_pressure (systolic < 100 mmHg) = +1
 * - respiratory_rate (>= 22 irpm) = +1
 * - consciousness_level (altered) = +1
 */
export class SepsisCriteriaExtractor extends ComputedExtractor<{
  qSOFA_score: number;
  infection_suspected: boolean;
  sepsis_alert: boolean;
}> {
  constructor(aiBinding: any) {
    super(aiBinding, 'sepsis_criteria', 'Critérios de Sepse');
  }

  protected async gatherInputs(request: SlotFillRequest): Promise<Record<string, unknown>> {
    // Em produção, buscar do slot state global
    // Por ora, extrair do contexto conversacional
    const conversationText = this.buildConversationContext(request.conversation_context);

    // Extrai sinais vitais
    const bpExtractor = new BloodPressureExtractor(this.ai);
    const rrExtractor = new RespiratoryRateExtractor(this.ai);

    const bp = await bpExtractor.extract(request);
    const rr = await rrExtractor.extract(request);

    // Extrai nível de consciência
    const consciousnessPattern = /confus|desorientad|letárgic|obnubilad|alteração\s+mental/i;
    const consciousnessAltered = consciousnessPattern.test(conversationText);

    // Suspeita de infecção
    const infectionPattern = /febre|infecção|seps|foco\s+infeccios/i;
    const infectionSuspected = infectionPattern.test(conversationText);

    return {
      systolic_bp: bp.value?.systolic || null,
      respiratory_rate: rr.value || null,
      consciousness_altered: consciousnessAltered,
      infection_suspected: infectionSuspected,
    };
  }

  protected hasRequiredInputs(inputs: Record<string, unknown>): boolean {
    return (
      inputs.systolic_bp !== null &&
      inputs.respiratory_rate !== null &&
      typeof inputs.consciousness_altered === 'boolean'
    );
  }

  protected compute(inputs: Record<string, unknown>): {
    qSOFA_score: number;
    infection_suspected: boolean;
    sepsis_alert: boolean;
  } {
    let score = 0;

    // Critério 1: PA sistólica < 100 mmHg
    if (typeof inputs.systolic_bp === 'number' && inputs.systolic_bp < 100) {
      score += 1;
    }

    // Critério 2: FR >= 22 irpm
    if (typeof inputs.respiratory_rate === 'number' && inputs.respiratory_rate >= 22) {
      score += 1;
    }

    // Critério 3: Alteração mental
    if (inputs.consciousness_altered === true) {
      score += 1;
    }

    const infectionSuspected = inputs.infection_suspected === true;
    const sepsisAlert = score >= 2 && infectionSuspected;

    return {
      qSOFA_score: score,
      infection_suspected: infectionSuspected,
      sepsis_alert: sepsisAlert,
    };
  }

  validate(
    value: {
      qSOFA_score: number;
      infection_suspected: boolean;
      sepsis_alert: boolean;
    } | null
  ): boolean {
    return value !== null && value.qSOFA_score >= 0 && value.qSOFA_score <= 3;
  }

  generateFallbackQuestion(): string {
    return 'Há suspeita de infecção ou foco infeccioso?';
  }
}

// ============================================================================
// HISTORICAL SLOTS - Histórico Médico
// ============================================================================

/**
 * SLOT 11: Previous Medical History
 * Extrai de conversa + busca RMS
 */
export class PreviousMedicalHistoryExtractor extends DeviceExtractor<Array<{ condition: string; since?: string }>> {
  constructor(aiBinding: any) {
    super(aiBinding, 'previous_medical_history', 'História Médica Pregressa');
  }

  protected async extractFromConversation(conversationText: string): Promise<Array<{ condition: string; since?: string }> | null> {
    // Usa LLM para extração estruturada
    const prompt = `Extraia DOENÇAS/CONDIÇÕES MÉDICAS PRÉVIAS do paciente.

CONVERSA:
${conversationText}

CONDIÇÕES RELEVANTES:
- Diabetes
- Hipertensão
- Doença cardíaca
- Asma/DPOC
- Câncer
- Epilepsia
- Outras doenças crônicas

Retorne JSON:
{
  "conditions": [
    {"condition": "nome", "since": "tempo|null"}
  ]
}`;

    try {
      const response = await this.callLLM(prompt);
      const parsed = this.parseJSONFromLLM(response);

      if (parsed && Array.isArray(parsed.conditions)) {
        return parsed.conditions;
      }
    } catch (error) {
      console.error('Failed to extract medical history:', error);
    }

    return null;
  }

  validate(value: Array<{ condition: string; since?: string }> | null): boolean {
    return value === null || (Array.isArray(value) && value.every((item) => typeof item.condition === 'string'));
  }

  generateFallbackQuestion(): string {
    return 'O paciente tem alguma doença crônica ou condição médica conhecida? Como diabetes, pressão alta, problema no coração?';
  }
}

/**
 * SLOT 12: Medications in Use
 */
export class MedicationsExtractor extends DeviceExtractor<Array<{ name: string; dose?: string }>> {
  constructor(aiBinding: any) {
    super(aiBinding, 'medications_in_use', 'Medicações em Uso');
  }

  protected async extractFromConversation(conversationText: string): Promise<Array<{ name: string; dose?: string }> | null> {
    const prompt = `Extraia MEDICAÇÕES que o paciente está usando.

CONVERSA:
${conversationText}

Retorne JSON:
{
  "medications": [
    {"name": "nome do medicamento", "dose": "dosagem|null", "frequency": "frequência|null"}
  ],
  "no_medications": true|false
}`;

    try {
      const response = await this.callLLM(prompt);
      const parsed = this.parseJSONFromLLM(response);

      if (parsed?.no_medications === true) {
        return [];
      }

      if (parsed && Array.isArray(parsed.medications)) {
        return parsed.medications;
      }
    } catch (error) {
      console.error('Failed to extract medications:', error);
    }

    return null;
  }

  validate(value: Array<{ name: string; dose?: string }> | null): boolean {
    return value === null || (Array.isArray(value) && value.every((item) => typeof item.name === 'string'));
  }

  generateFallbackQuestion(): string {
    return 'O paciente faz uso de alguma medicação regularmente?';
  }
}

/**
 * SLOT 13: Allergy History
 */
export class AllergyHistoryExtractor extends DeviceExtractor<Array<{ allergen: string; reaction?: string }>> {
  constructor(aiBinding: any) {
    super(aiBinding, 'allergy_history', 'Alergias');
  }

  protected async extractFromConversation(conversationText: string): Promise<Array<{ allergen: string; reaction?: string }> | null> {
    const prompt = `Extraia ALERGIAS do paciente (medicamentos, alimentos, substâncias).

CONVERSA:
${conversationText}

CRÍTICO: Informação de alergia é vital para segurança do paciente.

Retorne JSON:
{
  "allergies": [
    {"allergen": "substância", "reaction": "tipo de reação|null", "severity": "gravidade|null"}
  ],
  "no_known_allergies": true|false
}`;

    try {
      const response = await this.callLLM(prompt);
      const parsed = this.parseJSONFromLLM(response);

      if (parsed?.no_known_allergies === true) {
        return [];
      }

      if (parsed && Array.isArray(parsed.allergies)) {
        return parsed.allergies;
      }
    } catch (error) {
      console.error('Failed to extract allergies:', error);
    }

    return null;
  }

  validate(value: Array<{ allergen: string; reaction?: string }> | null): boolean {
    return value === null || (Array.isArray(value) && value.every((item) => typeof item.allergen === 'string'));
  }

  generateFallbackQuestion(): string {
    return 'O paciente tem alergia a algum medicamento, alimento ou substância? Essa informação é muito importante.';
  }
}
