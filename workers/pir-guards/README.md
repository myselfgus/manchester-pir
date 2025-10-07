# PIR Guards Executor

Cloudflare Worker que executa **guards preditivos** para o Protocolo Manchester SP usando **Workers AI**.

## Conceito

Guards são **barreiras de segurança preditivas** que:
- **SUGEREM** ações (não bloqueiam)
- Fornecem raciocínio transparente
- Permitem overrides com logging
- Detectam riscos ANTES de se tornarem problemas

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    PIR-GUARDS Worker                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Guard Orchestrator (Workers AI)             │  │
│  │  - Seleciona guards relevantes inteligentemente      │  │
│  │  - Executa guards em paralelo (rhizomatic)           │  │
│  │  - Agrega alertas por prioridade                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │                  Guard Executors                      │ │
│  │                                                       │ │
│  │  ┌─────────────────┐    ┌─────────────────┐         │ │
│  │  │ LLM Reasoning   │    │  Continuous     │         │ │
│  │  │ Guards (8)      │    │  Monitoring (2) │         │ │
│  │  │                 │    │                 │         │ │
│  │  │ QWQ-32B         │    │ State tracking  │         │ │
│  │  │ DeepSeek-R1     │    │ Trend analysis  │         │ │
│  │  └─────────────────┘    └─────────────────┘         │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 10 Guards Implementados

### 1. **sepsis_early_detection** (CONTINUOUS)
- **Detecta**: Sinais precoces de sepse (qSOFA ≥2, SIRS ≥2)
- **Inputs**: PA, FC, FR, Temp, Consciência
- **Action**: SUGGEST investigação de sepse
- **Modelo**: QWQ-32B (raciocínio clínico)

### 2. **stroke_time_window** (CONTINUOUS)
- **Detecta**: Janela terapêutica para trombólise (≤4.5h) e trombectomia (≤6h)
- **Inputs**: Início dos sintomas, queixa, consciência
- **Action**: ALERT com tempo restante
- **Modelo**: DeepSeek-R1 (cálculo de tempo crítico)

### 3. **cardiac_ischemia_alert** (PREDICTIVE)
- **Detecta**: Padrões de síndrome coronariana aguda
- **Inputs**: Dor torácica, PA, FC, idade, histórico
- **Action**: SUGGEST investigação de SCA
- **Modelo**: QWQ-32B (análise de risco)

### 4. **critical_hypoxemia** (CONTINUOUS)
- **Detecta**: Hipoxemia grave (SpO2 < 85%) e tendências
- **Inputs**: SpO2, FR, FC, consciência
- **Action**: ALERT imediato
- **Modelo**: QWQ-32B (monitoramento contínuo)

### 5. **hypovolemic_shock** (PREDICTIVE)
- **Detecta**: Choque hipovolêmico Classes III-IV
- **Inputs**: PA, FC, consciência, hemorragia
- **Action**: ALERT para reposição volêmica
- **Modelo**: DeepSeek-R1 (classificação de choque)

### 6. **allergy_conflict_check** (PREDICTIVE)
- **Detecta**: Conflitos entre alergias e medicações prescritas
- **Inputs**: Alergias documentadas, medicações prescritas
- **Action**: ALERT com alternativas seguras
- **Modelo**: QWQ-32B (verificação farmacológica)

### 7. **medication_interaction** (PREDICTIVE)
- **Detecta**: Interações medicamentosas graves/contraindicadas
- **Inputs**: Medicações em uso, medicações prescritas
- **Action**: SUGGEST alternativas ou ajustes de dose
- **Modelo**: DeepSeek-R1 (análise farmacocinética)

### 8. **pediatric_dose_safety** (PREDICTIVE)
- **Detecta**: Doses inadequadas em pacientes < 18 anos
- **Inputs**: Idade, peso, altura, medicações prescritas
- **Action**: ALERT com dose correta (mg/kg)
- **Modelo**: QWQ-32B (cálculo de dose pediátrica)

### 9. **geriatric_fragility_alert** (PREDICTIVE)
- **Detecta**: Fragilidade geriátrica e medicações Critérios de Beers
- **Inputs**: Idade ≥65, medicações, histórico
- **Action**: SUGGEST ajustes para idosos
- **Modelo**: QWQ-32B (avaliação geriátrica)

### 10. **pregnancy_contraindication** (PREDICTIVE)
- **Detecta**: Medicações/procedimentos Categoria X em gestantes
- **Inputs**: Gestação, trimestre, medicações prescritas
- **Action**: ALERT com alternativas seguras
- **Modelo**: DeepSeek-R1 (teratogenicidade)

## Workers AI Models

- **QWQ-32B** (`@cf/qwen/qwq-32b-preview`): Raciocínio clínico complexo
- **DeepSeek-R1** (`@cf/deepseek/deepseek-r1-distill-qwen-32b`): Análise crítica e cálculos

## API Endpoints

### POST `/api/guards/execute`

Executa guards para uma sessão (seleciona guards relevantes automaticamente).

**Request:**
```json
{
  "session_id": "session_123",
  "patient_id": "patient_456",
  "slot_state": {
    "chief_complaint": "dor torácica",
    "systolic_bp": 85,
    "diastolic_bp": 50,
    "heart_rate": 135,
    "respiratory_rate": 28,
    "temperature": 38.5,
    "oxygen_saturation": 88,
    "consciousness_level": "confuso",
    "age": 68,
    "gender": "male",
    "bleeding_present": false,
    "previous_medical_history": [
      { "condition": "HAS", "controlled": false },
      { "condition": "DM2", "controlled": true }
    ],
    "medications_in_use": [
      { "name": "Losartana", "dose": "50mg", "frequency": "1x/dia" }
    ],
    "allergy_history": []
  },
  "task_outputs": {
    "prescribed_medications": [
      { "name": "Dipirona", "dose": "1g", "route": "EV" }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "session_123",
    "status": "alerts_triggered",
    "guards_executed": [
      {
        "guard_id": "sepsis_early_detection",
        "status": "completed",
        "triggered": true,
        "execution_time_ms": 1250
      },
      {
        "guard_id": "critical_hypoxemia",
        "status": "completed",
        "triggered": true,
        "execution_time_ms": 980
      },
      {
        "guard_id": "hypovolemic_shock",
        "status": "completed",
        "triggered": true,
        "execution_time_ms": 1100
      }
    ],
    "guards_triggered": [
      "sepsis_early_detection",
      "critical_hypoxemia",
      "hypovolemic_shock"
    ],
    "results": {
      "sepsis_early_detection": {
        "guard_id": "sepsis_early_detection",
        "status": "completed",
        "triggered": true,
        "action": {
          "type": "suggest",
          "message": "ATENÇÃO: Paciente apresenta qSOFA ≥2 (PA < 100 + FR ≥ 22 + alteração mental). SUGESTÃO: Investigar sepse urgentemente com lactato, hemoculturas e iniciar bundle de 1 hora.",
          "reasoning": "qSOFA Score: 3/3 (PAS 85 mmHg, FR 28 irpm, confusão mental). SIRS Score: 3/4 (Temp 38.5°C, FC 135 bpm, FR 28 irpm). Alto risco de sepse grave.",
          "priority": "critical",
          "override_allowed": true
        },
        "execution_time_ms": 1250,
        "model_used": "@cf/qwen/qwq-32b-preview"
      },
      "critical_hypoxemia": {
        "guard_id": "critical_hypoxemia",
        "status": "completed",
        "triggered": true,
        "action": {
          "type": "alert",
          "message": "ALERTA CRÍTICO: SpO2 88% - Hipoxemia grave. Iniciar O2 suplementar imediatamente e reavaliar resposta.",
          "reasoning": "SpO2 < 90% com sinais de desconforto respiratório (FR 28 irpm). Tendência desconhecida (primeira medição). Contexto: possível quadro infeccioso (febre).",
          "priority": "critical",
          "override_allowed": false
        },
        "execution_time_ms": 980,
        "model_used": "@cf/qwen/qwq-32b-preview"
      },
      "hypovolemic_shock": {
        "guard_id": "hypovolemic_shock",
        "status": "completed",
        "triggered": true,
        "action": {
          "type": "alert",
          "message": "ALERTA: Sinais de Choque Classe III (PAS < 90 + FC > 120). Indicar acesso venoso calibroso e reposição volêmica.",
          "reasoning": "PAS 85 mmHg + FC 135 bpm + alteração de consciência = Choque Classe III (30-40% perda volêmica). Sem hemorragia evidente, considerar choque distributivo (sepse).",
          "priority": "critical",
          "override_allowed": false
        },
        "execution_time_ms": 1100,
        "model_used": "@cf/deepseek/deepseek-r1-distill-qwen-32b"
      }
    },
    "started_at": "2025-10-07T14:32:10.123Z",
    "completed_at": "2025-10-07T14:32:13.453Z",
    "total_execution_time_ms": 3330
  }
}
```

### GET `/api/guards/status/:sessionId`

Retorna status da execução de guards.

**Response:**
```json
{
  "success": true,
  "session": {
    "session_id": "session_123",
    "status": "alerts_triggered",
    "guards_executed": [...],
    "guards_triggered": [...]
  }
}
```

### GET `/api/guards/alerts/:sessionId`

Retorna resumo de alertas disparados (ordenados por prioridade).

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_alerts": 3,
    "critical": 3,
    "high": 0,
    "medium": 0,
    "alerts": [
      {
        "guard_id": "sepsis_early_detection",
        "priority": "critical",
        "message": "ATENÇÃO: Paciente apresenta qSOFA ≥2...",
        "override_allowed": true
      },
      {
        "guard_id": "critical_hypoxemia",
        "priority": "critical",
        "message": "ALERTA CRÍTICO: SpO2 88%...",
        "override_allowed": false
      },
      {
        "guard_id": "hypovolemic_shock",
        "priority": "critical",
        "message": "ALERTA: Sinais de Choque Classe III...",
        "override_allowed": false
      }
    ]
  }
}
```

### GET `/health`

Health check do serviço.

**Response:**
```json
{
  "status": "healthy",
  "service": "pir-guards-executor",
  "timestamp": "2025-10-07T14:32:10.123Z",
  "guards_available": 10
}
```

## Estrutura de Pastas

```
pir-guards/
├── src/
│   ├── index.ts                          # Worker entry point (API REST)
│   ├── types/
│   │   └── guards.ts                     # Tipos de guards e contexto
│   ├── executors/
│   │   ├── base-guard.ts                 # Classes base abstratas
│   │   └── llm-guards.ts                 # 10 guards usando Workers AI
│   └── orchestrator/
│       └── guard-orchestrator.ts         # Orquestração paralela
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Deployment

### 1. Instalar dependências

```bash
cd workers/pir-guards
npm install
```

### 2. Configurar Cloudflare

Atualize `wrangler.toml` com seu account_id:

```toml
name = "pir-guards-executor"
main = "src/index.ts"
compatibility_date = "2025-01-01"
account_id = "seu_account_id_aqui"

[ai]
binding = "AI"
```

### 3. Deploy

```bash
npx wrangler deploy
```

### 4. Testar

```bash
# Health check
curl https://pir-guards-executor.seu-usuario.workers.dev/health

# Executar guards
curl -X POST https://pir-guards-executor.seu-usuario.workers.dev/api/guards/execute \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test_123",
    "patient_id": "patient_456",
    "slot_state": {
      "chief_complaint": "dor torácica",
      "systolic_bp": 85,
      "heart_rate": 135,
      "oxygen_saturation": 88,
      "age": 68
    }
  }'
```

## Integração com PIR

Os guards recebem:
- **slot_state**: Estado dos 19 slots extraídos por `pir-slots`
- **task_outputs**: Resultados das 12 tasks executadas por `pir-tasks`

E retornam:
- **Alertas críticos**: Para ROE (Runtime Orchestrator Engine)
- **Sugestões**: Para interface do profissional de saúde
- **Raciocínio transparente**: Para auditoria e aprendizado

## Características Importantes

### 1. Seleção Inteligente de Guards
O orchestrator usa Workers AI (QWQ-32B) para selecionar APENAS guards relevantes:
- **Sepse**: Só roda se sinais vitais alterados
- **AVC**: Só roda se suspeita neurológica
- **Pediatria**: Só roda se idade < 18
- **Gestação**: Só roda se sexo feminino + idade fértil

### 2. Execução Paralela (Rhizomatic)
Guards executam simultaneamente para minimizar latência:
- 10 guards em ~3-5 segundos (vs 30-50 segundos sequencial)
- Cada guard é independente
- Falha de 1 guard não afeta outros

### 3. Raciocínio Transparente
Todos os guards fornecem:
- **Reasoning**: Explicação clínica da decisão
- **Priority**: critical | high | medium
- **Override**: Permite/bloqueia override
- **Model Used**: Qual Workers AI foi usado

### 4. Continuous Monitoring
Guards marcados como `continuous` mantêm histórico de estado:
- Detectam tendências (SpO2 caindo)
- Executam em intervalos (sepse a cada 5 min)
- Comparam estado atual vs anterior

## Diferenças vs Tasks

| Aspecto | TASKS (pir-tasks) | GUARDS (pir-guards) |
|---------|-------------------|---------------------|
| **Propósito** | Executar ações (classificar, ativar fluxos) | Prevenir erros antes que ocorram |
| **Ação** | DO (faça algo) | SUGGEST (sugira cuidado) |
| **Bloqueio** | Não bloqueiam | Alguns bloqueiam (dose pediátrica) |
| **Timing** | Executam 1x por sessão | Continuous rodam repetidamente |
| **Output** | Dados estruturados | Alertas + reasoning |

## Próximos Workers

- **pir-deadlines**: Janelas adaptativas de tempo
- **pir-rewards**: Scoring para RRE learning
- **pir-evidence**: FHIR audit trail + LGPD

## Licença

MIT
