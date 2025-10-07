/**
 * STT/ASR Integration using Cloudflare Workers AI (Whisper)
 *
 * Converte áudio conversacional em texto para extração de slots
 * Usa Cloudflare Workers AI com modelo Whisper
 */

import { Ai } from '@cloudflare/ai';

export interface TranscriptionRequest {
  audio_url?: string;
  audio_blob?: ArrayBuffer;
  language?: string; // 'pt-BR' default
  speaker_diarization?: boolean;
  session_id: string;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language_detected: string;
  duration_ms: number;
  speakers?: SpeakerSegment[];
  word_timestamps?: WordTimestamp[];
}

export interface SpeakerSegment {
  speaker: 'nurse' | 'patient' | 'unknown';
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export class WhisperWorkerSTT {
  private ai: Ai;

  constructor(binding: any) {
    this.ai = new Ai(binding);
  }

  /**
   * Transcreve áudio usando Cloudflare Workers AI Whisper
   */
  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const startTime = Date.now();

    try {
      // Busca áudio se URL fornecida
      let audioBuffer: ArrayBuffer;
      if (request.audio_url) {
        const response = await fetch(request.audio_url);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.statusText}`);
        }
        audioBuffer = await response.arrayBuffer();
      } else if (request.audio_blob) {
        audioBuffer = request.audio_blob;
      } else {
        throw new Error('No audio source provided');
      }

      // Cloudflare Workers AI Whisper Large V3 Turbo (October 2025)
      // Model: @cf/openai/whisper-large-v3-turbo (2-4x faster than v3)
      const whisperInput = {
        audio: Array.from(new Uint8Array(audioBuffer)),
        source_lang: request.language || 'pt',
      };

      const response = await this.ai.run('@cf/openai/whisper-large-v3-turbo', whisperInput);

      // Resposta do Whisper
      const transcription = response.text || '';
      const confidence = this.estimateConfidence(transcription);

      // Speaker diarization se solicitado (usando heurísticas simples)
      let speakers: SpeakerSegment[] | undefined;
      if (request.speaker_diarization) {
        speakers = this.performSimpleDiarization(transcription);
      }

      const durationMs = Date.now() - startTime;

      return {
        text: transcription,
        confidence,
        language_detected: request.language || 'pt-BR',
        duration_ms: durationMs,
        speakers,
      };
    } catch (error) {
      console.error('Whisper transcription error:', error);
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Transcrição em streaming (para conversas longas)
   */
  async transcribeStream(
    audioStream: ReadableStream<Uint8Array>,
    onChunk: (chunk: TranscriptionResult) => void,
    sessionId: string
  ): Promise<void> {
    const reader = audioStream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);

        // Processa em chunks de ~5 segundos de áudio (assumindo 16kHz mono)
        // ~160KB = 5 segundos
        const currentSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        if (currentSize >= 160_000) {
          const combinedBuffer = this.combineChunks(chunks);
          const result = await this.transcribe({
            audio_blob: combinedBuffer,
            session_id: sessionId,
          });
          onChunk(result);
          chunks.length = 0; // Clear processed chunks
        }
      }

      // Processa chunks restantes
      if (chunks.length > 0) {
        const combinedBuffer = this.combineChunks(chunks);
        const result = await this.transcribe({
          audio_blob: combinedBuffer,
          session_id: sessionId,
        });
        onChunk(result);
      }
    } catch (error) {
      console.error('Stream transcription error:', error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Estima confiança baseada em características do texto
   */
  private estimateConfidence(text: string): number {
    if (!text || text.length < 3) return 0.0;

    let confidence = 0.8; // Base confidence

    // Reduz confiança para textos muito curtos
    if (text.length < 10) confidence -= 0.2;

    // Reduz confiança se muitos caracteres especiais (ruído)
    const specialCharRatio = (text.match(/[^a-zA-Z0-9\sáéíóúâêôãõàçÁÉÍÓÚÂÊÔÃÕÀÇ]/g) || []).length / text.length;
    if (specialCharRatio > 0.1) confidence -= 0.2;

    // Aumenta confiança se contém palavras médicas comuns
    const medicalTerms = [
      'dor',
      'febre',
      'tosse',
      'falta de ar',
      'pressão',
      'diabetes',
      'coração',
      'cabeça',
      'peito',
    ];
    const hasMedicalTerms = medicalTerms.some((term) => text.toLowerCase().includes(term));
    if (hasMedicalTerms) confidence += 0.1;

    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Speaker diarization simples usando heurísticas
   * (em produção, usar modelo dedicado como pyannote)
   */
  private performSimpleDiarization(text: string): SpeakerSegment[] {
    const segments: SpeakerSegment[] = [];
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    // Heurística simples: alternância entre nurse e patient
    // Perguntas = nurse, respostas = patient
    let currentSpeaker: 'nurse' | 'patient' = 'nurse';
    let currentTime = 0;

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      const isQuestion = trimmed.endsWith('?') || trimmed.includes('qual') || trimmed.includes('como');

      if (isQuestion) {
        currentSpeaker = 'nurse';
      } else {
        currentSpeaker = currentSpeaker === 'nurse' ? 'patient' : 'nurse';
      }

      const duration = trimmed.split(' ').length * 0.4; // ~400ms por palavra

      segments.push({
        speaker: currentSpeaker,
        text: trimmed,
        start_time: currentTime,
        end_time: currentTime + duration,
        confidence: 0.7,
      });

      currentTime += duration;
    }

    return segments;
  }

  /**
   * Combina chunks de áudio em um único ArrayBuffer
   */
  private combineChunks(chunks: Uint8Array[]): ArrayBuffer {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined.buffer;
  }
}

/**
 * Real-time audio capture and transcription
 * Usado em interfaces web para captura contínua
 */
export class RealtimeTranscriptionSession {
  private whisper: WhisperWorkerSTT;
  private sessionId: string;
  private onTranscript: (result: TranscriptionResult) => void;
  private audioQueue: Uint8Array[] = [];
  private isProcessing = false;

  constructor(whisper: WhisperWorkerSTT, sessionId: string, onTranscript: (result: TranscriptionResult) => void) {
    this.whisper = whisper;
    this.sessionId = sessionId;
    this.onTranscript = onTranscript;
  }

  /**
   * Adiciona chunk de áudio à fila de processamento
   */
  addAudioChunk(chunk: Uint8Array): void {
    this.audioQueue.push(chunk);
    this.processQueueIfReady();
  }

  /**
   * Processa fila quando atingir tamanho mínimo
   */
  private async processQueueIfReady(): Promise<void> {
    if (this.isProcessing) return;

    const totalSize = this.audioQueue.reduce((acc, chunk) => acc + chunk.length, 0);

    // Processa a cada ~3 segundos de áudio (120KB em 16kHz mono)
    if (totalSize < 120_000) return;

    this.isProcessing = true;

    try {
      const combinedBuffer = this.combineQueuedChunks();
      const result = await this.whisper.transcribe({
        audio_blob: combinedBuffer,
        session_id: this.sessionId,
        language: 'pt-BR',
        speaker_diarization: true,
      });

      this.onTranscript(result);
      this.audioQueue = []; // Clear processed queue
    } catch (error) {
      console.error('Failed to process audio queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Força processamento de chunks pendentes
   */
  async flush(): Promise<void> {
    if (this.audioQueue.length === 0) return;

    const combinedBuffer = this.combineQueuedChunks();
    const result = await this.whisper.transcribe({
      audio_blob: combinedBuffer,
      session_id: this.sessionId,
      language: 'pt-BR',
    });

    this.onTranscript(result);
    this.audioQueue = [];
  }

  private combineQueuedChunks(): ArrayBuffer {
    const totalLength = this.audioQueue.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioQueue) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined.buffer;
  }
}
