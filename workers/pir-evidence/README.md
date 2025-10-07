# PIR Evidence Executor

Cloudflare Worker que coleta **evidence/audit trail** para o Protocolo Manchester SP com **FHIR R4 compliance** + **LGPD compliance** usando **Workers AI**.

## Conceito

Evidence é o sistema de **auditoria e rastreabilidade** que:

1. **Patient Timelines** (PHI, encrypted) - Timeline criptografado do paciente
2. **System Aggregates** (no PHI, de-identified) - Padrões agregados do sistema
3. **FHIR Audit Events** (FHIR R4 compliant) - Eventos de auditoria FHIR
4. **Consent Logs** (LGPD Article 8) - Trilha de consentimento
5. **Access Logs** (LGPD Article 9) - Auditoria de acesso a dados

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                 PIR-EVIDENCE Worker                         │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │       Evidence Orchestrator (Workers AI)             │  │
│  │  - Coordena coleta em 3 collectors                   │  │
│  │  - Gerencia consentimento LGPD                       │  │
│  │  - Registra acessos (auditoria)                      │  │
│  │  - Executa direitos LGPD (Art. 9)                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────┴─────────────────────────────┐ │
│  │              Evidence Collectors (3)                  │ │
│  │                                                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐         │ │
│  │  │ Patient Timeline │  │ System Aggregate │         │ │
│  │  │ (encrypted PHI)  │  │ (de-identified)  │         │ │
│  │  └──────────────────┘  └──────────────────┘         │ │
│  │                                                       │ │
│  │  ┌──────────────────┐                                │ │
│  │  │ FHIR Audit       │                                │ │
│  │  │ (FHIR R4)        │                                │ │
│  │  └──────────────────┘                                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            Cloudflare KV Storage                     │  │
│  │  - timeline:{patient_id} - Encrypted timelines       │  │
│  │  - aggregate:{window} - De-identified aggregates     │  │
│  │  - fhir:audit:{id} - FHIR AuditEvents               │  │
│  │  - consent:{patient_id} - Consent status             │  │
│  │  - access:{id} - Access logs                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 3 Evidence Collectors

### 1. Patient Timeline Collector (PHI, Encrypted)

Coleta **timeline criptografado do paciente** com todos os eventos clínicos.

**Features:**
- **Encryption**: AES-256-GCM (Web Crypto API)
- **Consent-based**: Só coleta se consentimento válido
- **Retention**: 5 anos (LGPD Article 16)
- **Auto-anonymization**: Após 1 ano, remove PHI
- **LGPD Article 9**: Suporta todos os direitos do titular

**Eventos armazenados:**
- Sessões de triagem
- Classificações de prioridade
- Extração de slots (dados clínicos)
- Execução de tasks
- Disparos de guards
- Verificações de deadlines
- Cálculos de rewards

**Formato:**
```typescript
{
  patient_id: "patient_456",
  timeline_id: "timeline:patient_456:1696780800000",
  created_at: "2025-10-07T14:00:00.000Z",
  encryption_key_id: "key:patient_456:1696780800000",
  consent_status: { status: "granted", ... },
  events: [
    {
      event_id: "event_123",
      timestamp: "2025-10-07T14:05:00.000Z",
      category: "classification",
      action: "create",
      description: "Classificação de prioridade",
      encrypted_data: "base64_encrypted_json",
      encryption_iv: "base64_iv",
      encryption_tag: "base64_tag"
    }
  ],
  retention_until: "2030-10-07T14:00:00.000Z",
  anonymize_after: "2026-10-07T14:00:00.000Z",
  anonymized: false
}
```

### 2. System Aggregate Collector (No PHI, De-identified)

Coleta **padrões agregados do sistema** sem identificadores pessoais para aprendizado RRE.

**Features:**
- **No PHI**: Todos os dados são anonimizados
- **AI-driven anonymization**: Workers AI remove identificadores
- **Aggregation windows**: 24 horas
- **RRE integration**: Envia padrões para aprendizado
- **Performance metrics**: Métricas de desempenho do sistema

**Métricas agregadas:**
```typescript
{
  aggregation_window: {
    start: "2025-10-07T00:00:00.000Z",
    end: "2025-10-08T00:00:00.000Z"
  },
  event_count: 1250,
  metrics: {
    total_sessions: 320,
    classifications: {
      "vermelho": 12,
      "laranja": 45,
      "amarelo": 128,
      "verde": 98,
      "azul": 37
    },
    flowcharts: {
      "dor_toracica": 25,
      "dispneia": 38,
      "cefaleia": 42
    },
    guards_triggered: {
      "sepsis_early_detection": 8,
      "cardiac_ischemia_alert": 15,
      "critical_hypoxemia": 12
    },
    deadlines_met: 285,
    deadlines_missed: 35,
    average_triage_time_ms: 540000,
    patterns_detected: {
      "sepsis_pattern": 8,
      "stroke_pattern": 3,
      "cardiac_pattern": 15
    }
  },
  learning_patterns: [
    {
      pattern_type: "sepsis_detection",
      frequency: 8,
      success_rate: 0.875,
      context: { /* de-identified context */ }
    }
  ],
  send_to_rre: true
}
```

### 3. FHIR Audit Event Collector (FHIR R4 Compliant)

Coleta **eventos de auditoria em formato FHIR R4** para compliance regulatório.

**Features:**
- **FHIR R4 compliant**: Segue especificação HL7 FHIR R4
- **Provenance tracking**: Rastreabilidade de origem
- **Bundle support**: Agrupa múltiplos eventos
- **External export**: Pode enviar para servidor FHIR externo
- **Regulatory compliance**: ANS, CFM, LGPD

**Formato FHIR AuditEvent:**
```json
{
  "resourceType": "AuditEvent",
  "id": "audit-1696780800000-abc123",
  "type": {
    "system": "http://terminology.hl7.org/CodeSystem/audit-event-type",
    "code": "execute",
    "display": "Execute"
  },
  "action": "E",
  "recorded": "2025-10-07T14:05:00.000Z",
  "outcome": "0",
  "agent": [
    {
      "type": {
        "coding": [{
          "system": "http://terminology.hl7.org/CodeSystem/extra-security-role-type",
          "code": "datacollector",
          "display": "Data Collector"
        }]
      },
      "who": {
        "reference": "Device/pir-tasks",
        "display": "pir-tasks"
      },
      "requestor": true
    }
  ],
  "source": {
    "observer": {
      "reference": "Device/pir-tasks",
      "display": "PIR TASKS"
    }
  },
  "entity": [
    {
      "what": {
        "reference": "Patient/patient_456",
        "display": "Patient Record"
      },
      "type": {
        "system": "http://terminology.hl7.org/CodeSystem/audit-entity-type",
        "code": "1",
        "display": "Person"
      }
    },
    {
      "what": {
        "reference": "Encounter/session_123",
        "display": "Triage Session"
      },
      "type": {
        "system": "http://terminology.hl7.org/CodeSystem/audit-entity-type",
        "code": "2",
        "display": "System Object"
      }
    }
  ]
}
```

## LGPD Compliance

### Consent Tracking (Article 8)

Rastreia **consentimento explícito do paciente** para coleta e uso de dados.

**Consent Status:**
```typescript
{
  consent_id: "consent:patient_456",
  patient_id: "patient_456",
  consent_version: "1.0.0",
  granted_at: "2025-10-07T14:00:00.000Z",
  revoked_at: null,
  status: "granted",
  permissions: {
    collect_phi: true,
    store_timeline: true,
    share_anonymized: true,
    export_fhir: true
  },
  rights_exercised: []
}
```

### Patient Rights (Article 9)

Implementa **todos os direitos do titular** previstos na LGPD:

1. **Access** (Acesso) - Fornecer dados ao paciente
2. **Rectification** (Retificação) - Corrigir dados incorretos
3. **Deletion** (Eliminação) - Direito ao esquecimento
4. **Portability** (Portabilidade) - Exportar em formato legível
5. **Revocation** (Revogação) - Revogar consentimento

### Access Logs

Registra **todos os acessos** a dados do paciente para auditoria:

```typescript
{
  access_id: "access:1696780800000",
  timestamp: "2025-10-07T14:05:00.000Z",
  user_id: "user_123",
  user_role: "physician",
  patient_id: "patient_456",
  action: "read",
  resource_type: "PatientTimeline",
  resource_id: "timeline:patient_456",
  ip_address: "192.168.1.100",
  justification: "Clinical review",
  authorized: true,
  authorization_method: "consent_based"
}
```

### Data Retention

- **Retention**: 5 anos (LGPD Article 16)
- **Auto-anonymization**: Após 1 ano
- **Automatic deletion**: Após período de retenção
- **Patient control**: Pode solicitar exclusão antecipada

## Workers AI Models

- **QWQ-32B** (`@cf/qwen/qwq-32b-preview`): Anonimização inteligente de dados

## API Endpoints

### POST `/api/evidence/collect`

Coleta evento de evidence.

**Request:**
```json
{
  "event_id": "event_123",
  "event_type": "patient_local",
  "category": "classification",
  "action": "create",
  "timestamp": "2025-10-07T14:05:00.000Z",
  "session_id": "session_123",
  "patient_id": "patient_456",
  "user_id": "user_123",
  "user_role": "physician",
  "data": {
    "classification": "laranja",
    "flowchart": "dor_toracica",
    "reasoning": "Dor torácica típica, FC 95, PA 145/90"
  },
  "metadata": {
    "source_system": "pir-tasks",
    "version": "1.0.0",
    "environment": "production"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "session_id": "session_123",
    "timestamp": "2025-10-07T14:05:00.000Z",
    "events_collected": 3,
    "storage_locations": {
      "patient_timeline": "timeline:patient_456",
      "system_aggregate": "aggregate:2025-10-07T00:00:00",
      "fhir_bundle": "fhir:audit:audit-1696780800000-abc123"
    },
    "encryption_applied": true,
    "fhir_compliant": true,
    "lgpd_compliant": true
  }
}
```

### POST `/api/consent/grant`

Concede consentimento LGPD.

**Request:**
```json
{
  "consent_id": "consent:patient_456",
  "patient_id": "patient_456",
  "consent_version": "1.0.0",
  "granted_at": "2025-10-07T14:00:00.000Z",
  "status": "granted",
  "permissions": {
    "collect_phi": true,
    "store_timeline": true,
    "share_anonymized": true,
    "export_fhir": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Consent granted successfully",
  "consent_id": "consent:patient_456"
}
```

### POST `/api/consent/revoke`

Revoga consentimento LGPD.

**Request:**
```json
{
  "patient_id": "patient_456",
  "reason": "Patient request"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Consent revoked successfully"
}
```

### GET `/api/consent/:patientId`

Verifica consentimento.

**Response:**
```json
{
  "success": true,
  "consent": {
    "consent_id": "consent:patient_456",
    "patient_id": "patient_456",
    "status": "granted",
    "permissions": { ... }
  }
}
```

### POST `/api/rights/exercise`

Exercer direito LGPD (Article 9).

**Request:**
```json
{
  "patient_id": "patient_456",
  "right_type": "deletion"
}
```

**Response:**
```json
{
  "success": true,
  "message": "LGPD right \"deletion\" exercised successfully"
}
```

### GET `/api/export/:patientId`

Exporta dados do paciente (Right to Portability).

**Response:**
```json
{
  "success": true,
  "export": {
    "patient_timeline": {
      "patient_id": "patient_456",
      "events": [ ... ]
    },
    "fhir_bundle": {
      "resourceType": "Bundle",
      "entry": [ ... ]
    }
  }
}
```

### POST `/api/cleanup`

Limpa evidence antigos (retention policy).

**Response:**
```json
{
  "success": true,
  "cleanup_result": {
    "deleted_timelines": 12,
    "anonymized_timelines": 34,
    "deleted_aggregates": 5
  }
}
```

## Estrutura de Pastas

```
pir-evidence/
├── src/
│   ├── index.ts                          # Worker entry point
│   ├── types/
│   │   └── evidence.ts                   # Tipos de evidence e FHIR
│   ├── collectors/
│   │   ├── base-collector.ts             # Classes base + encryption
│   │   └── fhir-collector.ts             # FHIR R4 collector
│   └── orchestrator/
│       └── evidence-orchestrator.ts      # Orquestração + LGPD
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## Encryption (AES-256-GCM)

Patient timelines são **criptografados** usando Web Crypto API:

```typescript
// Encrypt
const encrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: randomIV },
  encryptionKey,
  dataBuffer
);

// Decrypt
const decrypted = await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: ivBuffer },
  encryptionKey,
  encryptedBuffer
);
```

**IMPORTANTE**: Em produção, use **key management system** adequado (não chaves hardcoded).

## Anonymization

Dados são **anonimizados** usando:

1. **Rule-based**: Remove campos óbvios de PHI (nome, CPF, endereço)
2. **AI-driven**: Workers AI detecta e remove identificadores sutis
3. **Aggregation**: Métricas agregadas sem identificadores individuais

## Deployment

### 1. Criar KV Namespace

```bash
npx wrangler kv:namespace create "EVIDENCE_KV"
npx wrangler kv:namespace create "EVIDENCE_KV" --preview
```

### 2. Atualizar wrangler.toml

```toml
[[kv_namespaces]]
binding = "EVIDENCE_KV"
id = "seu_kv_id_aqui"
preview_id = "seu_preview_kv_id_aqui"
```

### 3. Deploy

```bash
cd workers/pir-evidence
npm install
npx wrangler deploy
```

## Integração com PIR

Evidence coleta eventos de **todos os workers PIR**:

- **pir-slots**: Extração de dados clínicos
- **pir-tasks**: Execução de tarefas
- **pir-guards**: Disparos de alertas de segurança
- **pir-deadlines**: Verificações de prazos
- **pir-rewards**: Cálculos de desempenho

Cada worker envia eventos para `/api/evidence/collect`.

## Regulatory Compliance

### FHIR R4 (HL7)
- ✅ AuditEvent resources
- ✅ Bundle support
- ✅ Provenance tracking
- ✅ External server export

### LGPD (Lei 13.709/2018)
- ✅ Consent tracking (Article 8)
- ✅ Patient rights (Article 9)
- ✅ Data retention (Article 16)
- ✅ Access logs (Article 37)
- ✅ Encryption (Article 46)
- ✅ Anonymization (Article 12)

### ANS (Agência Nacional de Saúde Suplementar)
- ✅ Audit trail
- ✅ Data retention
- ✅ Patient access

### CFM (Conselho Federal de Medicina)
- ✅ Medical records
- ✅ Prontuário eletrônico
- ✅ Rastreabilidade

## Licença

MIT
