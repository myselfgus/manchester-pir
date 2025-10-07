/**
 * PIR Base LLM Extractor - AI-Native Slot Extraction
 *
 * LLM como motor de extração: cada slot é processado por um agente LLM dedicado
 * Arquitetura rizomática não-hierárquica: extractors operam em paralelo máximo
 * Cloudflare Workers AI para inferência local-first em edge
 */

import { Ai } from '@cloudflare/ai';
import type {
  ConversationTurn,
  ExtractionResult,
  PatientContext,
  SlotFillRequest,
  SlotStatus,
} from '../types/slots';

export interface ExtractorConfig {
  model: string; // @cf/meta/llama-3-8b-instruct, @cf/anthropic/claude-3-haiku, etc
  temperature: number;
  max_tokens: number;
  retry_on_failure: boolean;
  max_retries: number;
}

export const DEFAULT_CONFIG: ExtractorConfig = {
  model: '@cf/meta/llama-3.1-8b-instruct', // Fast, edge-optimized
  temperature: 0.1, // Low temp for extraction accuracy
  max_tokens: 500,
  retry_on_failure: true,
  max_retries: 2,
};

/**
 * Base class para todos os extractors de slots
 * Cada slot herda e implementa extract() com prompt específico
 */
export abstract class BaseSlotExtractor<T = unknown> {
  protected ai: Ai;
  protected config: ExtractorConfig;
  protected slotId: string;
  protected slotName: string;

  constructor(aiBinding: any, slotId: string, slotName: string, config: Partial<ExtractorConfig> = {}) {
    this.ai = new Ai(aiBinding);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.slotId = slotId;
    this.slotName = slotName;
  }

  /**
   * Extrai valor do slot a partir do contexto conversacional
   * Implementado por cada extractor específico
   */
  abstract extract(request: SlotFillRequest): Promise<ExtractionResult<T>>;

  /**
   * Valida resultado extraído
   * Implementado por cada extractor específico
   */
  abstract validate(value: T | null): boolean;

  /**
   * Gera pergunta de fallback quando extração falha
   * Implementado por cada extractor específico
   */
  abstract generateFallbackQuestion(context: ConversationTurn[]): string;

  /**
   * Chama LLM com prompt de extração
   */
  protected async callLLM(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.max_retries; attempt++) {
      try {
        const response = await this.ai.run(this.config.model, {
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.max_tokens,
        });

        // Cloudflare Workers AI response structure
        if (response && typeof response === 'object' && 'response' in response) {
          return (response as { response: string }).response;
        }

        throw new Error('Invalid LLM response structure');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown LLM error');
        console.error(`LLM call attempt ${attempt + 1} failed:`, lastError);

        if (attempt < this.config.max_retries - 1) {
          // Exponential backoff
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error('LLM extraction failed after retries');
  }

  /**
   * Constrói contexto conversacional formatado
   */
  protected buildConversationContext(turns: ConversationTurn[]): string {
    return turns
      .map((turn) => {
        const speaker = turn.role === 'nurse' ? 'Enfermeiro(a)' : turn.role === 'patient' ? 'Paciente' : 'Sistema';
        return `${speaker}: ${turn.content}`;
      })
      .join('\n');
  }

  /**
   * Extrai JSON de resposta LLM (parsing robusto)
   */
  protected parseJSONFromLLM(text: string): Record<string, unknown> | null {
    try {
      // Tenta parse direto
      return JSON.parse(text);
    } catch {
      // Tenta extrair JSON de markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // Continue to next attempt
        }
      }

      // Tenta encontrar primeiro objeto JSON válido
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Continue to next attempt
        }
      }

      return null;
    }
  }

  /**
   * Calcula confiança baseada em múltiplos fatores
   */
  protected calculateConfidence(factors: {
    extractionSuccess: boolean;
    validationPassed: boolean;
    contextQuality: number; // 0-1
    llmConfidence?: number; // 0-1 if provided by LLM
  }): number {
    let confidence = 0.5;

    if (factors.extractionSuccess) confidence += 0.2;
    if (factors.validationPassed) confidence += 0.2;
    confidence += factors.contextQuality * 0.3;
    if (factors.llmConfidence !== undefined) {
      confidence = (confidence + factors.llmConfidence) / 2;
    }

    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Avalia qualidade do contexto conversacional
   */
  protected assessContextQuality(turns: ConversationTurn[]): number {
    if (turns.length === 0) return 0.0;

    let quality = 0.3; // Base quality

    // Mais turnos = melhor contexto (até um limite)
    quality += Math.min(turns.length / 10, 0.3);

    // Presença de ambos falantes
    const hasNurse = turns.some((t) => t.role === 'nurse');
    const hasPatient = turns.some((t) => t.role === 'patient');
    if (hasNurse && hasPatient) quality += 0.2;

    // Comprimento médio adequado (não muito curto, não muito longo)
    const avgLength = turns.reduce((sum, t) => sum + t.content.length, 0) / turns.length;
    if (avgLength > 10 && avgLength < 500) quality += 0.2;

    return Math.min(quality, 1.0);
  }

  /**
   * Busca informação em histórico médico (RMS integration)
   */
  protected async fetchFromMedicalRecords(
    patientId: string,
    dataType: 'medical_history' | 'medications' | 'allergies' | 'vital_signs',
    timeWindow?: string
  ): Promise<unknown> {
    try {
      // TODO: Integrar com RMS (Rhizomatic Memory System)
      // Por ora, retorna mock
      console.log(`Fetching ${dataType} for patient ${patientId} (window: ${timeWindow})`);
      return null;
    } catch (error) {
      console.error('Failed to fetch from medical records:', error);
      return null;
    }
  }

  /**
   * Helper: sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cria resultado de extração padrão para falha
   */
  protected createFailureResult(reason: string): ExtractionResult<T> {
    return {
      value: null,
      confidence: 0.0,
      source: 'llm_extraction',
      timestamp: new Date().toISOString(),
      reasoning: `Extraction failed: ${reason}`,
    };
  }
}

/**
 * Extractor para slots conversacionais (maioria dos slots)
 */
export abstract class ConversationalExtractor<T> extends BaseSlotExtractor<T> {
  protected systemPrompt = `Você é um assistente médico especializado em triagem de emergência (Protocolo Manchester).
Sua função é extrair informações específicas de conversas entre enfermeiro e paciente.

IMPORTANTE:
- Extraia APENAS a informação solicitada
- Se a informação não estiver presente, retorne null
- Seja preciso e objetivo
- Retorne sempre em formato JSON válido
- Use linguagem médica apropriada`;

  async extract(request: SlotFillRequest): Promise<ExtractionResult<T>> {
    try {
      const conversationText = this.buildConversationContext(request.conversation_context);
      const contextQuality = this.assessContextQuality(request.conversation_context);

      const prompt = this.buildExtractionPrompt(conversationText, request.patient_context);

      const llmResponse = await this.callLLM(prompt, this.systemPrompt);
      const parsed = this.parseResponse(llmResponse);

      if (parsed === null) {
        return this.createFailureResult('Failed to parse LLM response');
      }

      const isValid = this.validate(parsed);
      const confidence = this.calculateConfidence({
        extractionSuccess: true,
        validationPassed: isValid,
        contextQuality,
      });

      return {
        value: parsed,
        confidence,
        source: 'llm_extraction',
        timestamp: new Date().toISOString(),
        raw_text: conversationText,
        reasoning: llmResponse,
      };
    } catch (error) {
      console.error(`Extraction failed for slot ${this.slotId}:`, error);
      return this.createFailureResult(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Constrói prompt específico de extração
   * Implementado por cada slot
   */
  protected abstract buildExtractionPrompt(conversationText: string, patientContext?: PatientContext): string;

  /**
   * Parse resposta LLM para tipo T
   * Implementado por cada slot
   */
  protected abstract parseResponse(llmResponse: string): T | null;
}

/**
 * Extractor para slots de dispositivos (sinais vitais)
 */
export abstract class DeviceExtractor<T> extends BaseSlotExtractor<T> {
  async extract(request: SlotFillRequest): Promise<ExtractionResult<T>> {
    try {
      // Tenta extrair de contexto conversacional (enfermeiro falando medição)
      const conversationText = this.buildConversationContext(request.conversation_context);
      const extractedFromConversation = await this.extractFromConversation(conversationText);

      if (extractedFromConversation !== null) {
        const isValid = this.validate(extractedFromConversation);
        const confidence = this.calculateConfidence({
          extractionSuccess: true,
          validationPassed: isValid,
          contextQuality: 0.8,
        });

        return {
          value: extractedFromConversation,
          confidence,
          source: 'device',
          timestamp: new Date().toISOString(),
        };
      }

      // Se não encontrou em conversa, aguarda medição real de dispositivo
      return {
        value: null,
        confidence: 0.0,
        source: 'device',
        timestamp: new Date().toISOString(),
        reasoning: 'Awaiting device measurement',
      };
    } catch (error) {
      console.error(`Device extraction failed for slot ${this.slotId}:`, error);
      return this.createFailureResult(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Tenta extrair medição de dispositivo da conversa
   */
  protected abstract extractFromConversation(conversationText: string): Promise<T | null>;
}

/**
 * Extractor para slots computados (calculados de outros slots)
 */
export abstract class ComputedExtractor<T> extends BaseSlotExtractor<T> {
  async extract(request: SlotFillRequest): Promise<ExtractionResult<T>> {
    try {
      // Pega valores de outros slots necessários
      const inputs = await this.gatherInputs(request);

      if (!this.hasRequiredInputs(inputs)) {
        return {
          value: null,
          confidence: 0.0,
          source: 'computed',
          timestamp: new Date().toISOString(),
          reasoning: 'Missing required input slots',
        };
      }

      const computed = this.compute(inputs);
      const isValid = this.validate(computed);

      return {
        value: computed,
        confidence: isValid ? 0.95 : 0.0,
        source: 'computed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Computation failed for slot ${this.slotId}:`, error);
      return this.createFailureResult(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Reúne inputs necessários para computação
   */
  protected abstract gatherInputs(request: SlotFillRequest): Promise<Record<string, unknown>>;

  /**
   * Verifica se todos inputs necessários estão presentes
   */
  protected abstract hasRequiredInputs(inputs: Record<string, unknown>): boolean;

  /**
   * Realiza computação
   */
  protected abstract compute(inputs: Record<string, unknown>): T;
}
