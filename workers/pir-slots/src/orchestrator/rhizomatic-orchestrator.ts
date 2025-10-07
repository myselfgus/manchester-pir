/**
 * PIR Rhizomatic Orchestrator - AI-Native Slot Extraction
 *
 * Coordena extração paralela dos 18 slots do Protocolo Manchester SP
 * Arquitetura rizomática não-hierárquica: agentes LLM especializados em paralelo
 * Cada slot tem autonomia total, sem dependências de execução sequencial
 * STT (Whisper) → 18 LLMs simultâneos → Consolidação de estado
 */

import { WhisperWorkerSTT, type TranscriptionResult } from '../stt/whisper-worker';
import type {
  SlotState,
  SlotId,
  ConversationTurn,
  PatientContext,
  SlotFillRequest,
  SlotStatus,
  ExtractionResult,
} from '../types/slots';

// Import all extractors
import {
  ChiefComplaintExtractor,
  PainScoreExtractor,
  ConsciousnessLevelExtractor,
  BleedingPresentExtractor,
  BleedingSeverityExtractor,
  SymptomOnsetExtractor,
  TraumaMechanismExtractor,
  NeurologicalDeficitExtractor,
  ChestPainCharacteristicsExtractor,
} from '../extractors/conversational-slots';

import {
  TemperatureExtractor,
  HeartRateExtractor,
  BloodPressureExtractor,
  OxygenSaturationExtractor,
  GlucoseLevelExtractor,
  RespiratoryRateExtractor,
  SepsisCriteriaExtractor,
} from '../extractors/device-computed-slots';

import {
  PreviousMedicalHistoryExtractor,
  MedicationsInUseExtractor,
  AllergyHistoryExtractor,
} from '../extractors/historical-slots';

export interface TriageSession {
  session_id: string;
  patient_id?: string;
  started_at: string;
  conversation_history: ConversationTurn[];
  slot_state: Partial<Record<SlotId, any>>;
  patient_context?: PatientContext;
  status: 'active' | 'completed' | 'abandoned';
}

export interface ExtractionProgress {
  total_slots: number;
  filled_slots: number;
  validated_slots: number;
  pending_slots: string[];
  failed_slots: string[];
  completion_percentage: number;
}

/**
 * Orchestrator Principal - PIR Core
 *
 * Gerencia:
 * 1. STT em tempo real (Whisper)
 * 2. Extração paralela rizomática (18 extractors simultâneos)
 * 3. Validação e fallback conversacional
 * 4. Gestão de estado de slots
 */
export class RhizomaticOrchestrator {
  private aiBinding: any;
  private whisper: WhisperWorkerSTT;
  private sessions: Map<string, TriageSession> = new Map();

  // Extractors registry (todos os 18)
  private extractors: Map<SlotId, any>;

  constructor(aiBinding: any) {
    this.aiBinding = aiBinding;
    this.whisper = new WhisperWorkerSTT(aiBinding);

    // Initialize all 19 extractors (Manchester SP PIR)
    this.extractors = new Map([
      ['chief_complaint', new ChiefComplaintExtractor(aiBinding)],
      ['pain_score', new PainScoreExtractor(aiBinding)],
      ['temperature', new TemperatureExtractor(aiBinding)],
      ['heart_rate', new HeartRateExtractor(aiBinding)],
      ['blood_pressure', new BloodPressureExtractor(aiBinding)],
      ['oxygen_saturation', new OxygenSaturationExtractor(aiBinding)],
      ['consciousness_level', new ConsciousnessLevelExtractor(aiBinding)],
      ['bleeding_present', new BleedingPresentExtractor(aiBinding)],
      ['bleeding_severity', new BleedingSeverityExtractor(aiBinding)],
      ['symptom_onset', new SymptomOnsetExtractor(aiBinding)],
      ['previous_medical_history', new PreviousMedicalHistoryExtractor(aiBinding)],
      ['medications_in_use', new MedicationsInUseExtractor(aiBinding)],
      ['allergy_history', new AllergyHistoryExtractor(aiBinding)],
      ['glucose_level', new GlucoseLevelExtractor(aiBinding)],
      ['trauma_mechanism', new TraumaMechanismExtractor(aiBinding)],
      ['neurological_deficit', new NeurologicalDeficitExtractor(aiBinding)],
      ['sepsis_criteria', new SepsisCriteriaExtractor(aiBinding)],
      ['respiratory_rate', new RespiratoryRateExtractor(aiBinding)],
      ['chest_pain_characteristics', new ChestPainCharacteristicsExtractor(aiBinding)],
    ]);
  }

  /**
   * Inicia nova sessão de triagem
   */
  startSession(sessionId: string, patientContext?: PatientContext): TriageSession {
    const session: TriageSession = {
      session_id: sessionId,
      patient_id: patientContext?.patient_id,
      started_at: new Date().toISOString(),
      conversation_history: [],
      slot_state: {},
      patient_context: patientContext,
      status: 'active',
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Processa áudio conversacional e extrai slots em paralelo (RIZOMÁTICO)
   *
   * ARQUITETURA RIZOMÁTICA:
   * - Transcreve áudio (Whisper)
   * - Dispara TODOS os 18 extractors EM PARALELO
   * - Não há hierarquia: todos processam simultaneamente
   * - Cada extractor decide se consegue extrair do contexto atual
   */
  async processAudioAndExtractSlots(
    sessionId: string,
    audioBuffer: ArrayBuffer,
    speaker: 'nurse' | 'patient'
  ): Promise<{
    transcription: TranscriptionResult;
    extraction_results: Partial<Record<SlotId, ExtractionResult<any>>>;
    session_state: TriageSession;
    progress: ExtractionProgress;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // STEP 1: Transcrição STT (Whisper)
    console.log(`[PIR] Transcribing audio for session ${sessionId}...`);
    const transcription = await this.whisper.transcribe({
      audio_blob: audioBuffer,
      session_id: sessionId,
      language: 'pt-BR',
      speaker_diarization: false, // Já sabemos o speaker
    });

    // Adiciona ao histórico conversacional
    const turn: ConversationTurn = {
      role: speaker,
      content: transcription.text,
      timestamp: new Date().toISOString(),
    };
    session.conversation_history.push(turn);

    console.log(`[PIR] Transcription: "${transcription.text}"`);

    // STEP 2: EXTRAÇÃO RIZOMÁTICA PARALELA (CORE DO PIR)
    console.log(`[PIR] Launching rhizomatic parallel extraction (18 extractors)...`);

    const extractionPromises = Array.from(this.extractors.entries()).map(async ([slotId, extractor]) => {
      try {
        // Cada extractor recebe contexto completo e decide autonomamente
        const request: SlotFillRequest = {
          slot_id: slotId,
          conversation_context: session.conversation_history,
          patient_context: session.patient_context,
          attempt: 1,
        };

        const result = await extractor.extract(request);
        return { slotId, result };
      } catch (error) {
        console.error(`[PIR] Extractor ${slotId} failed:`, error);
        return {
          slotId,
          result: {
            value: null,
            confidence: 0.0,
            source: 'llm_extraction' as const,
            timestamp: new Date().toISOString(),
            reasoning: `Extraction error: ${error}`,
          },
        };
      }
    });

    // Aguarda TODAS as extrações em paralelo
    const extractionResults = await Promise.all(extractionPromises);

    // STEP 3: Atualiza estado dos slots
    const extractionMap: Partial<Record<SlotId, ExtractionResult<any>>> = {};

    for (const { slotId, result } of extractionResults) {
      extractionMap[slotId] = result;

      // Atualiza slot state se extração bem-sucedida
      if (result.value !== null && result.confidence > 0.5) {
        session.slot_state[slotId] = result.value;
        console.log(`[PIR] ✓ Slot ${slotId} extracted: ${JSON.stringify(result.value).substring(0, 100)}`);
      } else {
        console.log(`[PIR] ○ Slot ${slotId} not extracted (confidence: ${result.confidence})`);
      }
    }

    // STEP 4: Calcula progresso
    const progress = this.calculateProgress(session);

    console.log(
      `[PIR] Progress: ${progress.filled_slots}/${progress.total_slots} slots filled (${progress.completion_percentage}%)`
    );

    return {
      transcription,
      extraction_results: extractionMap,
      session_state: session,
      progress,
    };
  }

  /**
   * Processa texto diretamente (sem áudio)
   * Útil para interface web/chat
   */
  async processTextAndExtractSlots(
    sessionId: string,
    text: string,
    speaker: 'nurse' | 'patient' | 'system'
  ): Promise<{
    extraction_results: Partial<Record<SlotId, ExtractionResult<any>>>;
    session_state: TriageSession;
    progress: ExtractionProgress;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Adiciona texto ao histórico
    const turn: ConversationTurn = {
      role: speaker,
      content: text,
      timestamp: new Date().toISOString(),
    };
    session.conversation_history.push(turn);

    // Extração paralela
    const extractionPromises = Array.from(this.extractors.entries()).map(async ([slotId, extractor]) => {
      const request: SlotFillRequest = {
        slot_id: slotId,
        conversation_context: session.conversation_history,
        patient_context: session.patient_context,
        attempt: 1,
      };

      try {
        const result = await extractor.extract(request);
        return { slotId, result };
      } catch (error) {
        return {
          slotId,
          result: {
            value: null,
            confidence: 0.0,
            source: 'llm_extraction' as const,
            timestamp: new Date().toISOString(),
          },
        };
      }
    });

    const extractionResults = await Promise.all(extractionPromises);

    const extractionMap: Partial<Record<SlotId, ExtractionResult<any>>> = {};
    for (const { slotId, result } of extractionResults) {
      extractionMap[slotId] = result;
      if (result.value !== null && result.confidence > 0.5) {
        session.slot_state[slotId] = result.value;
      }
    }

    const progress = this.calculateProgress(session);

    return {
      extraction_results: extractionMap,
      session_state: session,
      progress,
    };
  }

  /**
   * Gera próxima pergunta inteligente
   * Identifica slot mais crítico não preenchido e gera pergunta de fallback
   */
  async generateNextQuestion(sessionId: string): Promise<{
    slot_id: SlotId;
    question: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    reasoning: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Define prioridades de slots (CRÍTICOS primeiro)
    const slotPriorities: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
      chief_complaint: 'critical',
      consciousness_level: 'critical',
      temperature: 'critical',
      heart_rate: 'critical',
      blood_pressure: 'critical',
      oxygen_saturation: 'critical',
      respiratory_rate: 'critical',
      bleeding_present: 'high',
      allergy_history: 'high',
      pain_score: 'high',
      symptom_onset: 'high',
      previous_medical_history: 'medium',
      medications_in_use: 'medium',
      glucose_level: 'low',
      trauma_mechanism: 'high',
      neurological_deficit: 'high',
      sepsis_criteria: 'medium',
      chest_pain_characteristics: 'high',
      bleeding_severity: 'high',
    };

    // Encontra slots não preenchidos por prioridade
    const unfilled = Array.from(this.extractors.keys()).filter((slotId) => {
      return !session.slot_state[slotId];
    });

    if (unfilled.length === 0) {
      return {
        slot_id: 'chief_complaint' as SlotId,
        question: 'Todos os dados necessários foram coletados. Podemos prosseguir com a classificação.',
        priority: 'low',
        reasoning: 'All slots filled',
      };
    }

    // Ordena por prioridade
    unfilled.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const prioA = priorityOrder[slotPriorities[a] || 'low'];
      const prioB = priorityOrder[slotPriorities[b] || 'low'];
      return prioA - prioB;
    });

    const nextSlotId = unfilled[0] as SlotId;
    const extractor = this.extractors.get(nextSlotId);

    if (!extractor) {
      throw new Error(`No extractor found for slot ${nextSlotId}`);
    }

    const question = extractor.generateFallbackQuestion(session.conversation_history);
    const priority = slotPriorities[nextSlotId] || 'low';

    return {
      slot_id: nextSlotId,
      question,
      priority,
      reasoning: `Slot ${nextSlotId} is unfilled and has ${priority} priority`,
    };
  }

  /**
   * Calcula progresso da sessão
   */
  private calculateProgress(session: TriageSession): ExtractionProgress {
    const totalSlots = this.extractors.size;
    const filledSlots = Object.keys(session.slot_state).length;
    const pendingSlots = Array.from(this.extractors.keys()).filter((slotId) => !session.slot_state[slotId]);

    // TODO: Track validation state separately
    const validatedSlots = filledSlots; // Por ora assume validados = preenchidos

    return {
      total_slots: totalSlots,
      filled_slots: filledSlots,
      validated_slots: validatedSlots,
      pending_slots: pendingSlots,
      failed_slots: [], // TODO: Track failures
      completion_percentage: Math.round((filledSlots / totalSlots) * 100),
    };
  }

  /**
   * Obtém estado atual da sessão
   */
  getSession(sessionId: string): TriageSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Finaliza sessão e retorna resultado completo
   */
  completeSession(sessionId: string): {
    session: TriageSession;
    filled_slots: Partial<Record<SlotId, any>>;
    progress: ExtractionProgress;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'completed';
    const progress = this.calculateProgress(session);

    return {
      session,
      filled_slots: session.slot_state,
      progress,
    };
  }

  /**
   * Força extração de slot específico (útil para re-tentativas)
   */
  async forceExtractSlot(sessionId: string, slotId: SlotId): Promise<ExtractionResult<any>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const extractor = this.extractors.get(slotId);
    if (!extractor) {
      throw new Error(`No extractor found for slot ${slotId}`);
    }

    const request: SlotFillRequest = {
      slot_id: slotId,
      conversation_context: session.conversation_history,
      patient_context: session.patient_context,
      attempt: 1,
    };

    const result = await extractor.extract(request);

    if (result.value !== null && result.confidence > 0.5) {
      session.slot_state[slotId] = result.value;
    }

    return result;
  }

  /**
   * Atualiza slot manualmente (para correções do enfermeiro)
   */
  updateSlotManually(sessionId: string, slotId: SlotId, value: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.slot_state[slotId] = value;

    // Adiciona ao histórico como correção
    session.conversation_history.push({
      role: 'system',
      content: `Slot ${slotId} atualizado manualmente para: ${JSON.stringify(value)}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Exporta dados para PIR Manchester
   */
  exportToPIR(sessionId: string): {
    session_id: string;
    patient_id?: string;
    timestamp: string;
    slots: Partial<Record<SlotId, any>>;
    conversation_transcript: ConversationTurn[];
    completion_percentage: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const progress = this.calculateProgress(session);

    return {
      session_id: session.session_id,
      patient_id: session.patient_id,
      timestamp: new Date().toISOString(),
      slots: session.slot_state,
      conversation_transcript: session.conversation_history,
      completion_percentage: progress.completion_percentage,
    };
  }
}
