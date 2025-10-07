# PIR Deadlines Executor

Cloudflare Worker que monitora **deadlines adaptativos** para o Protocolo Manchester SP usando **Workers AI**.

## Conceito

Deadlines são **janelas de tempo adaptativas** que:
- **Relaxam** sob alta carga (manter qualidade > velocidade)
- **Escalam** quando perdidos (notificam supervisão)
- **Adaptam-se** ao contexto clínico (prioridade, fluxo)
- **Nunca relaxam** para casos críticos (vermelho, fluxos prioritários)

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                 PIR-DEADLINES Worker                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │       Deadline Orchestrator (Workers AI)             │  │
│  │  - Monitora múltiplos deadlines simultaneamente      │  │
│  │  - Avalia carga e adapta janelas inteligentemente    │  │
│  │  - Dispara escalações quando necessário              │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │            Deadline Evaluators                        │ │
│  │                                                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐         │ │
│  │  │ Manchester       │  │ Priority Flow    │         │ │
│  │  │ Classification   │  │ Evaluator        │         │ │
│  │  │ (5 colors)       │  │ (never relax)    │         │ │
│  │  └──────────────────┘  └──────────────────┘         │ │
│  │                                                       │ │
│  │  ┌──────────────────┐                                │ │
│  │  │ Operational      │                                │ │
│  │  │ Evaluator        │                                │ │
│  │  │ (flexible)       │                                │ │
│  │  └──────────────────┘                                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 10 Deadlines Implementados

### Manchester Classification (5 colors)

1. **initial_assessment_red** - VERMELHO (Emergência)
   - **Target**: Imediato (PT0M)
   - **Adaptive**: NÃO (nunca relaxa)
   - **Escalation**: Médico + Diretor Técnico

2. **initial_assessment_orange** - LARANJA (Muito Urgente)
   - **Target**: 10 min (PT10M)
   - **Relaxes to**: 15 min sob alta carga (≥15 pacientes)
   - **Escalation**: Enfermeiro chefe + Médico

3. **initial_assessment_yellow** - AMARELO (Urgente)
   - **Target**: 1 hora (PT1H)
   - **Relaxes to**: 90 min sob alta carga (≥20 pacientes)
   - **Escalation**: Enfermeiro chefe

4. **initial_assessment_green** - VERDE (Pouco Urgente)
   - **Target**: 2 horas (PT2H)
   - **Relaxes to**: 3 horas sob alta carga (≥25 pacientes)
   - **Escalation**: Enfermeiro chefe

5. **initial_assessment_blue** - AZUL (Não Urgente)
   - **Target**: 4 horas (PT4H)
   - **Relaxes to**: 6 horas sob alta carga (≥30 pacientes)
   - **Escalation**: Enfermeiro chefe

### Priority Flows (5 critical pathways)

6. **chest_pain_door_to_ecg** - Dor Torácica
   - **Target**: ECG em ≤10 min
   - **Adaptive**: NÃO (nunca relaxa)
   - **Escalation**: Cardiologista + Diretor

7. **stroke_door_to_ct** - AVC (Tomografia)
   - **Target**: TC crânio em ≤25 min
   - **Adaptive**: NÃO
   - **Escalation**: Neurologista + Diretor

8. **stroke_door_to_needle** - AVC (Trombólise)
   - **Target**: Início trombólise em ≤60 min
   - **Adaptive**: NÃO
   - **Escalation**: Neurologista + Diretor

9. **sepsis_antibiotic_administration** - Sepse
   - **Target**: Antibiótico em ≤1 hora (bundle)
   - **Adaptive**: NÃO
   - **Escalation**: Intensivista + Diretor

10. **trauma_primary_survey** - Trauma
    - **Target**: Avaliação ATLS em ≤2 min
    - **Adaptive**: NÃO
    - **Escalation**: Cirurgião trauma + Diretor

## Workers AI Models

- **QWQ-32B** (`@cf/qwen/qwq-32b-preview`): Avaliação de carga e recomendações de adaptação

## API Endpoints

### POST `/api/deadlines/start`

Inicia monitoramento de deadlines para uma sessão.

**Request:**
```json
{
  "session_id": "session_123",
  "patient_id": "patient_456",
  "classification": "laranja",
  "priority_flow": "chest_pain",
  "current_queue_length": 18,
  "timestamp": "2025-10-07T14:32:10.123Z"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "session_123",
    "status": "active",
    "deadlines_tracked": [
      {
        "instance_id": "session_123_initial_assessment_orange",
        "deadline_id": "initial_assessment_orange",
        "session_id": "session_123",
        "status": "active",
        "priority": "critical",
        "started_at": "2025-10-07T14:32:10.123Z",
        "target_deadline": "2025-10-07T14:42:10.123Z",
        "time_elapsed_ms": 0,
        "is_overdue": false,
        "load_condition": "high",
        "escalation_triggered": false,
        "context": {
          "classification": "laranja",
          "priority_flow": "chest_pain"
        }
      },
      {
        "instance_id": "session_123_chest_pain_door_to_ecg",
        "deadline_id": "chest_pain_door_to_ecg",
        "status": "active",
        "priority": "critical",
        "started_at": "2025-10-07T14:32:10.123Z",
        "target_deadline": "2025-10-07T14:42:10.123Z",
        "adaptive": false
      }
    ],
    "deadlines_met": [],
    "deadlines_missed": [],
    "deadlines_escalated": [],
    "started_at": "2025-10-07T14:32:10.123Z"
  }
}
```

### POST `/api/deadlines/check`

Verifica status de todos os deadlines ativos.

**Request:**
```json
{
  "session_id": "session_123",
  "current_queue_length": 22,
  "timestamp": "2025-10-07T14:37:10.123Z"
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "instance_id": "session_123_initial_assessment_orange",
      "deadline_id": "initial_assessment_orange",
      "status": "relaxed",
      "time_remaining_ms": 480000,
      "time_elapsed_ms": 300000,
      "is_overdue": false,
      "urgency_level": "warning",
      "should_escalate": false,
      "should_relax": true,
      "load_condition": "high",
      "recommendation": {
        "action": "accept_delay",
        "reasoning": "Alta carga (22 pacientes). Caso laranja pode relaxar para 15min sem comprometer segurança. Priorizar vermelho e fluxos críticos.",
        "priority": "critical"
      }
    },
    {
      "instance_id": "session_123_chest_pain_door_to_ecg",
      "deadline_id": "chest_pain_door_to_ecg",
      "status": "active",
      "time_remaining_ms": 120000,
      "time_elapsed_ms": 300000,
      "is_overdue": false,
      "urgency_level": "warning",
      "should_escalate": false,
      "should_relax": false,
      "load_condition": "high",
      "recommendation": {
        "action": "expedite_process",
        "reasoning": "Fluxo prioritário de dor torácica. Restam 2min para ECG. NUNCA relaxar este deadline. Acelerar processo imediatamente.",
        "priority": "critical"
      }
    }
  ]
}
```

### POST `/api/deadlines/mark-met`

Marca deadline como cumprido.

**Request:**
```json
{
  "session_id": "session_123",
  "deadline_id": "chest_pain_door_to_ecg",
  "timestamp": "2025-10-07T14:40:10.123Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Deadline chest_pain_door_to_ecg marked as met"
}
```

### GET `/api/deadlines/session/:sessionId`

Obtém sessão completa de monitoramento.

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "session_123",
    "status": "active",
    "deadlines_tracked": [...],
    "deadlines_met": ["chest_pain_door_to_ecg"],
    "deadlines_missed": [],
    "deadlines_escalated": []
  }
}
```

### GET `/api/deadlines/summary/:sessionId`

Resumo estatístico da sessão.

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_deadlines": 2,
    "met": 1,
    "missed": 0,
    "escalated": 0,
    "active": 1,
    "on_time_percentage": 50.0
  }
}
```

### GET `/health`

Health check do serviço.

## Estrutura de Pastas

```
pir-deadlines/
├── src/
│   ├── index.ts                          # Worker entry point
│   ├── types/
│   │   └── deadlines.ts                  # Tipos e helpers
│   ├── evaluators/
│   │   ├── base-evaluator.ts             # Classes base abstratas
│   │   └── deadline-evaluators.ts        # 3 tipos de evaluators
│   └── orchestrator/
│       └── deadline-orchestrator.ts      # Orquestração de monitoramento
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Lógica de Adaptação

### Quando Relaxar Deadlines

**Manchester Classification** (adaptativos):
- **Laranja**: Relaxa para 15min se fila ≥15 pacientes
- **Amarelo**: Relaxa para 90min se fila ≥20 pacientes
- **Verde**: Relaxa para 3h se fila ≥25 pacientes
- **Azul**: Relaxa para 6h se fila ≥30 pacientes

**Critérios Workers AI**:
- Considera prioridade global (vermelho > laranja > amarelo)
- Nunca relaxa se há risco de deterioração
- Prefere manter qualidade a forçar velocidade
- Realoca recursos quando possível

### Quando NÃO Relaxar

**Nunca relaxam**:
- VERMELHO (emergência)
- Fluxos prioritários (dor torácica, AVC, sepse, trauma)
- Casos com sinais de deterioração clínica
- Deadlines já perdidos (escalam)

### Escalação

Quando deadline é perdido:
1. **Notifica** roles definidos (enfermeiro, médico, diretor)
2. **Executa** ações de escalação:
   - `alert_team`: Alerta equipe
   - `reallocate_resources`: Realocar recursos
   - `escalate_priority`: Aumentar prioridade na fila
3. **Registra** todas as ações para auditoria

## Deployment

```bash
cd workers/pir-deadlines
npm install
npx wrangler deploy
```

## Integração com PIR

Deadlines recebem:
- **classification**: Cor Manchester (vermelho/laranja/amarelo/verde/azul)
- **priority_flow**: Fluxo prioritário ativo (chest_pain/stroke/sepsis/trauma)
- **current_queue_length**: Tamanho atual da fila

E retornam:
- **Time remaining**: Tempo restante para deadline
- **Urgency level**: normal | warning | critical
- **Recommendations**: Ações sugeridas por Workers AI
- **Escalation triggers**: Notificações disparadas

## Próximos Workers

- **pir-rewards**: Sistema de scoring para aprendizado RRE
- **pir-evidence**: FHIR audit trail + LGPD compliance

## Licença

MIT
