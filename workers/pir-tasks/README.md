# PIR Tasks Executor - Manchester SP

**Automação AI-Native de Processos de Triagem** usando Cloudflare Workers AI

Este worker executa as **12 tasks** do Protocolo Manchester SP (Portaria SMS 82/2024), automatizando decisões operacionais de triagem usando LLMs especializados.

---

## 🎯 O que são Tasks?

Tasks são **ações executáveis** que processam os dados clínicos extraídos pelos **slots** e tomam **decisões automatizadas**:

- Selecionar fluxograma Manchester apropriado
- Aplicar discriminadores gerais e específicos
- Classificar prioridade final (vermelho/laranja/amarelo/verde/azul)
- Ativar protocolos prioritários (dor torácica, AVC, sepse, trauma)
- Gerenciar fila de atendimento
- Registrar classificação em prontuário

---

## 🧬 Arquitetura Rizomática

As 12 tasks executam em **paralelo máximo** (não-hierárquico):

```
                    ┌─────────────────────┐
                    │   Slot State        │
                    │   (19 slots do      │
                    │    pir-slots)       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Workers AI         │
                    │  (QWQ Reasoning)    │
                    │  Planeja Execução   │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │          Orchestrator Rizomático            │
        │        (Execução em Ondas Paralelas)        │
        └──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬─┘
           │   │   │   │   │   │   │   │   │   │   │
        ┌──▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐┌─▼┐
        │T1 ││T2││T3││T4││T5││T6││T7││T8││T9││10││11││12│
        └───┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘
                    12 Tasks Executando Simultaneamente
```

---

## 📋 As 12 Tasks Implementadas

### **Tasks com Workers AI (LLM Reasoning)**

#### **1. Initial Triage Assessment**
- **LLM:** `@cf/qwen/qwq-32b-preview` (Reasoning)
- **Função:** Interpreta queixa + sinais vitais → sugere discriminadores + fluxograma
- **Input:** `chief_complaint`, `temperature`, `heart_rate`, `blood_pressure`, `oxygen_saturation`, `consciousness_level`
- **Output:** `initial_discriminators`, `suggested_flowchart`

#### **2. Flowchart Selection**
- **LLM:** `@cf/deepseek/deepseek-r1-distill-qwen-32b` (Reasoning)
- **Função:** Decide qual dos 52 fluxogramas Manchester aplicar
- **Input:** `chief_complaint`, `initial_discriminators`
- **Output:** `selected_flowchart`, `reasoning`

#### **3. Apply General Discriminators**
- **LLM:** `@cf/qwen/qwq-32b-preview`
- **Função:** Identifica discriminadores gerais (risco de morte, dor, hemorragia, etc)
- **Input:** `consciousness_level`, `pain_score`, `bleeding_present`, `bleeding_severity`, `temperature`, `oxygen_saturation`
- **Output:** `general_discriminator_score`, `highest_priority_discriminator`

#### **4. Apply Specific Discriminators**
- **LLM:** `@cf/deepseek/deepseek-r1-distill-qwen-32b`
- **Função:** Aplica discriminadores específicos do fluxograma selecionado
- **Input:** `selected_flowchart`, `all_collected_slots`
- **Output:** `specific_discriminator_matches`, `flowchart_priority`

#### **5. Priority Classification**
- **LLM:** `@cf/qwen/qwq-32b-preview`
- **Função:** Determina prioridade final (🔴 vermelho / 🟠 laranja / 🟡 amarelo / 🟢 verde / 🔵 azul)
- **Input:** `general_discriminator_score`, `specific_discriminator_matches`
- **Output:** `final_priority_color`, `final_priority_time`, `classification_reasoning`

#### **8. Activate Priority Flow - Chest Pain**
- **LLM:** `@cf/deepseek/deepseek-r1-distill-qwen-32b`
- **Função:** Decide se ativa protocolo dor torácica (ECG 10min, troponina, cardiologia)
- **Condicional:** `selected_flowchart == 'dor_toracica' AND final_priority_color IN ['vermelho', 'laranja']`
- **Output:** `ecg_scheduled`, `cardiology_alerted`, `troponin_ordered`

#### **9. Activate Priority Flow - Stroke**
- **LLM:** `@cf/deepseek/deepseek-r1-distill-qwen-32b`
- **Função:** Ativa protocolo AVC (janela terapêutica 4.5h para trombólise)
- **Condicional:** `selected_flowchart == 'avc' AND neurological_deficit.present == true`
- **Output:** `stroke_protocol_activated`, `ct_scheduled`, `neurology_alerted`, `thrombolysis_eligible`

#### **10. Activate Priority Flow - Sepsis**
- **LLM:** `@cf/qwen/qwq-32b-preview`
- **Função:** Ativa protocolo sepse (bundle 1 hora)
- **Condicional:** `sepsis_criteria.qSOFA_score >= 2 AND sepsis_criteria.infection_suspected == true`
- **Output:** `sepsis_protocol_activated`, `bundle_1h_initiated`, `intensive_care_alerted`

#### **11. Activate Priority Flow - Trauma**
- **LLM:** `@cf/deepseek/deepseek-r1-distill-qwen-32b`
- **Função:** Ativa protocolo trauma ATLS
- **Condicional:** `selected_flowchart == 'trauma' AND final_priority_color IN ['vermelho', 'laranja']`
- **Output:** `trauma_protocol_activated`, `trauma_team_alerted`, `surgery_consulted`

#### **12. Queue Management**
- **LLM:** `@cf/qwen/qwq-32b-preview`
- **Função:** Decide posição na fila e tempo estimado de espera
- **Input:** `patient_id`, `final_priority_color`, `final_priority_time`, `arrival_time`
- **Output:** `queue_position`, `estimated_wait_time`, `physician_notified`

### **Tasks Operacionais (Sem LLM)**

#### **6. Assign Wristband**
- **Tipo:** Local inference (regra simples)
- **Função:** Mapeia cor → instrução de pulseira
- **Output:** `wristband_instruction`, `patient_identification`

#### **7. Record Classification**
- **Tipo:** API Call
- **Função:** POST para sistema de prontuário eletrônico
- **Endpoint:** `/api/medical-records/triage`
- **Output:** `record_id`, `confirmation`

---

## 🚀 API Endpoints

### **POST /api/tasks/execute**
Executa todas as 12 tasks em paralelo rizomático

**Request:**
```json
{
  "session_id": "uuid-v4",
  "slot_state": {
    "chief_complaint": "dor no peito há 2 horas",
    "temperature": 37.5,
    "heart_rate": 95,
    "blood_pressure": { "systolic": 140, "diastolic": 90 },
    "oxygen_saturation": 98,
    "consciousness_level": "alert",
    "pain_score": 8,
    "chest_pain_characteristics": {
      "precordial": true,
      "associated_sweating": true
    }
    // ... todos os 19 slots
  },
  "patient_id": "P12345",
  "arrival_time": "2025-10-07T14:30:00Z",
  "nurse_identifier": "N789"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "uuid",
    "status": "completed",
    "task_outputs": {
      "final_priority_color": "laranja",
      "final_priority_time": "10min",
      "selected_flowchart": "dor_toracica",
      "ecg_scheduled": true,
      "queue_position": 2
    }
  },
  "execution_summary": {
    "total_tasks": 12,
    "completed": 10,
    "failed": 0,
    "skipped": 2
  }
}
```

### **GET /api/tasks/status/:sessionId**
Obtém status de execução em tempo real

### **GET /api/tasks/results/:sessionId**
Obtém resultados consolidados finais

---

## 🛠️ Tecnologia Stack

- **Runtime:** Cloudflare Workers (Edge Computing)
- **AI Models:** Cloudflare Workers AI (Outubro 2025)
  - `@cf/qwen/qwq-32b-preview` - Reasoning especializado
  - `@cf/deepseek/deepseek-r1-distill-qwen-32b` - Reasoning avançado (supera GPT-4o)
  - `@cf/meta/llama-4-scout-17b-16e-instruct` - Multimodal MoE
- **Language:** TypeScript (strict mode)
- **Architecture:** Rizomática não-hierárquica

---

## 📊 Performance

- **Latência Típica:** ~2-5 segundos (todas as 12 tasks juntas)
- **Execução:** Edge computing (baixa latência)
- **Paralelismo:** Máximo (tasks independentes simultâneas)

---

## 🚀 Deploy

```bash
cd workers/pir-tasks

# Instalar dependências
npm install

# Desenvolvimento local
npm run dev

# Deploy para Cloudflare
npm run deploy
```

---

## 📁 Estrutura do Código

```
pir-tasks/
├── src/
│   ├── index.ts                    # Worker entry point
│   ├── types/
│   │   └── tasks.ts                # Interfaces TypeScript
│   ├── executors/
│   │   ├── base-executor.ts        # Classes base
│   │   ├── llm-tasks.ts            # Tasks 1-5, 8-12 (Workers AI)
│   │   └── operational-tasks.ts    # Tasks 6-7 (sem LLM)
│   └── orchestrator/
│       └── task-orchestrator.ts    # Orquestrador rizomático
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

---

## 🔗 Integração com pir-slots

```
Fluxo Completo:

1. Paciente chega na triagem
   ↓
2. PIR-SLOTS extrai 19 slots (áudio → Whisper → 19 LLMs paralelos)
   ↓
3. PIR-TASKS recebe slot_state
   ↓
4. Workers AI planeja execução ótima
   ↓
5. 12 tasks executam em paralelo rizomático
   ↓
6. Classificação final + protocolos ativados + fila atualizada
```

---

## 📝 Licença

MIT License - Voither Team

---

## 🤝 Conformidade Regulatória

- ✅ **Portaria SMS nº 82/2024** (Protocolo Manchester SP)
- ✅ **LGPD** (dados do paciente)
- ✅ **Auditoria completa** via FHIR bundles
- ✅ **AI-native** (automação máxima de processos)
