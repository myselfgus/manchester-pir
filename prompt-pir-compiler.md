# Prompt para Claude Code: PIR Compiler - Protocolo Manchester SP

## CONTEXTO DA ARQUITETURA VOITHER

Você vai construir o **PIR Compiler**, componente fundacional de uma arquitetura AI-native para saúde pública brasileira.

### O que é PIR (Protocol Intermediate Representation)
PIR é a "linguagem de montagem para workflows clínicos". Transforma protocolos médicos escritos em linguagem natural (PDFs, portarias, guidelines) em JSON estruturado executável por máquina.

### Componentes da Arquitetura (contexto)
- **PIR**: Representa o workflow (você vai construir isso)
- **ROE** (Runtime Orchestrator Engine): Executa o PIR, orquestra agentes
- **RRE** (Rhizomatic Reasoning Engine): Aprende padrões agregados
- **RMS** (Rhizomatic Memory System): Memória distribuída do sistema

### Princípios Arquiteturais CRÍTICOS
1. **Rede local primeiro**: Tudo processa na rede local do serviço (baixa latência), não é "sistema offline"
2. **Conversacional**: Dados extraídos de conversas naturais (voz/texto), não formulários
3. **Preditivo**: Sistema sugere ANTES de erro acontecer, não bloqueia depois
4. **Auto-atualizável**: PIR se atualiza quando protocolos mudam (hot-reload)
5. **Distributed**: Edge workers Cloudflare + MongoDB Atlas + LLMs locais
6. **Rizomático**: Redes não-hierárquicas, paciente circula entre serviços

## ESTRUTURA DO PIR (6 Elementos Fundamentais)

```typescript
interface PIR {
  protocol_id: string;
  version: string;
  auto_update: AutoUpdateConfig;
  context: ContextAwareness;
  slots: Record<string, Slot>;
  tasks: Task[];
  guards: Record<string, Guard>;
  deadlines: Record<string, Deadline>;
  rewards: RewardFunction;
  evidence: EvidenceConfig;
}
```

### 1. SLOTS (Variáveis de Dados Clínicos)
```typescript
interface Slot {
  type: 'conversational' | 'computed' | 'device' | 'historical';
  extract_from?: 'stt_stream' | 'patient_data' | 'device';
  patterns?: string[]; // Regex patterns para extração
  fallback?: string; // O que fazer se não extrair
  auto_fill?: string; // Ex: "last_known(<24h)"
  required_for?: string[]; // Quais tasks dependem disso
}
```

**Exemplo:**
```json
{
  "vital.pa": {
    "type": "conversational",
    "extract_from": "stt_stream",
    "patterns": ["pressão (\\d+)/(\\d+)", "PA (\\d+) por (\\d+)"],
    "fallback": "ask('Qual a pressão arterial?')",
    "auto_fill": "last_known(<1h)"
  }
}
```

### 2. TASKS (Ações Atômicas Executáveis)
```typescript
interface Task {
  id: string;
  type: 'local_inference' | 'llm_reasoning' | 'distributed' | 'api_call';
  model?: string; // Para inferências locais
  inputs: string[]; // Referências a slots/outputs
  outputs: string[];
  execution: {
    local?: string; // Execução na rede local
    sync?: string; // Sincronização quando necessário
    fallback?: string;
  };
  reversible?: boolean;
  undo_action?: string;
}
```

**Exemplo:**
```json
{
  "id": "calculate_manchester_score",
  "type": "local_inference",
  "inputs": ["slots.chief_complaint", "slots.vital_signs", "slots.pain_level"],
  "outputs": ["manchester_color", "target_wait_time", "reasoning"],
  "execution": {
    "local": "run_classification_model(inputs)",
    "sync": "POST /edge/events/triage_calculated"
  }
}
```

### 3. GUARDS (Barreiras de Segurança Preditivas)
```typescript
interface Guard {
  type: 'predictive' | 'reactive' | 'contextual';
  trigger: string; // Quando ativar
  condition?: string; // Lógica
  predictive?: {
    suggest_before: string; // Sugestão ANTES de erro
    auto_calculate?: string; // Cálculo automático
    show_reasoning: boolean;
  };
  action: 'suggest' | 'block' | 'escalate';
  override_allowed: boolean;
  log_override: boolean;
}
```

**Exemplo:**
```json
{
  "sepsis_red_flag": {
    "type": "predictive",
    "trigger": "when(fever AND (hypotension OR tachycardia))",
    "predictive": {
      "suggest_before": "Sinais de sepse detectados. Protocolo sepse disponível?",
      "show_reasoning": true
    },
    "action": "suggest",
    "override_allowed": true,
    "log_override": true
  }
}
```

### 4. DEADLINES (Janelas Temporais)
```typescript
interface Deadline {
  target: string; // "15min", "1h", "30min"
  adaptive: boolean;
  relaxes_to?: string; // Se carga alta
  condition?: string; // Quando relaxar
  escalates_if_missed: string;
}
```

### 5. REWARDS (Função de Utilidade para Aprendizado)
```typescript
interface RewardFunction {
  successful_completion: number;
  deadline_met: number;
  pattern_detected: number;
  preventable_admission_avoided: number;
  guard_violation: number; // Negativo
  updates: string; // Como atualiza pesos
}
```

### 6. EVIDENCE (Auditoria + Aprendizado)
```typescript
interface EvidenceConfig {
  patient_local: {
    timeline: string; // "encrypted_events"
    stays_with: string; // "patient_device"
  };
  system_aggregated: {
    patterns: string; // "no_phi"
    feeds: string; // "RRE learning"
    updates: string; // "this_pir"
  };
  audit: {
    fhir_bundle: boolean;
    immutable: boolean;
    regulatory_compliant: string[];
  };
}
```

## PROTOCOLO BASE: Manchester SP

**Fonte**: Portaria SMS nº 82/2024 - Prefeitura de São Paulo

### Classificações (5 cores):
- 🔴 **VERMELHO (Emergência)**: Atendimento imediato
  - Risco de morte, condições extremamente graves
  - Ex: parada cardíaca, choque, AVC agudo, politrauma grave
  
- 🟠 **LARANJA (Muito Urgente)**: Até 10 minutos
  - Risco elevado, não imediato
  - Ex: dor torácica intensa, dispneia grave, sangramento ativo
  
- 🟡 **AMARELO (Urgente)**: Até 1 hora
  - Risco presente, mas não imediato
  - Ex: dor moderada-intensa, febre alta, vômitos persistentes
  
- 🟢 **VERDE (Pouco Urgente)**: Até 2 horas
  - Casos menos graves
  - Ex: febre, dores leves, viroses, resfriados
  
- 🔵 **AZUL (Não Urgente)**: Até 4 horas
  - Casos simples, atendimentos rotineiros
  - Ex: medicação prescrita, troca de sonda, dores crônicas

### Fluxos Prioritários Obrigatórios:
- Dor Torácica (suspeita IAM)
- AVC (janela trombólise)
- Sepse (bundle 1h)
- Trauma

### Equipamentos Obrigatórios:
- Estetoscópio, termômetro, esfigmomanômetro
- Glicosímetro, oxímetro, relógio
- Pulseiras/etiquetas coloridas

## TAREFA: Construir PIR Compiler

### Input
1. Documento do protocolo Manchester (buscar via web ou usar contexto acima)
2. Portaria SMS 82/2024 com diretrizes SP

### Output
Sistema completo que:
1. **Extrai estrutura** do protocolo Manchester usando Claude API
2. **Gera PIR JSON** completo (6 elementos)
3. **Valida** o PIR gerado
4. **Salva** no MongoDB Atlas
5. **API REST** para consultar/atualizar PIRs

### Stack Técnica
- **Runtime**: Cloudflare Workers (edge Brasil)
- **Database**: MongoDB Atlas
- **LLM**: Claude API (Anthropic)
- **Language**: TypeScript

### Arquitetura do Compiler

```
┌─────────────────────────────────────────┐
│   INPUT: Protocolo Manchester PDF/Text  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  PARSER: Claude API extraction          │
│  - Identifica classificações (cores)    │
│  - Extrai critérios por cor             │
│  - Mapeia fluxos prioritários           │
│  - Detecta deadlines                    │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  PIR GENERATOR                           │
│  - Cria SLOTS conversacionais           │
│  - Define TASKS de classificação        │
│  - Gera GUARDS preditivos               │
│  - Mapeia DEADLINES                     │
│  - Define REWARDS                        │
│  - Configura EVIDENCE                   │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  VALIDATOR                               │
│  - Schema validation (TypeScript)       │
│  - Consistency checks                   │
│  - Completeness verification            │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  STORAGE: MongoDB Atlas                  │
│  Collection: pir_protocols               │
└─────────────────────────────────────────┘
```

### Endpoints da API

```typescript
// Cloudflare Worker endpoints

POST /api/pir/compile
Body: {
  protocol_source: "url" | "text",
  content: string,
  protocol_name: string
}
Response: {
  pir_id: string,
  pir: PIR,
  validation_report: ValidationReport
}

GET /api/pir/:protocol_id
Response: PIR

PUT /api/pir/:protocol_id
Body: Partial<PIR>
Response: PIR

GET /api/pir/search?name=manchester
Response: PIR[]
```

## IMPLEMENTAÇÃO DETALHADA

### 1. Parser usando Claude API

```typescript
async function parseProtocol(protocolText: string): Promise<ParsedProtocol> {
  const prompt = `
Você é um especialista em protocolos médicos. Analise o protocolo abaixo e extraia:

1. CLASSIFICAÇÕES: Todas as categorias de risco com critérios
2. DADOS NECESSÁRIOS: Quais informações clínicas são necessárias
3. REGRAS DE DECISÃO: Lógica para determinar classificação
4. TEMPOS MÁXIMOS: Deadlines por categoria
5. FLUXOS ESPECIAIS: Protocolos prioritários (sepse, AVC, etc)
6. RED FLAGS: Sinais de alerta críticos

Protocolo:
${protocolText}

Retorne JSON estruturado seguindo este schema:
{
  "classifications": [...],
  "required_data": [...],
  "decision_rules": [...],
  "deadlines": {...},
  "priority_flows": [...],
  "red_flags": [...]
}
`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  });

  return JSON.parse(response.content[0].text);
}
```

### 2. Gerador de PIR

```typescript
function generatePIR(parsed: ParsedProtocol): PIR {
  return {
    protocol_id: "manchester_sp_2024",
    version: "1.0",
    
    auto_update: {
      source: "edge://protocols/manchester/latest",
      check_interval: "1h",
      strategy: "hot_reload",
      rollback_on_error: true
    },
    
    context: {
      patient_aware: true,
      network_aware: true,
      load_adaptive: true
    },
    
    slots: generateSlots(parsed),
    tasks: generateTasks(parsed),
    guards: generateGuards(parsed),
    deadlines: generateDeadlines(parsed),
    rewards: generateRewards(),
    evidence: generateEvidenceConfig()
  };
}
```

### 3. MongoDB Schema

```typescript
interface PIRDocument {
  _id: ObjectId;
  protocol_id: string;
  version: string;
  pir: PIR;
  metadata: {
    created_at: Date;
    updated_at: Date;
    created_by: string;
    source_url?: string;
    validation_status: "valid" | "invalid" | "pending";
  };
  usage_stats: {
    executions_count: number;
    last_executed: Date;
    average_success_rate: number;
  };
}
```

### 4. Cloudflare Worker Structure

```
/workers
  /pir-compiler
    ├── src/
    │   ├── index.ts          # Main worker entry
    │   ├── parser.ts         # Claude API parser
    │   ├── generator.ts      # PIR generator
    │   ├── validator.ts      # Schema validator
    │   ├── storage.ts        # MongoDB operations
    │   └── types.ts          # TypeScript interfaces
    ├── wrangler.toml         # Cloudflare config
    └── package.json
```

## REQUISITOS FUNCIONAIS

### RF1: Compilar Protocolo Manchester
- Input: URL ou texto do protocolo
- Output: PIR JSON completo e validado
- Tempo: < 30 segundos

### RF2: Gerar SLOTS Conversacionais
- Identificar automaticamente dados clínicos necessários
- Criar patterns regex para extração de voz/texto
- Definir fallbacks inteligentes

### RF3: Criar GUARDS Preditivos
- Detectar red flags do protocolo
- Gerar sugestões proativas (não bloqueios reativos)
- Incluir reasoning transparente

### RF4: Mapear DEADLINES Adaptativos
- Extrair tempos máximos por classificação
- Permitir adaptação baseada em carga
- Escalar violações apropriadamente

### RF5: Validação Completa
- Schema validation (TypeScript/Zod)
- Consistency checks (SLOTS referenciados existem?)
- Completeness (todos elementos obrigatórios?)

### RF6: API REST Funcional
- CRUD completo de PIRs
- Busca por nome/versão
- Versionamento automático

## CRITÉRIOS DE SUCESSO

✅ Compila protocolo Manchester SP → PIR JSON válido  
✅ PIR contém 6 elementos completos  
✅ SLOTS são conversacionais (não formulários)  
✅ GUARDS são preditivos (sugerem, não bloqueiam)  
✅ DEADLINES adaptativos por classificação  
✅ API REST funcional (deploy Cloudflare)  
✅ Armazenamento MongoDB Atlas  
✅ Validação automática de schema  
✅ Código TypeScript type-safe  
✅ Documentação inline clara  

## INSTRUÇÕES FINAIS

1. **Busque o protocolo**: Use web_search ou web_fetch para pegar conteúdo oficial
2. **Construa TUDO**: Não placeholders, não TODOs, código completo
3. **TypeScript rigoroso**: Interfaces tipadas, sem `any`
4. **Error handling**: Try-catch apropriados, mensagens úteis
5. **Logging**: Console.log estratégico para debug
6. **Deploy ready**: wrangler.toml configurado, pronto para `wrangler deploy`
7. **MongoDB**: Connection string via environment variable
8. **Claude API**: API key via environment variable

## VARIÁVEIS DE AMBIENTE

```bash
ANTHROPIC_API_KEY=sk-...
MONGODB_URI=mongodb+srv://...
CLOUDFLARE_ACCOUNT_ID=...
```

## COMEÇAR AGORA

Construa o PIR Compiler completo, funcional, pronto para produção.

Organize em `/home/claude/pir-compiler` e me mostre funcionando.
