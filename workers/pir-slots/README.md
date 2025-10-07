# HealthOS Slot Extractor

**Sistema Operacional de Saúde AI-Native** - Extração conversacional de slots clínicos usando LLMs como sistema operacional.

## 🧬 Arquitetura Rizomática

O HealthOS implementa uma **arquitetura rizomática não-hierárquica**:

- **18 Agentes LLM Especializados** rodando em paralelo
- Cada agente extrai um slot específico autonomamente
- Sem hierarquia: todos processam simultaneamente o contexto conversacional
- Coordenação descentralizada via orquestrador

```
                    ┌──────────────────────┐
                    │   Audio/Text Input   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Whisper STT (CF AI) │
                    └──────────┬───────────┘
                               │
        ┌──────────────────────▼──────────────────────┐
        │     Rhizomatic Orchestrator (Paralelo)      │
        └──────┬──────┬──────┬──────┬──────┬──────┬──┘
               │      │      │      │      │      │
        ┌──────▼──┐ ┌─▼───┐ ┌▼────┐ ┌▼──┐ ┌▼──┐ ┌▼──┐
        │Chief    │ │Pain │ │Temp │ │BP │ │O2 │ │...│
        │Complaint│ │Score│ │     │ │   │ │   │ │   │
        └─────────┘ └─────┘ └─────┘ └───┘ └───┘ └───┘
             18 Extractors LLM Simultâneos
```

## 🎯 Conceitos Fundamentais

### AI-Native Healthcare OS

O HealthOS trata **LLMs como sistema operacional**, não como ferramentas:

- **Cada slot = Um processo (agente LLM)**
- **Extração paralela = Multitasking rizomático**
- **Conversação = Interface natural** (não formulários)
- **Automação total da burocracia** via IA

### Extração Conversacional

Todos os 18 slots são extraídos de **conversa natural** entre enfermeiro e paciente:

- ✅ **Audio → STT (Whisper) → LLM → Dados estruturados**
- ❌ Sem formulários
- ❌ Sem clicks
- ❌ Sem campos obrigatórios

Exemplo:
```
Paciente: "Estou com uma dor terrível no peito há 2 horas,
           parece que está apertando"

HealthOS extrai automaticamente:
- chief_complaint: "dor torácica"
- pain_score: 8
- symptom_onset: {duration: 2, unit: "hours"}
- chest_pain_characteristics: {precordial: true, ...}
```

## 📋 18 Slots Implementados

### Conversacionais (LLM Extraction)
1. **chief_complaint** - Queixa principal
2. **pain_score** - Escala de dor (0-10)
3. **consciousness_level** - Nível de consciência (AVPU)
4. **bleeding_present** - Presença de hemorragia
5. **bleeding_severity** - Gravidade da hemorragia
6. **symptom_onset** - Há quanto tempo começou
7. **trauma_mechanism** - Mecanismo do trauma
8. **neurological_deficit** - Déficit neurológico (FAST)
9. **chest_pain_characteristics** - Características da dor torácica

### Device-Based (Medições + LLM Parsing)
10. **temperature** - Temperatura corporal
11. **heart_rate** - Frequência cardíaca
12. **blood_pressure** - Pressão arterial (sistólica/diastólica)
13. **oxygen_saturation** - SpO2
14. **respiratory_rate** - Frequência respiratória
15. **glucose_level** - Glicemia capilar

### Historical (RMS + LLM)
16. **previous_medical_history** - História médica pregressa
17. **medications_in_use** - Medicações em uso
18. **allergy_history** - Alergias (CRÍTICO)

### Computed (Algoritmos)
19. **sepsis_criteria** - qSOFA score + suspeita infecção

## 🚀 API Endpoints

### Iniciar Sessão de Triagem
```http
POST /api/triage/start

Request:
{
  "patient_id": "optional-patient-id",
  "patient_context": {
    "age": 45,
    "sex": "M",
    "medical_history": ["diabetes", "hipertensão"]
  }
}

Response:
{
  "success": true,
  "session_id": "uuid-v4",
  "session": {...}
}
```

### Processar Áudio (STT + Extração)
```http
POST /api/triage/:sessionId/audio?speaker=patient

Content-Type: multipart/form-data
Body: audio file (wav, mp3, webm)

Response:
{
  "success": true,
  "transcription": "Estou com dor no peito há 2 horas",
  "extracted_slots": {
    "chief_complaint": {
      "value": "dor torácica",
      "confidence": 0.95,
      "source": "llm_extraction"
    },
    "pain_score": {
      "value": null,
      "confidence": 0.0
    },
    ...
  },
  "progress": {
    "filled_slots": 5,
    "total_slots": 18,
    "completion_percentage": 28
  }
}
```

### Processar Texto (Chat Interface)
```http
POST /api/triage/:sessionId/text

Request:
{
  "text": "A dor é de 8 na escala de 0 a 10",
  "speaker": "patient"
}

Response: (mesma estrutura do /audio)
```

### Obter Próxima Pergunta Inteligente
```http
GET /api/triage/:sessionId/next-question

Response:
{
  "success": true,
  "next_question": {
    "slot_id": "temperature",
    "question": "Qual a temperatura do paciente?",
    "priority": "critical",
    "reasoning": "Slot temperature is unfilled and has critical priority"
  }
}
```

### Status da Sessão
```http
GET /api/triage/:sessionId/status

Response:
{
  "success": true,
  "session": {
    "session_id": "uuid",
    "started_at": "2024-03-15T10:30:00Z",
    "status": "active",
    "conversation_history": [...],
    "slot_state": {
      "chief_complaint": "dor torácica",
      "pain_score": 8,
      ...
    }
  }
}
```

### Atualizar Slot Manualmente
```http
PUT /api/triage/:sessionId/slots/pain_score

Request:
{
  "value": 7
}
```

### Forçar Re-extração de Slot
```http
POST /api/triage/:sessionId/slots/temperature/extract

Response:
{
  "success": true,
  "slot_id": "temperature",
  "extraction_result": {
    "value": 38.5,
    "confidence": 0.9,
    ...
  }
}
```

### Finalizar Triagem
```http
POST /api/triage/:sessionId/complete

Response:
{
  "success": true,
  "session": {...},
  "filled_slots": {...},
  "progress": {
    "completion_percentage": 94
  },
  "pir_export": {
    "session_id": "uuid",
    "slots": {...},
    "conversation_transcript": [...]
  }
}
```

## 🧪 Exemplos de Uso

### Exemplo 1: Triagem Completa com Áudio

```javascript
// 1. Inicia sessão
const session = await fetch('https://healthos.voither.com/api/triage/start', {
  method: 'POST',
  body: JSON.stringify({ patient_id: '12345' })
}).then(r => r.json());

const sessionId = session.session_id;

// 2. Captura áudio do microfone e envia
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks = [];

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks);
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const result = await fetch(
        `https://healthos.voither.com/api/triage/${sessionId}/audio?speaker=patient`,
        { method: 'POST', body: formData }
      ).then(r => r.json());

      console.log('Extracted:', result.extracted_slots);
      console.log('Progress:', result.progress);
    };

    mediaRecorder.start();
    setTimeout(() => mediaRecorder.stop(), 5000); // 5 segundos
  });

// 3. Pergunta inteligente
const nextQ = await fetch(
  `https://healthos.voither.com/api/triage/${sessionId}/next-question`
).then(r => r.json());

console.log('Next:', nextQ.next_question.question);

// 4. Finaliza
const final = await fetch(
  `https://healthos.voither.com/api/triage/${sessionId}/complete`,
  { method: 'POST' }
).then(r => r.json());

console.log('PIR Export:', final.pir_export);
```

### Exemplo 2: Interface Chat (Texto)

```javascript
const sessionId = 'existing-session-uuid';

// Paciente fala
await fetch(`https://healthos.voither.com/api/triage/${sessionId}/text`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'Estou com febre há 3 dias e tosse',
    speaker: 'patient'
  })
});

// Sistema sugere próxima pergunta
const next = await fetch(
  `https://healthos.voither.com/api/triage/${sessionId}/next-question`
).then(r => r.json());

// Enfermeira faz pergunta sugerida
await fetch(`https://healthos.voither.com/api/triage/${sessionId}/text`, {
  method: 'POST',
  body: JSON.stringify({
    text: next.next_question.question,
    speaker: 'nurse'
  })
});
```

## 🏗️ Arquitetura Técnica

### Stack
- **Runtime**: Cloudflare Workers (Edge Computing)
- **STT**: Cloudflare Workers AI - Whisper (@cf/openai/whisper)
- **LLM**: Llama 3.1 8B Instruct (@cf/meta/llama-3.1-8b-instruct)
- **Storage**: Cloudflare KV (sessões)
- **Language**: TypeScript (strict mode)

### Componentes

#### 1. STT/ASR Layer ([whisper-worker.ts](src/stt/whisper-worker.ts))
- Transcrição de áudio para texto
- Suporte a streaming
- Speaker diarization simples

#### 2. Base Extractors ([base-extractor.ts](src/extractors/base-extractor.ts))
- `BaseSlotExtractor<T>` - Classe base abstrata
- `ConversationalExtractor<T>` - Para slots conversacionais
- `DeviceExtractor<T>` - Para sinais vitais
- `ComputedExtractor<T>` - Para slots calculados

#### 3. Concrete Extractors
- [conversational-slots.ts](src/extractors/conversational-slots.ts) - 9 extractors conversacionais
- [device-computed-slots.ts](src/extractors/device-computed-slots.ts) - 10 extractors device/computed

#### 4. Orchestrator ([rhizomatic-orchestrator.ts](src/orchestrator/rhizomatic-orchestrator.ts))
- Gerencia sessões de triagem
- Dispara 18 extractors em paralelo
- Calcula progresso
- Gera perguntas inteligentes de fallback

#### 5. Worker Entry Point ([index.ts](src/index.ts))
- API HTTP REST
- Roteamento
- CORS
- Persistência KV

### Fluxo de Dados

```
Audio/Text Input
    ↓
STT (Whisper) → Transcription
    ↓
Rhizomatic Orchestrator
    ↓
Promise.all([
  extractor1.extract(),
  extractor2.extract(),
  ...
  extractor18.extract()
]) ← PARALELO
    ↓
Slot State Update
    ↓
Progress Calculation
    ↓
Response JSON
```

## 📊 Performance

### Latência Típica
- **STT (Whisper)**: ~200-500ms por chunk de 3-5 segundos
- **Extração Paralela (18 slots)**: ~800ms-2s (todos juntos)
- **Total por turno conversacional**: ~1-2.5 segundos

### Otimizações
- ✅ Extração paralela (não sequencial)
- ✅ Edge computing (baixa latência)
- ✅ LLM local no edge (Llama 3.1 8B)
- ✅ Streaming STT para conversas longas
- ✅ Cache de contexto conversacional

## 🚀 Deploy

### Pré-requisitos
```bash
# Instala Wrangler CLI
npm install -g wrangler

# Login Cloudflare
wrangler login
```

### Configuração

1. Cria KV Namespace:
```bash
wrangler kv:namespace create "SESSIONS_KV"
# Copia o ID e atualiza wrangler.toml
```

2. Atualiza `wrangler.toml`:
```toml
account_id = "SEU_ACCOUNT_ID"

[[kv_namespaces]]
binding = "SESSIONS_KV"
id = "SEU_KV_ID"
```

3. Deploy:
```bash
npm install
npm run deploy
```

### Desenvolvimento Local
```bash
npm run dev
# Servidor local em http://localhost:8787
```

## 🔒 Segurança & Compliance

### LGPD
- ✅ Dados do paciente criptografados
- ✅ Retenção limitada (1 hora em KV por padrão)
- ✅ Trilha de auditoria completa
- ✅ Consentimento implícito por busca de atendimento

### PHI Protection
- ✅ Dados sensíveis nunca em logs
- ✅ Transmissão HTTPS obrigatória
- ✅ Isolamento por sessão
- ✅ Cleanup automático após finalização

## 🧩 Integração com PIR Compiler

O HealthOS exporta dados no formato compatível com PIR:

```javascript
const pirData = orchestrator.exportToPIR(sessionId);

// Envia para PIR Compiler
await fetch('https://pir-compiler.voither.com/api/pir/compile', {
  method: 'POST',
  body: JSON.stringify({
    protocol_name: 'manchester-sp-2024',
    slots: pirData.slots,
    conversation_transcript: pirData.conversation_transcript
  })
});
```

## 🎓 Filosofia: LLMs como Sistema Operacional

O HealthOS inverte o paradigma tradicional:

### Paradigma Antigo
```
Sistema → Formulário → Usuário preenche → Dados estruturados
```

### Paradigma HealthOS (AI-Native)
```
Conversa Natural → LLMs (OS) → Dados estruturados
```

**LLMs são o sistema operacional:**
- Interpretam intenção
- Extraem informação
- Estruturam dados
- Validam consistência
- Sugerem próximos passos

**Humanos focam no que importa:**
- Cuidar do paciente
- Tomar decisões clínicas
- Não preencher formulários

## 📝 Licença

MIT License - Voither Team

## 🤝 Contribuindo

Pull requests são bem-vindos! Para mudanças maiores, abra uma issue primeiro.

## 📞 Suporte

- Documentação: https://docs.voither.com/healthos
- Issues: https://github.com/voither/healthos/issues
- Email: dev@voither.com
