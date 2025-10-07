# PIR Rewards Executor

Cloudflare Worker que calcula **rewards/scores** para sessões de triagem usando **Workers AI**. Alimenta o **RRE (Rhizomatic Reasoning Engine)** para aprendizado contínuo do sistema.

## Conceito

Rewards são **scores multidimensionais** que avaliam o desempenho de cada sessão de triagem em 5 categorias:

1. **Classification Accuracy** (35%) - Acurácia da classificação Manchester
2. **Deadline Adherence** (25%) - Cumprimento de prazos
3. **Patient Safety** (30%) - Segurança do paciente
4. **Resource Efficiency** (5%) - Eficiência de recursos
5. **Pattern Detection** (5%) - Detecção de padrões críticos

O score geral é uma **soma ponderada** (-1 a +1) que o RRE usa para aprender quais ações levam a melhores resultados.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                  PIR-REWARDS Worker                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        Reward Orchestrator (Workers AI)              │  │
│  │  - Coordena cálculo de 5 categorias                  │  │
│  │  - Agrega scores com pesos definidos                 │  │
│  │  - Extrai learning signals para RRE                  │  │
│  │  - Anonimiza features (LGPD compliance)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │             Reward Calculators (5)                    │ │
│  │                                                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐         │ │
│  │  │ Classification   │  │ Deadline         │         │ │
│  │  │ Accuracy (35%)   │  │ Adherence (25%)  │         │ │
│  │  └──────────────────┘  └──────────────────┘         │ │
│  │                                                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐         │ │
│  │  │ Patient Safety   │  │ Resource         │         │ │
│  │  │ (30%)            │  │ Efficiency (5%)  │         │ │
│  │  └──────────────────┘  └──────────────────┘         │ │
│  │                                                       │ │
│  │  ┌──────────────────┐                                │ │
│  │  │ Pattern          │                                │ │
│  │  │ Detection (5%)   │                                │ │
│  │  └──────────────────┘                                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────────┐
         │  RRE (Rhizomatic Reasoning     │
         │  Engine) - Aprendizado         │
         │  - Reforça ações de alto score │
         │  - Evita ações de baixo score  │
         │  - Detecta novos padrões       │
         └────────────────────────────────┘
```

## 5 Categorias de Reward

### 1. Classification Accuracy (35% do score total)

Avalia se a classificação de prioridade Manchester foi **correta** baseado no desfecho clínico.

**Indicadores Positivos:**
- Classificação correta confirmada por desfecho
- Cor Manchester apropriada para gravidade
- Fluxograma correto selecionado
- Reclassificação adequada quando necessária

**Indicadores Negativos:**
- Subclassificação (classificou mais baixo que deveria)
- Sobreclassificação (classificou mais alto que necessário)
- Fluxograma incorreto
- Falha em reclassificar deterioração

**Score:**
- `+1.0`: Classificação perfeita
- `+0.5`: Classificação apropriada com pequenas divergências
- `0.0`: Classificação neutra
- `-0.5`: Classificação subótima
- `-1.0`: Classificação incorreta com risco à segurança

### 2. Deadline Adherence (25% do score total)

Avalia o **cumprimento de prazos** de atendimento (cores Manchester + fluxos prioritários).

**Indicadores Positivos:**
- Todos deadlines cumpridos
- Deadlines críticos respeitados
- Tempo de triagem otimizado
- Fluxos prioritários dentro da janela terapêutica

**Indicadores Negativos:**
- Deadlines críticos perdidos
- Atrasos em fluxos prioritários (dor torácica, AVC, sepse)
- Tempo de triagem excessivo
- Fila de espera prolongada

**Score:**
- `+1.0`: Todos deadlines cumpridos
- `+0.5`: Maioria cumprida, atrasos justificados por alta carga
- `0.0`: Metade cumprida
- `-0.5`: Maioria perdida, mas sem risco ao paciente
- `-1.0`: Deadlines críticos perdidos, risco à segurança

### 3. Patient Safety (30% do score total)

Avalia a **segurança do paciente** baseado em eventos adversos, guards e near-misses.

**Indicadores Positivos:**
- Nenhum evento adverso
- Guards detectaram riscos precocemente
- Near-misses identificados e prevenidos
- Overrides de guards justificados e documentados
- Desfecho clínico positivo

**Indicadores Negativos:**
- Eventos adversos ocorreram
- Guards não dispararam quando deveriam
- Overrides de guards inadequados
- Near-misses não detectados
- Deterioração clínica não identificada

**Score:**
- `+1.0`: Nenhum evento adverso, guards perfeitos
- `+0.5`: Sem eventos, near-misses detectados e prevenidos
- `0.0`: Near-misses sem consequências
- `-0.5`: Eventos adversos leves, overrides questionáveis
- `-1.0`: Eventos adversos graves, falhas de segurança

### 4. Resource Efficiency (5% do score total)

Avalia a **eficiência no uso de recursos** (exames, medicações, especialistas).

**Indicadores Positivos:**
- Exames solicitados apropriados
- Medicações prescritas adequadas
- Consultas a especialistas necessárias
- Sem desperdício de recursos
- Tempo de triagem otimizado

**Indicadores Negativos:**
- Exames desnecessários solicitados
- Medicações inapropriadas
- Consultas desnecessárias
- Desperdício de recursos
- Tempo de triagem excessivo

**Score:**
- `+1.0`: Recursos usados de forma ótima
- `+0.5`: Uso apropriado com pequenas ineficiências
- `0.0`: Uso médio de recursos
- `-0.5`: Uso excessivo sem justificativa clínica
- `-1.0`: Desperdício grave ou falta crítica

### 5. Pattern Detection (5% do score total)

Avalia a **detecção de padrões críticos** (sepse, AVC, IAM, trauma).

**Indicadores Positivos:**
- Sepse detectada precocemente
- AVC identificado dentro da janela
- IAM reconhecido rapidamente
- Trauma grave identificado
- Fluxos prioritários ativados corretamente

**Indicadores Negativos:**
- Sepse não detectada
- AVC perdido fora da janela terapêutica
- IAM não reconhecido
- Trauma grave subestimado
- Fluxos prioritários não ativados

**Score:**
- `+1.0`: Todos padrões críticos detectados precocemente
- `+0.5`: Maioria detectada, pequenos atrasos aceitáveis
- `0.0`: Nenhum padrão crítico no caso
- `-0.5`: Padrões detectados tardiamente
- `-1.0`: Padrões críticos perdidos, risco ao paciente

## Workers AI Models

- **QWQ-32B** (`@cf/qwen/qwq-32b-preview`): Avaliação nuançada de outcomes clínicos

## API Endpoints

### POST `/api/rewards/calculate`

Calcula rewards para uma sessão de triagem completada.

**Request:**
```json
{
  "session_id": "session_123",
  "patient_id": "patient_456",
  "timestamp": "2025-10-07T15:30:00.000Z",

  "initial_classification": "laranja",
  "initial_flowchart": "dor_toracica",
  "priority_flow_activated": "chest_pain",

  "slots_extracted": {
    "chief_complaint": "dor torácica",
    "pain_score": 8,
    "systolic_bp": 145,
    "heart_rate": 95
  },

  "tasks_executed": [
    "initial_triage_assessment",
    "flowchart_selection",
    "priority_classification",
    "activate_priority_flow_chest_pain"
  ],

  "guards_triggered": [
    "cardiac_ischemia_alert"
  ],

  "deadlines_met": [
    "initial_assessment_orange",
    "chest_pain_door_to_ecg"
  ],

  "deadlines_missed": [],

  "final_classification": "vermelho",
  "actual_diagnosis": "Infarto Agudo do Miocárdio",
  "treatment_outcome": "improved",
  "patient_satisfaction": 5,
  "clinical_accuracy": true,

  "total_triage_time_ms": 480000,
  "time_to_physician_ms": 600000,

  "resources_used": {
    "exams_requested": ["ECG", "Troponina"],
    "medications_prescribed": ["AAS 300mg", "Clopidogrel 300mg"],
    "specialists_consulted": ["cardiologista"]
  },

  "adverse_events": [],
  "near_misses": [],
  "guard_overrides": []
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "session_id": "session_123",
    "timestamp": "2025-10-07T15:30:00.000Z",
    "overall_score": 0.87,
    "normalized_score": 93.5,
    "outcome_type": "positive",

    "category_scores": [
      {
        "category": "classification_accuracy",
        "weight": 0.35,
        "raw_score": 1.0,
        "weighted_score": 0.35,
        "reasoning": "Classificação inicial laranja foi apropriada para dor torácica. Reclassificação para vermelho após ECG mostrou IAM foi correta. Fluxo prioritário de dor torácica ativado adequadamente. Diagnóstico final confirmou acurácia da triagem.",
        "positive_factors": [
          "Classificação inicial apropriada",
          "Reclassificação correta após ECG",
          "Fluxo prioritário ativado",
          "Diagnóstico confirmou acurácia"
        ],
        "negative_factors": []
      },
      {
        "category": "deadline_adherence",
        "weight": 0.25,
        "raw_score": 1.0,
        "weighted_score": 0.25,
        "reasoning": "Todos deadlines cumpridos: avaliação inicial laranja em 8min e ECG em 9min (meta: 10min). Excelente aderência aos prazos críticos de dor torácica.",
        "positive_factors": [
          "Deadline laranja cumprido",
          "ECG dentro de 10min",
          "Tempo total otimizado"
        ],
        "negative_factors": []
      },
      {
        "category": "patient_safety",
        "weight": 0.30,
        "raw_score": 1.0,
        "weighted_score": 0.30,
        "reasoning": "Nenhum evento adverso. Guard de isquemia cardíaca disparou corretamente, sugerindo investigação de SCA. Desfecho positivo (improved). Segurança perfeita.",
        "positive_factors": [
          "Nenhum evento adverso",
          "Guard de isquemia detectou precocemente",
          "Desfecho positivo",
          "Sem overrides inadequados"
        ],
        "negative_factors": []
      },
      {
        "category": "resource_efficiency",
        "weight": 0.05,
        "raw_score": 0.9,
        "weighted_score": 0.045,
        "reasoning": "Recursos usados apropriadamente: ECG e troponina são exames essenciais para dor torácica. AAS e Clopidogrel são medicações padrão para IAM. Consulta ao cardiologista adequada. Pequena ineficiência no tempo até médico (10min).",
        "positive_factors": [
          "Exames apropriados",
          "Medicações padrão-ouro",
          "Consulta necessária"
        ],
        "negative_factors": [
          "Tempo até médico levemente acima do ideal"
        ]
      },
      {
        "category": "pattern_detection",
        "weight": 0.05,
        "raw_score": 1.0,
        "weighted_score": 0.05,
        "reasoning": "Padrão de isquemia cardíaca detectado corretamente pelo guard. Fluxo prioritário de dor torácica ativado. IAM identificado precocemente. Detecção perfeita.",
        "positive_factors": [
          "Isquemia detectada",
          "Fluxo prioritário ativado",
          "IAM identificado precocemente"
        ],
        "negative_factors": []
      }
    ],

    "learning_signals": {
      "classification_feedback": {
        "predicted": "laranja",
        "actual": "vermelho",
        "correct": true
      },
      "pattern_matches": [
        "cardiac_ischemia_alert",
        "chest_pain_protocol"
      ],
      "pattern_misses": [],
      "optimal_actions": [
        "correct_classification",
        "deadline_adherence",
        "guard_activation",
        "priority_flow_chest_pain"
      ],
      "suboptimal_actions": []
    },

    "aggregate_to_rre": true,

    "anonymized_features": {
      "classification": "laranja",
      "flowchart": "dor_toracica",
      "priority_flow": "chest_pain",
      "num_guards_triggered": 1,
      "num_tasks_executed": 4,
      "num_deadlines_met": 2,
      "num_deadlines_missed": 0,
      "triage_time_ms": 480000,
      "time_to_physician_ms": 600000,
      "treatment_outcome": "improved",
      "clinical_accuracy": true,
      "had_adverse_events": false,
      "had_near_misses": false,
      "num_guard_overrides": 0,
      "patient_satisfaction": 5
    },

    "execution_time_ms": 2340,
    "model_used": "@cf/qwen/qwq-32b-preview"
  }
}
```

### GET `/api/rewards/result/:sessionId`

Obtém resultado de reward previamente calculado.

**Response:**
```json
{
  "success": true,
  "result": {
    "session_id": "session_123",
    "overall_score": 0.87,
    "normalized_score": 93.5,
    "outcome_type": "positive"
  }
}
```

### POST `/api/rewards/metrics`

Calcula métricas agregadas sobre múltiplas sessões (para dashboard).

**Request:**
```json
{
  "session_ids": ["session_123", "session_124", "session_125"],
  "time_period": {
    "start": "2025-10-01T00:00:00.000Z",
    "end": "2025-10-07T23:59:59.999Z"
  }
}
```

**Response:**
```json
{
  "success": true,
  "metrics": {
    "time_period": {
      "start": "2025-10-01T00:00:00.000Z",
      "end": "2025-10-07T23:59:59.999Z"
    },
    "total_sessions": 150,

    "average_scores": {
      "overall": 0.72,
      "by_category": {
        "classification_accuracy": 0.85,
        "deadline_adherence": 0.68,
        "patient_safety": 0.92,
        "resource_efficiency": 0.55,
        "pattern_detection": 0.78
      }
    },

    "classification_accuracy": {
      "total": 150,
      "correct": 132,
      "percentage": 88.0,
      "by_color": {
        "vermelho": { "correct": 25, "total": 25, "percentage": 100.0 },
        "laranja": { "correct": 38, "total": 42, "percentage": 90.5 },
        "amarelo": { "correct": 45, "total": 53, "percentage": 84.9 },
        "verde": { "correct": 18, "total": 22, "percentage": 81.8 },
        "azul": { "correct": 6, "total": 8, "percentage": 75.0 }
      }
    },

    "deadline_performance": {
      "total_deadlines": 450,
      "met": 382,
      "missed": 68,
      "percentage_met": 84.9
    },

    "patient_safety": {
      "adverse_events": 3,
      "near_misses": 12,
      "guard_overrides_justified": 8,
      "guard_overrides_errors": 2
    },

    "resource_efficiency": {
      "average_triage_time_ms": 540000,
      "average_exams_per_patient": 2.3,
      "average_medications_per_patient": 1.8
    },

    "patterns_detected": {
      "sepsis_early_detection": 15,
      "stroke_recognition": 8,
      "cardiac_ischemia": 23,
      "other": {}
    }
  }
}
```

### GET `/health`

Health check do serviço.

## Estrutura de Pastas

```
pir-rewards/
├── src/
│   ├── index.ts                          # Worker entry point
│   ├── types/
│   │   └── rewards.ts                    # Tipos de rewards e métricas
│   ├── calculators/
│   │   ├── base-calculator.ts            # Classes base abstratas
│   │   └── reward-calculators.ts         # 5 calculators implementados
│   └── orchestrator/
│       └── reward-orchestrator.ts        # Orquestração e agregação
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Integração com RRE

O sistema de rewards alimenta o **RRE (Rhizomatic Reasoning Engine)** com:

### Learning Signals

```typescript
{
  classification_feedback: {
    predicted: "laranja",
    actual: "vermelho",
    correct: true
  },
  pattern_matches: ["cardiac_ischemia_alert"],
  pattern_misses: [],
  optimal_actions: ["correct_classification", "guard_activation"],
  suboptimal_actions: []
}
```

### Anonymized Features (LGPD Compliance)

```typescript
{
  classification: "laranja",
  priority_flow: "chest_pain",
  num_guards_triggered: 1,
  clinical_accuracy: true,
  // NO PHI: sem patient_id, sem dados pessoais
}
```

### Aggregation Criteria

Sessions são enviadas ao RRE se:
- **Outcome positivo** (score > 0.3) - Aprender com sucesso
- **Outcome negativo** (score < -0.3) - Aprender com erros
- **Fluxo prioritário ativado** - Sempre aprender de casos críticos
- **Guards disparados** - Padrões interessantes detectados

## Deployment

```bash
cd workers/pir-rewards
npm install
npx wrangler deploy
```

## Cálculo do Score

### Fórmula

```
Overall Score = Σ (category_raw_score × category_weight)

Onde:
- category_raw_score ∈ [-1, 1]
- Σ category_weight = 1.0

Normalized Score = ((Overall Score + 1) / 2) × 100
```

### Exemplo

```
Classification Accuracy: 1.0 × 0.35 = 0.35
Deadline Adherence:      1.0 × 0.25 = 0.25
Patient Safety:          1.0 × 0.30 = 0.30
Resource Efficiency:     0.9 × 0.05 = 0.045
Pattern Detection:       1.0 × 0.05 = 0.05

Overall Score = 0.995 ≈ 1.0
Normalized Score = ((1.0 + 1) / 2) × 100 = 100
```

## Outcome Types

- **Positive** (score ≥ 0.3): Sessão bem-sucedida, reforçar ações
- **Neutral** (-0.3 < score < 0.3): Sessão mediana, sem aprendizado forte
- **Negative** (score ≤ -0.3): Sessão com problemas, evitar ações

## Licença

MIT
