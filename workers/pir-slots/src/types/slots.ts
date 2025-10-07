/**
 * PIR Manchester SP - Slots Types
 *
 * Define todos os tipos de slots para extração conversacional de dados clínicos.
 * 19 slots total extraídos usando Cloudflare Workers AI.
 */

/**
 * Conversation turn (user or assistant message)
 */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/**
 * Patient context for extraction
 */
export interface PatientContext {
  patient_id?: string;
  session_id: string;
  conversation_history: ConversationTurn[];
  audio_transcript?: string;
  previous_slots?: Record<string, any>;
}

/**
 * Slot fill request
 */
export interface SlotFillRequest {
  slot_id: string;
  context: PatientContext;
  force_reextract?: boolean;
}

/**
 * Slot extraction result
 */
export interface ExtractionResult<T = unknown> {
  slot_id: string;
  slot_name: string;
  value: T | null;
  confidence: number; // 0-1
  status: SlotStatus;
  reasoning?: string;
  fallback_question?: string;
  extraction_method: 'conversation' | 'device' | 'computed' | 'historical' | 'fallback';
  timestamp: string;
  model_used?: string;
}

/**
 * Slot status
 */
export type SlotStatus =
  | 'extracted' // Successfully extracted from conversation
  | 'pending' // Needs more information
  | 'computed' // Computed from other slots
  | 'device' // Read from device/sensor
  | 'historical' // Retrieved from patient history
  | 'fallback' // Using fallback question
  | 'failed'; // Extraction failed

/**
 * Consciousness level (SLOT 13)
 */
export type ConsciousnessLevel =
  | 'alert' // Alerta, orientado
  | 'voice' // Responde à voz
  | 'pain' // Responde à dor
  | 'unresponsive'; // Não responsivo (AVPU scale)

/**
 * Bleeding severity (SLOT 9)
 */
export type BleedingSeverity =
  | 'minor' // Sangramento menor, controlado
  | 'moderate' // Sangramento moderado
  | 'severe' // Sangramento grave
  | 'life_threatening'; // Hemorragia maciça

/**
 * Trauma mechanism (SLOT 15)
 */
export type TraumaMechanism =
  | 'fall' // Queda
  | 'mva' // Motor vehicle accident
  | 'assault' // Agressão
  | 'penetrating' // Trauma penetrante
  | 'blunt' // Trauma contuso
  | 'burn' // Queimadura
  | 'other'; // Outro mecanismo

/**
 * Medical history condition
 */
export interface MedicalCondition {
  condition: string;
  since?: string; // ISO date or "2 years ago"
  controlled?: boolean;
  medications?: string[];
}

/**
 * Medication
 */
export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  indication?: string;
}

/**
 * Allergy
 */
export interface Allergy {
  allergen: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe' | 'anaphylaxis';
}

/**
 * Complete slot state (all 19 slots)
 */
export interface CompleteSlotState {
  // CONVERSATIONAL SLOTS (8)
  chief_complaint: string | null; // SLOT 1
  pain_score: number | null; // SLOT 2 (0-10)
  symptom_duration: string | null; // SLOT 3 (e.g., "2 hours", "3 days")
  symptom_onset: string | null; // SLOT 4 (ISO timestamp or relative)
  aggravating_factors: string[] | null; // SLOT 5
  alleviating_factors: string[] | null; // SLOT 6
  associated_symptoms: string[] | null; // SLOT 7
  bleeding_present: boolean | null; // SLOT 8

  // CONDITIONAL CONVERSATIONAL SLOT
  bleeding_severity: BleedingSeverity | null; // SLOT 9 (only if bleeding_present)

  // DEVICE/COMPUTED SLOTS (10)
  systolic_bp: number | null; // SLOT 10 (mmHg)
  diastolic_bp: number | null; // SLOT 11 (mmHg)
  heart_rate: number | null; // SLOT 12 (bpm)
  consciousness_level: ConsciousnessLevel | null; // SLOT 13
  respiratory_rate: number | null; // SLOT 14 (irpm)
  trauma_mechanism: TraumaMechanism | null; // SLOT 15
  temperature: number | null; // SLOT 16 (°C)
  oxygen_saturation: number | null; // SLOT 17 (%)
  capillary_glucose: number | null; // SLOT 18 (mg/dL)
  pain_location: string | null; // SLOT 19 (anatomical location)

  // HISTORICAL SLOTS (3)
  previous_medical_history: MedicalCondition[] | null; // SLOT 20
  medications_in_use: Medication[] | null; // SLOT 21
  allergy_history: Allergy[] | null; // SLOT 22
}

/**
 * Slot extraction session
 */
export interface SlotExtractionSession {
  session_id: string;
  patient_id?: string;
  started_at: string;
  completed_at?: string;
  status: 'active' | 'completed' | 'failed';
  slot_state: Partial<CompleteSlotState>;
  extraction_results: ExtractionResult[];
  total_slots: number;
  extracted_slots: number;
  pending_slots: string[];
  failed_slots: string[];
}

/**
 * Workers AI models for slot extraction (October 2025)
 */
export const SLOT_AI_MODELS = {
  CONVERSATIONAL: '@cf/meta/llama-3.1-8b-instruct', // Fast conversational extraction
  WHISPER: '@cf/openai/whisper-large-v3-turbo', // Speech-to-text (2-4x faster)
  REASONING: '@cf/qwen/qwq-32b-preview', // Complex reasoning
  MULTIMODAL: '@cf/meta/llama-4-scout-17b-16e-instruct', // Multimodal MoE (2025)
} as const;

/**
 * Helper: Check if slot is required for Manchester triage
 */
export function isRequiredSlot(slotId: string): boolean {
  const requiredSlots = [
    'chief_complaint',
    'systolic_bp',
    'diastolic_bp',
    'heart_rate',
    'consciousness_level',
    'respiratory_rate',
    'temperature',
    'oxygen_saturation'
  ];

  return requiredSlots.includes(slotId);
}

/**
 * Helper: Get slot display name
 */
export function getSlotDisplayName(slotId: string): string {
  const displayNames: Record<string, string> = {
    chief_complaint: 'Queixa Principal',
    pain_score: 'Intensidade da Dor',
    symptom_duration: 'Duração dos Sintomas',
    symptom_onset: 'Início dos Sintomas',
    aggravating_factors: 'Fatores Agravantes',
    alleviating_factors: 'Fatores Atenuantes',
    associated_symptoms: 'Sintomas Associados',
    bleeding_present: 'Presença de Hemorragia',
    bleeding_severity: 'Gravidade da Hemorragia',
    systolic_bp: 'Pressão Arterial Sistólica',
    diastolic_bp: 'Pressão Arterial Diastólica',
    heart_rate: 'Frequência Cardíaca',
    consciousness_level: 'Nível de Consciência',
    respiratory_rate: 'Frequência Respiratória',
    trauma_mechanism: 'Mecanismo de Trauma',
    temperature: 'Temperatura',
    oxygen_saturation: 'Saturação de Oxigênio',
    capillary_glucose: 'Glicemia Capilar',
    pain_location: 'Localização da Dor',
    previous_medical_history: 'Histórico Médico Prévio',
    medications_in_use: 'Medicações em Uso',
    allergy_history: 'Histórico de Alergias'
  };

  return displayNames[slotId] || slotId;
}
