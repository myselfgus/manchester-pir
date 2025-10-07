/**
 * PIR LLM Reasoning Tasks - Manchester SP
 *
 * Tasks 1-5: Usam Workers AI (LLMs) para automatizar decisões de triagem
 * Cada task é um agente especializado que processa dados dos slots
 */

import { LLMReasoningExecutor } from './base-executor';
import type { Task, TaskContext, WORKERS_AI_MODELS } from '../types/tasks';

// =============================================================================
// TASK 1: Initial Triage Assessment
// =============================================================================

export class InitialTriageAssessmentExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'initial_triage_assessment',
      name: 'Avaliação Inicial de Triagem',
      type: 'llm_reasoning',
      description: 'Interpreta queixa + sinais vitais para sugerir discriminadores e fluxograma',
      execution: {
        local: true,
        sync: false,
        timeout: '5m',
        model: '@cf/qwen/qwq-32b-preview', // Reasoning model
        max_tokens: 800,
      },
      inputs: ['chief_complaint', 'temperature', 'heart_rate', 'blood_pressure', 'oxygen_saturation', 'consciousness_level'],
      outputs: ['initial_discriminators', 'suggested_flowchart'],
      fallback: {
        on_timeout: 'escalate_to_nurse',
        on_error: 'manual_triage',
      },
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;

    const prompt = `SISTEMA DE TRIAGEM MANCHESTER - AVALIAÇÃO INICIAL

Dados do Paciente:
• Queixa principal: ${slots.chief_complaint}
• Temperatura: ${slots.temperature}°C
• Frequência cardíaca: ${slots.heart_rate}bpm
• Pressão arterial: ${slots.blood_pressure?.systolic}/${slots.blood_pressure?.diastolic}mmHg
• SpO2: ${slots.oxygen_saturation}%
• Nível de consciência: ${slots.consciousness_level}

TAREFA 1: Identifique discriminadores gerais presentes
Discriminadores gerais do Protocolo Manchester:
- risco_de_morte: Via aérea comprometida, inconsciência profunda, SpO2 <85%
- dor: Dor severa (≥8/10)
- hemorragia: Sangramento ativo significativo
- consciencia: Alteração do nível de consciência
- temperatura: Febre muito alta (≥41°C) ou hipotermia (<35°C)
- agravamento: Piora súbita

TAREFA 2: Sugira fluxograma Manchester apropriado
52 fluxogramas disponíveis (principais):
- dor_toracica: Dor no peito, precordial, irradiada
- dispneia: Falta de ar, dificuldade respiratória
- cefaleia: Dor de cabeça
- trauma: Lesões físicas, acidentes
- avc: Sinais neurológicos, déficit focal, FAST positivo
- abdome_agudo: Dor abdominal aguda
- febre: Febre como queixa principal
- convulsao: Crises convulsivas
- hemorragia: Sangramentos ativos
- mal_estar_adulto: Indisposição geral, fraqueza
- desmaio: Síncope, perda de consciência
- diabetes: Complicações diabéticas
- alergia: Reações alérgicas
- crianca_chorando: Pediatria - choro excessivo
- And 38 more...

Retorne JSON estruturado:
{
  "initial_discriminators": [
    {
      "type": "risco_de_morte|dor|hemorragia|consciencia|temperatura|agravamento",
      "priority": "EMERGENT|VERY_URGENT|URGENT|LESS_URGENT",
      "reasoning": "justificativa"
    }
  ],
  "suggested_flowchart": "nome_exato_do_fluxograma",
  "reasoning": "por que este fluxograma é apropriado"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const parsed = this.parseJSON(response);

    return {
      initial_discriminators: parsed.initial_discriminators || [],
      suggested_flowchart: parsed.suggested_flowchart || 'mal_estar_adulto',
      reasoning: parsed.reasoning,
    };
  }
}

// =============================================================================
// TASK 2: Flowchart Selection
// =============================================================================

export class FlowchartSelectionExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'flowchart_selection',
      name: 'Seleção do Fluxograma Apropriado',
      type: 'llm_reasoning',
      description: 'Determina qual dos 52 fluxogramas Manchester aplicar',
      execution: {
        local: true,
        sync: false,
        model: '@cf/deepseek/deepseek-r1-distill-qwen-32b', // DeepSeek para reasoning
        max_tokens: 600,
      },
      inputs: ['chief_complaint', 'initial_discriminators'],
      outputs: ['selected_flowchart', 'reasoning'],
      fallback: {
        on_error: 'default_to_indisposicao_adulto',
      },
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;
    const outputs = context.task_outputs;

    const prompt = `SELEÇÃO DE FLUXOGRAMA MANCHESTER - DECISÃO FINAL

Dados disponíveis:
• Queixa principal: ${slots.chief_complaint}
• Discriminadores identificados: ${JSON.stringify(outputs.initial_discriminators, null, 2)}
• Fluxograma sugerido: ${outputs.suggested_flowchart}

FLUXOGRAMAS MANCHESTER (52 total):
Cardiovascular:
- dor_toracica: Dor no peito, precordial, cardíaca
- palpitacoes: Batimentos irregulares

Respiratório:
- dispneia: Falta de ar, dificuldade respiratória
- asma: Crise asmática

Neurológico:
- cefaleia: Dor de cabeça
- avc: Déficit neurológico, FAST positivo
- convulsao: Crises convulsivas
- vertigem: Tontura, vertigem

Trauma:
- trauma: Lesões físicas, acidentes
- ferimentos: Cortes, feridas

Gastrointestinal:
- abdome_agudo: Dor abdominal aguda
- vomito: Vômitos persistentes
- diarreia: Diarreia aguda

Infeccioso:
- febre: Febre como sintoma principal
- infeccao_urinaria: Sintomas urinários

Outros:
- hemorragia: Sangramentos
- desmaio: Síncope
- diabetes: Complicações diabéticas
- alergia: Reações alérgicas
- mal_estar_adulto: Indisposição geral
- problema_ocular: Olhos
- problema_ouvido: Ouvidos
- crianca_chorando: Pediatria

TAREFA: Confirme ou corrija a seleção do fluxograma.
Considere:
1. A queixa principal é o fator mais importante
2. Discriminadores ajudam a priorizar
3. Quando em dúvida, escolha o mais específico

Retorne JSON:
{
  "selected_flowchart": "nome_exato",
  "reasoning": "por que este fluxograma foi escolhido",
  "confidence": "high|medium|low"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const parsed = this.parseJSON(response);

    return {
      selected_flowchart: parsed.selected_flowchart,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence || 'medium',
    };
  }
}

// =============================================================================
// TASK 3: Apply General Discriminators
// =============================================================================

export class ApplyGeneralDiscriminatorsExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'apply_general_discriminators',
      name: 'Aplicar Discriminadores Gerais',
      type: 'llm_reasoning',
      description: 'Avalia discriminadores gerais do Manchester: risco de morte, dor, hemorragia, consciência',
      execution: {
        local: true,
        sync: false,
        timeout: '2m',
        model: '@cf/qwen/qwq-32b-preview',
        max_tokens: 800,
      },
      inputs: ['consciousness_level', 'pain_score', 'bleeding_present', 'bleeding_severity', 'temperature', 'oxygen_saturation', 'symptom_onset'],
      outputs: ['general_discriminator_score', 'highest_priority_discriminator'],
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;

    const prompt = `APLICAÇÃO DE DISCRIMINADORES GERAIS - PROTOCOLO MANCHESTER

Dados Clínicos:
• Consciência: ${slots.consciousness_level}
• Dor (0-10): ${slots.pain_score !== null ? slots.pain_score : 'não avaliada'}
• Sangramento: ${slots.bleeding_present ? 'Sim - ' + (slots.bleeding_severity || 'não especificado') : 'Não'}
• Temperatura: ${slots.temperature}°C
• SpO2: ${slots.oxygen_saturation}%
• Início dos sintomas: ${slots.symptom_onset?.duration} ${slots.symptom_onset?.unit} atrás

DISCRIMINADORES GERAIS (ordem de prioridade decrescente):

1. RISCO DE MORTE (EMERGENT - VERMELHO):
   - Via aérea comprometida
   - Inconsciência (unresponsive, responds_pain)
   - SpO2 < 85%
   - Hemorragia exsanguinante
   - Choque (PA muito baixa)

2. DOR SEVERA (VERY_URGENT - LARANJA):
   - Dor ≥ 8/10

3. HEMORRAGIA INCONTROLÁVEL (prioridade varia):
   - Exsanguinating: EMERGENT
   - Uncontrollable major: VERY_URGENT
   - Uncontrollable minor: URGENT

4. CONSCIÊNCIA ALTERADA (VERY_URGENT):
   - Confuso, desorientado
   - Responde apenas a voz

5. TEMPERATURA EXTREMA (VERY_URGENT):
   - Febre ≥ 41.0°C
   - Hipotermia < 35.0°C

6. AGRAVAMENTO RECENTE (URGENT):
   - Piora súbita nas últimas horas
   - Sintomas novos graves

TAREFA: Identifique TODOS os discriminadores gerais presentes e determine a MAIOR prioridade.

Retorne JSON:
{
  "general_discriminator_score": [
    {
      "discriminator": "risco_de_morte|dor_severa|hemorragia|consciencia|temperatura|agravamento",
      "priority": "EMERGENT|VERY_URGENT|URGENT|LESS_URGENT",
      "details": "especificação do discriminador encontrado"
    }
  ],
  "highest_priority_discriminator": {
    "discriminator": "nome",
    "priority": "EMERGENT|VERY_URGENT|URGENT|LESS_URGENT",
    "reasoning": "por que é a maior prioridade"
  }
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const parsed = this.parseJSON(response);

    return {
      general_discriminator_score: parsed.general_discriminator_score || [],
      highest_priority_discriminator: parsed.highest_priority_discriminator || null,
    };
  }
}

// =============================================================================
// TASK 4: Apply Specific Discriminators
// =============================================================================

export class ApplySpecificDiscriminatorsExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'apply_specific_discriminators',
      name: 'Aplicar Discriminadores Específicos',
      type: 'llm_reasoning',
      description: 'Avalia discriminadores específicos do fluxograma selecionado',
      execution: {
        local: true,
        sync: false,
        timeout: '3m',
        model: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        max_tokens: 1000,
      },
      inputs: ['selected_flowchart', 'all_collected_slots'],
      outputs: ['specific_discriminator_matches', 'flowchart_priority'],
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const flowchart = context.task_outputs.selected_flowchart;
    const slots = context.slot_state;

    const flowchartRules = this.getFlowchartSpecificRules(flowchart);

    const prompt = `DISCRIMINADORES ESPECÍFICOS - FLUXOGRAMA: ${flowchart.toUpperCase()}

Dados completos do paciente:
${JSON.stringify(slots, null, 2)}

${flowchartRules}

TAREFA: Identifique quais discriminadores específicos deste fluxograma se aplicam ao paciente.

Retorne JSON:
{
  "specific_discriminator_matches": [
    {
      "discriminator": "nome_do_discriminador",
      "priority": "EMERGENT|VERY_URGENT|URGENT|LESS_URGENT",
      "criteria_met": "quais critérios foram atendidos"
    }
  ],
  "flowchart_priority": {
    "discriminator": "discriminador de maior prioridade específico",
    "priority": "prioridade",
    "reasoning": "justificativa"
  }
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const parsed = this.parseJSON(response);

    return {
      specific_discriminator_matches: parsed.specific_discriminator_matches || [],
      flowchart_priority: parsed.flowchart_priority || null,
    };
  }

  private getFlowchartSpecificRules(flowchart: string): string {
    const rules: Record<string, string> = {
      dor_toracica: `DISCRIMINADORES ESPECÍFICOS DOR TORÁCICA:

EMERGENT (Vermelho):
- Dor torácica com sinais de choque
- Dor + perda de consciência

VERY_URGENT (Laranja):
- Dor pré-cordial + sudorese profusa (suspeita IAM)
- Dor com irradiação para mandíbula/braço esquerdo
- História cardíaca prévia + dor típica
- SpO2 < 90% com dor torácica

URGENT (Amarelo):
- Dor torácica moderada sem sinais de alarme
- História recente de cirurgia cardíaca`,

      dispneia: `DISCRIMINADORES ESPECÍFICOS DISPNEIA:

EMERGENT:
- Dispneia + cianose central
- SpO2 < 85%
- Estridor ou sibilos graves

VERY_URGENT:
- SpO2 < 90%
- Uso de musculatura acessória evidente
- Incapacidade de falar frases completas
- Taquipneia > 30 rpm

URGENT:
- Dispneia aos pequenos esforços
- SpO2 90-94%`,

      avc: `DISCRIMINADORES ESPECÍFICOS AVC:

EMERGENT:
- Déficit neurológico + início < 4.5 horas (janela terapêutica trombólise!)
- Inconsciência + sinais neurológicos
- FAST positivo (Face, Arms, Speech, Time)

VERY_URGENT:
- Déficit neurológico focal instalado
- Cefaleia súbita intensa ("pior da vida")
- Alteração de marcha súbita`,

      trauma: `DISCRIMINADORES ESPECÍFICOS TRAUMA:

EMERGENT:
- Mecanismo de alto impacto (colisão alta velocidade, queda > 3m, trauma penetrante)
- Politrauma evidente
- Hemorragia incontrolável

VERY_URGENT:
- Trauma craniano com perda de consciência
- Trauma torácico com dispneia
- Fratura exposta`,

      febre: `DISCRIMINADORES ESPECÍFICOS FEBRE:

EMERGENT:
- Febre + petéquias/manchas roxas (suspeita meningococo)
- Febre + rigidez de nuca + fotofobia (suspeita meningite)

VERY_URGENT:
- Febre > 41°C
- Imunossuprimido com febre
- Febre + sinais de sepse (confusão, hipotensão, taquicardia)`,

      abdome_agudo: `DISCRIMINADORES ESPECÍFICOS ABDOME AGUDO:

EMERGENT:
- Abdome agudo + sinais de choque
- Dor abdominal + rigidez de parede (abdome em tábua)

VERY_URGENT:
- Dor abdominal intensa + vômitos
- Suspeita de apendicite/peritonite
- Dor em paciente com aneurisma aórtico conhecido`,
    };

    return rules[flowchart] || 'Sem discriminadores específicos documentados para este fluxograma. Use apenas discriminadores gerais.';
  }
}

// =============================================================================
// TASK 5: Priority Classification
// =============================================================================

export class PriorityClassificationExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'priority_classification',
      name: 'Classificação de Prioridade Final',
      type: 'llm_reasoning',
      description: 'Determina a categoria de prioridade final (vermelho/laranja/amarelo/verde/azul)',
      execution: {
        local: true,
        sync: false,
        timeout: '1m',
        model: '@cf/qwen/qwq-32b-preview',
        max_tokens: 600,
      },
      inputs: ['general_discriminator_score', 'specific_discriminator_matches'],
      outputs: ['final_priority_color', 'final_priority_time', 'classification_reasoning'],
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const outputs = context.task_outputs;

    const prompt = `CLASSIFICAÇÃO FINAL DE PRIORIDADE - PROTOCOLO MANCHESTER

Discriminadores Gerais Identificados:
${JSON.stringify(outputs.general_discriminator_score, null, 2)}

Discriminador Geral de Maior Prioridade:
${JSON.stringify(outputs.highest_priority_discriminator, null, 2)}

Discriminadores Específicos Identificados:
${JSON.stringify(outputs.specific_discriminator_matches, null, 2)}

Discriminador Específico de Maior Prioridade:
${JSON.stringify(outputs.flowchart_priority, null, 2)}

CATEGORIAS MANCHESTER (Portaria SMS 82/2024):

🔴 VERMELHO (Emergente):
   - Tempo: IMEDIATO
   - Situação: Risco iminente de morte
   - Exemplos: Parada cardíaca, inconsciência, SpO2<85%, hemorragia exsanguinante

🟠 LARANJA (Muito Urgente):
   - Tempo: ≤ 10 minutos
   - Situação: Risco de evolução para emergência
   - Exemplos: Dor severa (≥8), suspeita IAM, sepse, AVC em janela terapêutica

🟡 AMARELO (Urgente):
   - Tempo: ≤ 60 minutos
   - Situação: Condição que requer atenção mas não iminentemente grave
   - Exemplos: Dor moderada, febre alta, vômitos persistentes

🟢 VERDE (Pouco Urgente):
   - Tempo: ≤ 120 minutos
   - Situação: Condição estável, não aguda
   - Exemplos: Problemas crônicos agudizados, sintomas leves

🔵 AZUL (Não Urgente):
   - Tempo: ≤ 240 minutos
   - Situação: Consulta de rotina, orientação
   - Exemplos: Atestados, receitas, orientações simples

REGRA FUNDAMENTAL: A PRIORIDADE MAIS ALTA VENCE
Se há um discriminador EMERGENT, mesmo que todos os outros sejam URGENT, a classificação final é VERMELHO.

TAREFA: Determine a classificação final baseada nos discriminadores identificados.

Retorne JSON:
{
  "final_priority_color": "vermelho|laranja|amarelo|verde|azul",
  "final_priority_time": "imediato|10min|60min|120min|240min",
  "classification_reasoning": "explicação detalhada de por que esta foi a classificação escolhida, citando os discriminadores decisivos",
  "manchester_code": "1|2|3|4|5"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const parsed = this.parseJSON(response);

    return {
      final_priority_color: parsed.final_priority_color || 'amarelo',
      final_priority_time: parsed.final_priority_time || '60min',
      classification_reasoning: parsed.classification_reasoning,
      manchester_code: parsed.manchester_code,
    };
  }
}

// =============================================================================
// TASK 8: Activate Priority Flow - Chest Pain (Dor Torácica)
// =============================================================================

export class ActivatePriorityFlowChestPainExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'activate_priority_flow_chest_pain',
      name: 'Ativar Protocolo Prioritário - Dor Torácica',
      type: 'llm_reasoning',
      description: 'Decide se ativa protocolo de dor torácica (ECG, troponina, cardiologia)',
      execution: {
        local: true,
        sync: false,
        model: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        max_tokens: 600,
        distributed_nodes: ['ecg_team', 'cardiology_on_call', 'lab_urgent'],
      },
      inputs: ['patient_id', 'classification_time', 'chest_pain_characteristics'],
      outputs: ['ecg_scheduled', 'cardiology_alerted', 'troponin_ordered'],
      condition: "selected_flowchart == 'dor_toracica' AND final_priority_color IN ['vermelho', 'laranja']",
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;
    const outputs = context.task_outputs;

    const prompt = `PROTOCOLO PRIORITÁRIO DOR TORÁCICA - DECISÃO DE ATIVAÇÃO

Dados do Paciente:
• ID: ${context.patient_id}
• Queixa: ${slots.chief_complaint}
• Prioridade: ${outputs.final_priority_color} (${outputs.final_priority_time})
• Características da dor: ${JSON.stringify(slots.chest_pain_characteristics, null, 2)}
• Sinais vitais: PA ${slots.blood_pressure?.systolic}/${slots.blood_pressure?.diastolic}, FC ${slots.heart_rate}, SpO2 ${slots.oxygen_saturation}%

PROTOCOLO DOR TORÁCICA (Portaria SMS 82/2024):

ATIVAÇÃO OBRIGATÓRIA se:
- Prioridade VERMELHO ou LARANJA
- Dor torácica + sudorese
- Dor precordial com irradiação
- História cardíaca prévia

AÇÕES DO PROTOCOLO:
1. ECG em até 10 minutos (meta: 5min)
2. Dosagem de troponina (lab urgente)
3. Acionamento de cardiologia de plantão
4. Acesso venoso calibroso
5. Monitorização contínua

CONTRA-INDICAÇÕES:
- Dor claramente musculoesquelética
- Paciente já em avaliação cardiológica
- ECG recente normal (<2h)

TAREFA: Decida se deve ativar o protocolo completo e quais ações tomar.

Retorne JSON:
{
  "activate_protocol": true|false,
  "ecg_required": true|false,
  "ecg_priority": "immediate|urgent",
  "cardiology_required": true|false,
  "troponin_required": true|false,
  "continuous_monitoring": true|false,
  "reasoning": "justificativa detalhada da decisão"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const decision = this.parseJSON(response);

    // Se ativou protocolo, notifica nós distribuídos
    if (decision.activate_protocol) {
      await this.notifyProtocolActivation('chest_pain', context, decision);
    }

    return {
      ecg_scheduled: decision.ecg_required,
      ecg_priority: decision.ecg_priority,
      cardiology_alerted: decision.cardiology_required,
      troponin_ordered: decision.troponin_required,
      continuous_monitoring: decision.continuous_monitoring,
      protocol_activated: decision.activate_protocol,
      activation_time: new Date().toISOString(),
      reasoning: decision.reasoning,
    };
  }

  private async notifyProtocolActivation(protocol: string, context: TaskContext, decision: Record<string, any>): Promise<void> {
    const notifications = [];

    if (decision.ecg_required) {
      notifications.push({
        node: 'ecg_team',
        payload: {
          patient_id: context.patient_id,
          priority: decision.ecg_priority,
          protocol: protocol,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (decision.cardiology_required) {
      notifications.push({
        node: 'cardiology_on_call',
        payload: {
          patient_id: context.patient_id,
          protocol: protocol,
          urgency: 'high',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (decision.troponin_required) {
      notifications.push({
        node: 'lab_urgent',
        payload: {
          patient_id: context.patient_id,
          exam: 'troponin',
          priority: 'urgent',
          timestamp: new Date().toISOString(),
        },
      });
    }

    // TODO: Implementar notificação real
    for (const notif of notifications) {
      console.log(`[PROTOCOL] Notifying ${notif.node}:`, notif.payload);
    }
  }
}

// =============================================================================
// TASK 9: Activate Priority Flow - Stroke (AVC)
// =============================================================================

export class ActivatePriorityFlowStrokeExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'activate_priority_flow_stroke',
      name: 'Ativar Protocolo Prioritário - AVC',
      type: 'llm_reasoning',
      description: 'Decide se ativa protocolo AVC (janela terapêutica 4.5h)',
      execution: {
        local: true,
        sync: false,
        model: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        max_tokens: 600,
        distributed_nodes: ['neurology_stroke_team', 'ct_scan_urgent'],
      },
      inputs: ['patient_id', 'neurological_deficit', 'symptom_onset'],
      outputs: ['stroke_protocol_activated', 'ct_scheduled', 'neurology_alerted', 'thrombolysis_eligible'],
      condition: "selected_flowchart == 'avc' AND neurological_deficit.present == true",
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;
    const outputs = context.task_outputs;

    const onset_minutes = this.calculateOnsetMinutes(slots.symptom_onset);

    const prompt = `PROTOCOLO PRIORITÁRIO AVC - JANELA TERAPÊUTICA

Dados do Paciente:
• ID: ${context.patient_id}
• Déficit neurológico: ${JSON.stringify(slots.neurological_deficit, null, 2)}
• Início dos sintomas: ${onset_minutes} minutos atrás
• Prioridade: ${outputs.final_priority_color}

JANELA TERAPÊUTICA TROMBÓLISE:
- < 4.5 horas (270 minutos) desde início dos sintomas
- Tempo atual decorrido: ${onset_minutes} minutos
- Janela disponível: ${270 - onset_minutes} minutos restantes

PROTOCOLO AVC (Code Stroke):
1. TC crânio SEM contraste URGENTE (meta: < 25min chegada)
2. Acionar equipe de neurologia/stroke
3. Acesso venoso calibroso
4. Glicemia capilar
5. Monitorização contínua

CRITÉRIOS DE ATIVAÇÃO:
- Déficit neurológico focal súbito
- FAST positivo (Face, Arms, Speech)
- Dentro da janela terapêutica (<4.5h)
- Sem contraindicação aparente

TAREFA: Decida se ativa protocolo AVC e elegibilidade para trombólise.

Retorne JSON:
{
  "activate_protocol": true|false,
  "within_therapeutic_window": true|false,
  "minutes_remaining": ${270 - onset_minutes},
  "ct_scan_urgent": true|false,
  "neurology_team_alert": true|false,
  "thrombolysis_candidate": true|false,
  "reasoning": "justificativa"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const decision = this.parseJSON(response);

    if (decision.activate_protocol) {
      await this.notifyStrokeTeam(context, decision, onset_minutes);
    }

    return {
      stroke_protocol_activated: decision.activate_protocol,
      ct_scheduled: decision.ct_scan_urgent,
      neurology_alerted: decision.neurology_team_alert,
      thrombolysis_eligible: decision.thrombolysis_candidate,
      therapeutic_window_minutes_remaining: decision.minutes_remaining,
      activation_time: new Date().toISOString(),
      reasoning: decision.reasoning,
    };
  }

  private calculateOnsetMinutes(symptom_onset: any): number {
    if (!symptom_onset) return 999999; // Desconhecido = fora da janela

    const { duration, unit } = symptom_onset;
    
    switch (unit) {
      case 'minutes':
        return duration;
      case 'hours':
        return duration * 60;
      case 'days':
        return duration * 24 * 60;
      default:
        return 999999;
    }
  }

  private async notifyStrokeTeam(context: TaskContext, decision: Record<string, any>, onset_minutes: number): Promise<void> {
    const notifications = [
      {
        node: 'neurology_stroke_team',
        payload: {
          patient_id: context.patient_id,
          protocol: 'code_stroke',
          onset_minutes: onset_minutes,
          therapeutic_window_remaining: decision.minutes_remaining,
          thrombolysis_candidate: decision.thrombolysis_candidate,
          urgency: 'critical',
          timestamp: new Date().toISOString(),
        },
      },
      {
        node: 'ct_scan_urgent',
        payload: {
          patient_id: context.patient_id,
          exam_type: 'tc_cranio_sem_contraste',
          priority: 'critical',
          protocol: 'code_stroke',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    for (const notif of notifications) {
      console.log(`[STROKE PROTOCOL] Notifying ${notif.node}:`, notif.payload);
    }
  }
}

// =============================================================================
// TASK 10: Activate Priority Flow - Sepsis (Sepse)
// =============================================================================

export class ActivatePriorityFlowSepsisExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'activate_priority_flow_sepsis',
      name: 'Ativar Protocolo Prioritário - Sepse',
      type: 'llm_reasoning',
      description: 'Decide se ativa protocolo sepse (bundle 1h)',
      execution: {
        local: true,
        sync: false,
        model: '@cf/qwen/qwq-32b-preview',
        max_tokens: 700,
        distributed_nodes: ['intensive_care', 'lab_urgent', 'pharmacy_sepsis'],
      },
      inputs: ['patient_id', 'sepsis_criteria', 'temperature', 'blood_pressure'],
      outputs: ['sepsis_protocol_activated', 'bundle_1h_initiated', 'intensive_care_alerted'],
      condition: 'sepsis_criteria.qSOFA_score >= 2 AND sepsis_criteria.infection_suspected == true',
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;
    const outputs = context.task_outputs;

    const prompt = `PROTOCOLO PRIORITÁRIO SEPSE - BUNDLE 1 HORA

Dados do Paciente:
• ID: ${context.patient_id}
• Critérios de sepse: ${JSON.stringify(slots.sepsis_criteria, null, 2)}
• Temperatura: ${slots.temperature}°C
• PA: ${slots.blood_pressure?.systolic}/${slots.blood_pressure?.diastolic}mmHg
• FC: ${slots.heart_rate}bpm
• SpO2: ${slots.oxygen_saturation}%
• Prioridade: ${outputs.final_priority_color}

CRITÉRIOS qSOFA (Suspeita Sepse):
- Alteração do estado mental
- PAS < 100 mmHg
- FR ≥ 22 rpm
Score ≥ 2 = Alto risco de mortalidade

BUNDLE SEPSE 1 HORA (meta: 60 minutos):
1. Coleta de culturas (hemocultura, urocultura)
2. Dosagem de lactato
3. Antibiótico de amplo espectro IV
4. Reposição volêmica agressiva (30ml/kg cristaloide)
5. Vasopressores se hipotensão persistente
6. Reavaliação contínua

ATIVAÇÃO OBRIGATÓRIA se:
- qSOFA ≥ 2 + suspeita infecção
- Hipotensão (PAS < 90 mmHg) + febre/hipotermia
- Sinais de choque séptico

TAREFA: Decida se ativa protocolo sepse e bundle 1h.

Retorne JSON:
{
  "activate_protocol": true|false,
  "sepsis_probability": "high|moderate|low",
  "initiate_bundle_1h": true|false,
  "cultures_required": true|false,
  "lactate_required": true|false,
  "antibiotics_urgent": true|false,
  "fluid_resuscitation": true|false,
  "intensive_care_consultation": true|false,
  "reasoning": "justificativa detalhada"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const decision = this.parseJSON(response);

    if (decision.activate_protocol) {
      await this.notifySepsisTeam(context, decision);
    }

    return {
      sepsis_protocol_activated: decision.activate_protocol,
      bundle_1h_initiated: decision.initiate_bundle_1h,
      intensive_care_alerted: decision.intensive_care_consultation,
      cultures_ordered: decision.cultures_required,
      lactate_ordered: decision.lactate_required,
      antibiotics_ordered: decision.antibiotics_urgent,
      fluid_resuscitation_started: decision.fluid_resuscitation,
      sepsis_probability: decision.sepsis_probability,
      activation_time: new Date().toISOString(),
      reasoning: decision.reasoning,
    };
  }

  private async notifySepsisTeam(context: TaskContext, decision: Record<string, any>): Promise<void> {
    const notifications = [
      {
        node: 'intensive_care',
        payload: {
          patient_id: context.patient_id,
          protocol: 'sepsis_bundle_1h',
          probability: decision.sepsis_probability,
          urgency: 'critical',
          timestamp: new Date().toISOString(),
        },
      },
      {
        node: 'lab_urgent',
        payload: {
          patient_id: context.patient_id,
          exams: ['cultures', 'lactate', 'complete_blood_count'],
          priority: 'critical',
          protocol: 'sepsis',
          timestamp: new Date().toISOString(),
        },
      },
      {
        node: 'pharmacy_sepsis',
        payload: {
          patient_id: context.patient_id,
          antibiotics_urgent: true,
          protocol: 'sepsis_bundle',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    for (const notif of notifications) {
      console.log(`[SEPSIS PROTOCOL] Notifying ${notif.node}:`, notif.payload);
    }
  }
}

// =============================================================================
// TASK 11: Activate Priority Flow - Trauma
// =============================================================================

export class ActivatePriorityFlowTraumaExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'activate_priority_flow_trauma',
      name: 'Ativar Protocolo Prioritário - Trauma',
      type: 'llm_reasoning',
      description: 'Decide se ativa protocolo trauma (ATLS)',
      execution: {
        local: true,
        sync: false,
        model: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        max_tokens: 600,
        distributed_nodes: ['trauma_team', 'surgery_on_call', 'radiology_trauma'],
      },
      inputs: ['patient_id', 'trauma_mechanism', 'bleeding_present', 'consciousness_level'],
      outputs: ['trauma_protocol_activated', 'trauma_team_alerted', 'surgery_consulted'],
      condition: "selected_flowchart == 'trauma' AND final_priority_color IN ['vermelho', 'laranja']",
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const slots = context.slot_state;
    const outputs = context.task_outputs;

    const prompt = `PROTOCOLO PRIORITÁRIO TRAUMA - ATLS

Dados do Paciente:
• ID: ${context.patient_id}
• Mecanismo: ${JSON.stringify(slots.trauma_mechanism, null, 2)}
• Sangramento: ${slots.bleeding_present ? slots.bleeding_severity : 'Não'}
• Consciência: ${slots.consciousness_level}
• PA: ${slots.blood_pressure?.systolic}/${slots.blood_pressure?.diastolic}mmHg
• Prioridade: ${outputs.final_priority_color}

MECANISMOS DE ALTO RISCO:
- Colisão alta velocidade (>60 km/h)
- Queda de altura (> 3 metros)
- Trauma penetrante (arma branca/fogo)
- Atropelamento
- Ejeção de veículo
- Óbito no mesmo veículo

PROTOCOLO TRAUMA (ATLS):
1. ABCDE primário (via aérea, ventilação, circulação)
2. Imobilização cervical
3. Acesso venoso de grande calibre (2x)
4. Controle de hemorragia
5. FAST ultrassom (se disponível)
6. Radiografias trauma (RX tórax, pelve)
7. Acionamento cirurgia

ATIVAÇÃO OBRIGATÓRIA se:
- Mecanismo de alto impacto
- Politrauma evidente
- Hemorragia incontrolável
- Instabilidade hemodinâmica
- Rebaixamento de consciência pós-trauma

TAREFA: Decida se ativa protocolo trauma ATLS.

Retorne JSON:
{
  "activate_protocol": true|false,
  "trauma_severity": "major|moderate|minor",
  "trauma_team_required": true|false,
  "surgery_consultation": true|false,
  "fast_ultrasound": true|false,
  "cervical_immobilization": true|false,
  "imaging_required": ["rx_torax", "rx_pelve", "tc_corpo_todo"],
  "reasoning": "justificativa"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const decision = this.parseJSON(response);

    if (decision.activate_protocol) {
      await this.notifyTraumaTeam(context, decision);
    }

    return {
      trauma_protocol_activated: decision.activate_protocol,
      trauma_team_alerted: decision.trauma_team_required,
      surgery_consulted: decision.surgery_consultation,
      trauma_severity: decision.trauma_severity,
      fast_ultrasound_ordered: decision.fast_ultrasound,
      imaging_ordered: decision.imaging_required,
      activation_time: new Date().toISOString(),
      reasoning: decision.reasoning,
    };
  }

  private async notifyTraumaTeam(context: TaskContext, decision: Record<string, any>): Promise<void> {
    const notifications = [
      {
        node: 'trauma_team',
        payload: {
          patient_id: context.patient_id,
          protocol: 'atls',
          severity: decision.trauma_severity,
          urgency: 'critical',
          timestamp: new Date().toISOString(),
        },
      },
      {
        node: 'surgery_on_call',
        payload: {
          patient_id: context.patient_id,
          trauma_consultation: true,
          urgency: 'high',
          timestamp: new Date().toISOString(),
        },
      },
      {
        node: 'radiology_trauma',
        payload: {
          patient_id: context.patient_id,
          imaging: decision.imaging_required,
          priority: 'critical',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    for (const notif of notifications) {
      console.log(`[TRAUMA PROTOCOL] Notifying ${notif.node}:`, notif.payload);
    }
  }
}

// =============================================================================
// TASK 12: Queue Management
// =============================================================================

export class QueueManagementExecutor extends LLMReasoningExecutor {
  constructor(aiBinding: any) {
    const task: Task = {
      task_id: 'queue_management',
      name: 'Gestão de Fila',
      type: 'llm_reasoning',
      description: 'Decide posição na fila e tempo estimado de espera',
      execution: {
        local: true,
        sync: false,
        model: '@cf/qwen/qwq-32b-preview',
        max_tokens: 600,
        distributed_nodes: ['queue_system', 'physician_panel'],
      },
      inputs: ['patient_id', 'final_priority_color', 'final_priority_time', 'arrival_time'],
      outputs: ['queue_position', 'estimated_wait_time', 'physician_notified'],
    };

    super(aiBinding, task);
  }

  protected async executeTask(context: TaskContext): Promise<Record<string, any>> {
    const outputs = context.task_outputs;
    
    // Busca fila atual (mock - deveria vir de sistema real)
    const currentQueue = await this.fetchCurrentQueue();

    const prompt = `GESTÃO DE FILA - INSERÇÃO DE PACIENTE

Paciente Atual:
• ID: ${context.patient_id}
• Prioridade: ${outputs.final_priority_color} (${outputs.final_priority_time})
• Chegada: ${context.arrival_time}
• Classificação: ${outputs.classification_reasoning}

Fila Atual no Sistema:
${JSON.stringify(currentQueue, null, 2)}

REGRAS DE FILA (Protocolo Manchester):
1. Prioridades superiores sempre na frente
2. Dentro da mesma prioridade: ordem de chegada
3. Vermelho: atendimento imediato (não entra em fila)
4. Laranja: ≤ 10 minutos
5. Amarelo: ≤ 60 minutos
6. Verde: ≤ 120 minutos
7. Azul: ≤ 240 minutos

TEMPO MÉDIO DE ATENDIMENTO:
- Vermelho: 20-40 minutos
- Laranja: 15-30 minutos
- Amarelo: 10-20 minutos
- Verde: 8-15 minutos
- Azul: 5-10 minutos

TAREFA: 
1. Determine posição ideal na fila
2. Estime tempo de espera real
3. Decida se médico deve ser notificado imediatamente

Retorne JSON:
{
  "queue_position": <número da posição>,
  "estimated_wait_time_minutes": <minutos>,
  "notify_physician_now": true|false,
  "risk_of_exceeding_deadline": true|false,
  "reasoning": "explicação da decisão"
}`;

    const response = await this.callLLM(prompt, this.systemPrompt);
    const decision = this.parseJSON(response);

    // Atualiza sistema de fila
    await this.updateQueueSystem(decision.queue_position, context.patient_id, outputs.final_priority_color);

    if (decision.notify_physician_now) {
      await this.notifyPhysician(context, outputs);
    }

    return {
      queue_position: decision.queue_position,
      estimated_wait_time: `${decision.estimated_wait_time_minutes}min`,
      physician_notified: decision.notify_physician_now,
      risk_exceeding_deadline: decision.risk_of_exceeding_deadline,
      queue_updated_at: new Date().toISOString(),
      reasoning: decision.reasoning,
    };
  }

  private async fetchCurrentQueue(): Promise<any[]> {
    // TODO: Buscar fila real do sistema
    // Mock data
    return [
      { position: 1, priority: 'vermelho', wait_time: 0, patient_id: 'P001' },
      { position: 2, priority: 'laranja', wait_time: 5, patient_id: 'P002' },
      { position: 3, priority: 'laranja', wait_time: 8, patient_id: 'P003' },
      { position: 4, priority: 'amarelo', wait_time: 15, patient_id: 'P004' },
      { position: 5, priority: 'amarelo', wait_time: 30, patient_id: 'P005' },
      { position: 6, priority: 'verde', wait_time: 45, patient_id: 'P006' },
    ];
  }

  private async updateQueueSystem(position: number, patientId: string, priority: string): Promise<void> {
    console.log(`[QUEUE] Inserting patient ${patientId} at position ${position} (${priority})`);
    // TODO: Atualizar sistema real de fila
  }

  private async notifyPhysician(context: TaskContext, outputs: Record<string, any>): Promise<void> {
    console.log(`[QUEUE] Notifying physician panel for patient ${context.patient_id} (${outputs.final_priority_color})`);
    // TODO: Notificação real (WebSocket/SSE)
  }
}
