/**
 * PIR Historical Slot Extractors - Manchester SP
 *
 * Slots históricos: busca em RMS (Rhizomatic Memory System) + extração conversacional por LLM
 * Prioriza dados de prontuário, usa LLM para extrair de conversa quando ausente
 */

import { ConversationalExtractor } from './base-extractor';
import type { PatientContext, SlotFillRequest } from '../types/slots';

// ============================================================================
// SLOT 11: Previous Medical History (História Médica Pregressa)
// ============================================================================

export class PreviousMedicalHistoryExtractor extends ConversationalExtractor<
  Array<{ condition: string; since?: string; controlled?: boolean }>
> {
  constructor(aiBinding: any) {
    super(aiBinding, 'previous_medical_history', 'História Médica Pregressa');
  }

  protected buildExtractionPrompt(conversationText: string, patientContext?: PatientContext): string {
    return `Extraia a HISTÓRIA MÉDICA PREGRESSA do paciente - doenças crônicas e condições médicas conhecidas.

CONVERSA:
${conversationText}

${patientContext?.medical_history ? `HISTÓRICO PRÉVIO (RMS):
${patientContext.medical_history.join(', ')}` : ''}

CONDIÇÕES RELEVANTES PARA TRIAGEM:
- Diabetes mellitus
- Hipertensão arterial
- Doença cardíaca (IAM prévio, ICC, arritmia)
- Asma / DPOC
- Câncer (tipo, tratamento)
- Imunossupressão (HIV, quimioterapia, corticoides)
- Gestação (semanas)
- Epilepsia
- Doença renal crônica
- Cirrose hepática
- AVC prévio

INSTRUÇÕES:
- Extraia APENAS condições médicas crônicas relevantes
- Inclua tempo desde diagnóstico se mencionado
- Indique se está controlada/descompensada
- Se paciente nega comorbidades: retorne array vazio

Retorne JSON:
{
  "conditions": [
    {
      "condition": "nome da doença",
      "since": "tempo desde diagnóstico ou null",
      "controlled": true|false|null
    }
  ],
  "no_known_conditions": true|false
}`;
  }

  protected parseResponse(llmResponse: string): Array<{ condition: string; since?: string; controlled?: boolean }> | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (parsed.no_known_conditions === true) {
      return [];
    }

    if (Array.isArray(parsed.conditions)) {
      return parsed.conditions.filter((c: any) => typeof c.condition === 'string');
    }

    return null;
  }

  validate(value: Array<{ condition: string; since?: string; controlled?: boolean }> | null): boolean {
    return value !== null && Array.isArray(value);
  }

  generateFallbackQuestion(): string {
    return 'O paciente tem alguma doença crônica? Como diabetes, pressão alta, problema no coração, asma?';
  }
}

// ============================================================================
// SLOT 12: Medications in Use (Medicações em Uso)
// ============================================================================

export class MedicationsInUseExtractor extends ConversationalExtractor<
  Array<{ name: string; dose?: string; frequency?: string; indication?: string }>
> {
  constructor(aiBinding: any) {
    super(aiBinding, 'medications_in_use', 'Medicações em Uso');
  }

  protected buildExtractionPrompt(conversationText: string, patientContext?: PatientContext): string {
    return `Extraia as MEDICAÇÕES EM USO REGULAR pelo paciente.

CONVERSA:
${conversationText}

${patientContext?.medications ? `PRESCRIÇÕES RECENTES (RMS):
${patientContext.medications.join(', ')}` : ''}

MEDICAÇÕES DE ALTO RISCO (atenção especial):
- Anticoagulantes: varfarina, rivaroxabana, apixabana, dabigatrana
- Antiplaquetários: AAS, clopidogrel, ticagrelor
- Insulina e antidiabéticos
- Imunossupressores: corticoides, metotrexato, azatioprina
- Quimioterápicos

INSTRUÇÕES:
- Extraia nome comercial OU princípio ativo
- Inclua dose se mencionada (mg, comprimidos)
- Inclua frequência se mencionada (1x/dia, 12/12h)
- Se paciente não usa medicações: retorne array vazio

Retorne JSON:
{
  "medications": [
    {
      "name": "nome do medicamento",
      "dose": "dosagem ou null",
      "frequency": "frequência ou null",
      "indication": "para que usa ou null"
    }
  ],
  "no_medications": true|false,
  "high_risk_detected": ["lista de medicamentos alto risco"] ou []
}`;
  }

  protected parseResponse(
    llmResponse: string
  ): Array<{ name: string; dose?: string; frequency?: string; indication?: string }> | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (parsed.no_medications === true) {
      return [];
    }

    if (Array.isArray(parsed.medications)) {
      return parsed.medications.filter((m: any) => typeof m.name === 'string');
    }

    return null;
  }

  validate(value: Array<{ name: string; dose?: string; frequency?: string; indication?: string }> | null): boolean {
    return value !== null && Array.isArray(value);
  }

  generateFallbackQuestion(): string {
    return 'O paciente faz uso de alguma medicação regular? Quais remédios toma em casa?';
  }
}

// ============================================================================
// SLOT 13: Allergy History (Histórico de Alergias)
// ============================================================================

export class AllergyHistoryExtractor extends ConversationalExtractor<
  Array<{ allergen: string; reaction?: string; severity?: 'mild' | 'moderate' | 'severe' | 'anaphylaxis' }>
> {
  constructor(aiBinding: any) {
    super(aiBinding, 'allergy_history', 'Histórico de Alergias');
  }

  protected buildExtractionPrompt(conversationText: string, patientContext?: PatientContext): string {
    return `Extraia ALERGIAS DOCUMENTADAS do paciente - informação CRÍTICA para segurança.

CONVERSA:
${conversationText}

${patientContext?.allergies ? `ALERGIAS REGISTRADAS (RMS):
${patientContext.allergies.join(', ')}` : ''}

TIPOS DE ALERGIAS RELEVANTES:
- Medicamentos (antibióticos, analgésicos, anestésicos)
- Contrastes radiológicos (iodo)
- Látex
- Alimentos (pode causar anafilaxia)

GRAVIDADE:
- mild: reação leve (prurido, rash cutâneo)
- moderate: reação moderada (urticária extensa, angioedema)
- severe: reação grave (broncoespasmo, hipotensão)
- anaphylaxis: anafilaxia (PCR, choque anafilático)

INSTRUÇÕES:
- Esta informação é CRÍTICA - ser conservador
- Se paciente diz "não tenho alergia": confirmar explicitamente
- Extrair tipo de reação se mencionada
- Se não tem alergia conhecida: retornar array vazio

Retorne JSON:
{
  "allergies": [
    {
      "allergen": "substância",
      "reaction": "descrição da reação ou null",
      "severity": "mild|moderate|severe|anaphylaxis ou null"
    }
  ],
  "no_known_allergies": true|false,
  "explicitly_confirmed": true|false
}`;
  }

  protected parseResponse(
    llmResponse: string
  ): Array<{ allergen: string; reaction?: string; severity?: 'mild' | 'moderate' | 'severe' | 'anaphylaxis' }> | null {
    const parsed = this.parseJSONFromLLM(llmResponse);
    if (!parsed) return null;

    if (parsed.no_known_allergies === true) {
      return [];
    }

    if (Array.isArray(parsed.allergies)) {
      return parsed.allergies.filter((a: any) => typeof a.allergen === 'string');
    }

    return null;
  }

  validate(
    value: Array<{ allergen: string; reaction?: string; severity?: 'mild' | 'moderate' | 'severe' | 'anaphylaxis' }> | null
  ): boolean {
    return value !== null && Array.isArray(value);
  }

  generateFallbackQuestion(): string {
    return 'IMPORTANTE: O paciente tem alergia a algum medicamento, alimento ou substância? Essa informação é essencial para a segurança.';
  }
}
