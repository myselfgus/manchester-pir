# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PIR Compiler for VOITHER** - Protocol Intermediate Representation compiler for the **VOITHER** AI-native healthcare system. This system transforms clinical protocols (specifically **Manchester Triage SP - Portaria SMS 82/2024**) into structured, executable JSON workflows.

### Purpose
**VOITHER** eliminates administrative friction from clinical workflows using specialized LLMs operating in parallel at the edge. This PIR Compiler converts the Manchester SP protocol into executable PIR JSON that runs on Cloudflare Workers AI.

## Architecture Context

PIR Compiler is one component in a larger distributed healthcare architecture:
- **PIR** (this project): Compiles clinical protocols into executable workflow representations
- **ROE** (Runtime Orchestrator Engine): Executes PIR workflows and orchestrates agents
- **RRE** (Rhizomatic Reasoning Engine): Learns aggregated patterns from execution
- **RMS** (Rhizomatic Memory System): Distributed memory system

### Core Architectural Principles
1. **Local-first networking**: Processes on local service networks (low latency), not offline systems
2. **Conversational data extraction**: Extracts data from natural voice/text conversations, not forms
3. **Predictive, not reactive**: Suggests before errors occur rather than blocking after
4. **Auto-updating**: PIR hot-reloads when protocols change
5. **Edge-distributed**: Cloudflare Workers + MongoDB Atlas + local LLMs
6. **Rhizomatic networks**: Non-hierarchical, patients flow between services

## PIR Structure (6 Core Elements)

Every compiled PIR JSON contains these elements:

1. **SLOTS**: Clinical data variables extracted conversationally (not forms)
   - Types: conversational, computed, device, historical
   - Include extraction patterns (regex), fallbacks, auto-fill rules

2. **TASKS**: Atomic executable actions
   - Types: local_inference, llm_reasoning, distributed, api_call
   - Execute locally first, sync when needed
   - Support reversibility/undo

3. **GUARDS**: Predictive safety barriers (not reactive blocks)
   - Suggest BEFORE errors happen
   - Show reasoning transparently
   - Allow overrides with logging

4. **DEADLINES**: Time windows with adaptive behavior
   - Relax under high load conditions
   - Escalate when missed

5. **REWARDS**: Utility function for system learning
   - Weights for successful completion, deadline adherence, pattern detection
   - Feeds RRE learning engine

6. **EVIDENCE**: Audit trail + learning configuration
   - Patient-local encrypted timelines
   - System-aggregated patterns (no PHI)
   - FHIR-compliant audit bundles

## Technology Stack

- **Runtime**: Cloudflare Workers (edge <10km from São Paulo, Brazil)
- **Database**: MongoDB Atlas (aggregated patterns, no PHI)
- **LLM Runtime**: Cloudflare Workers AI (October 2025 models):
  - `@cf/openai/whisper-large-v3-turbo` - STT (2-4x faster than v3)
  - `@cf/meta/llama-4-scout-17b-16e-instruct` - Multimodal MoE (17B params, 16 experts)
  - `@cf/meta/llama-3.1-8b-instruct` - Fast edge inference
  - Features: Speculative decoding, prefix caching, batch inference, streaming
- **Language**: TypeScript (strict typing, no `any`)

## Current Implementation Status

The project implements **Manchester SP PIR Runtime Executors** - specialized workers that execute `manchester-sp-protocol.pir.json` using Cloudflare Workers AI:

- `workers/pir-slots/` ✅ 18 slot extractors (conversational data extraction via LLMs)
- `workers/pir-tasks/` 🚧 12 task executors (clinical workflow actions)
- `workers/pir-guards/` ⏳ 10 predictive guards (safety barriers)
- `workers/pir-deadlines/` ⏳ Adaptive time windows
- `workers/pir-rewards/` ⏳ Scoring system for RRE learning
- `workers/pir-evidence/` ⏳ FHIR-compliant audit trail

Each worker reads the PIR JSON definition and **implements AI-native execution** using specialized LLMs in parallel (rizoma architecture - non-hierarchical, maximum concurrency).

## Project Structure

```
/
├── CLAUDE.md                              # This file
├── prompt-pir-compiler.md                 # Specification for PIR Compiler (future)
├── manchester-sp-protocol.pir.json        # Reference PIR implementation
├── voither-conversation-knowledge.md      # Architecture knowledge base
└── workers/
    └── pir-slots/                         # HealthOS Slot Extractor (IMPLEMENTED)
        ├── src/
        │   ├── index.ts                   # Cloudflare Worker entry point
        │   ├── types/
        │   │   └── slots.ts               # 19 slot type definitions
        │   ├── extractors/
        │   │   ├── base-extractor.ts      # Base LLM extractor class
        │   │   ├── conversational-slots.ts # 8 conversational extractors
        │   │   └── device-computed-slots.ts # 10 device/computed extractors
        │   ├── orchestrator/
        │   │   └── rhizomatic-orchestrator.ts # Parallel extraction coordinator
        │   └── stt/
        │       └── whisper-worker.ts      # Speech-to-text (Cloudflare AI)
        ├── wrangler.toml                  # Cloudflare Worker config
        ├── package.json
        ├── tsconfig.json
        └── README.md                      # Detailed API documentation
```

## API Endpoints (Cloudflare Worker)

```
POST /api/pir/compile
  Body: { protocol_source: "url"|"text", content: string, protocol_name: string }
  Response: { pir_id: string, pir: PIR, validation_report: ValidationReport }

GET /api/pir/:protocol_id
  Response: PIR

PUT /api/pir/:protocol_id
  Body: Partial<PIR>
  Response: PIR

GET /api/pir/search?name=manchester
  Response: PIR[]
```

## Implementation Requirements

### When Generating PIRs

**SLOTS must be conversational**:
- Extract from voice/text streams using regex patterns
- Define fallback questions if extraction fails
- Support auto-fill from recent history (e.g., "last_known(<24h)")
- Never create form-based data collection

**GUARDS must be predictive**:
- Action type should be `"suggest"`, not `"block"`
- Include `show_reasoning: true` for transparency
- Allow overrides with `override_allowed: true` and `log_override: true`
- Trigger BEFORE problems occur (e.g., detect sepsis signs early)

**TASKS must execute locally first**:
- Set `execution.local` for edge processing
- Use `execution.sync` only when coordination needed
- Include fallback strategies

**DEADLINES must adapt**:
- Set `adaptive: true` to relax under high load
- Define `relaxes_to` extended time windows
- Specify escalation procedures

### Validation Requirements

Every generated PIR must pass:
1. Schema validation (TypeScript interfaces + Zod)
2. Consistency checks (all referenced slots exist in tasks)
3. Completeness verification (all 6 elements present)

### TypeScript Standards

- Use strict typing throughout
- Define all interfaces in [types.ts](types.ts)
- Never use `any` type
- Comprehensive error handling with try-catch
- Strategic logging for debugging

## Environment Variables

Required for deployment:
```bash
ANTHROPIC_API_KEY=sk-...           # Claude API for parsing protocols
MONGODB_URI=mongodb+srv://...      # MongoDB Atlas connection
CLOUDFLARE_ACCOUNT_ID=...          # Cloudflare deployment
```

## Reference Protocol: Manchester SP

The primary reference implementation is the Manchester Triage Protocol for São Paulo (Portaria SMS nº 82/2024).

**5 Classification Colors**:
- 🔴 RED (Emergency): Immediate - life-threatening conditions
- 🟠 ORANGE (Very Urgent): ≤10 min - high risk
- 🟡 YELLOW (Urgent): ≤1 hour - present risk
- 🟢 GREEN (Less Urgent): ≤2 hours - less severe
- 🔵 BLUE (Non-Urgent): ≤4 hours - routine care

**Priority Flows** (must include dedicated guards/tasks):
- Chest pain (suspected MI)
- Stroke (thrombolysis window)
- Sepsis (1-hour bundle)
- Trauma

## Key Design Patterns

### Protocol Parsing with Claude API
Use Claude to extract structured data from natural language protocols:
- Identify classification categories and criteria
- Map required clinical data to SLOTS
- Detect red flags for GUARDS
- Extract time constraints for DEADLINES
- Identify priority workflows for special TASKS

### MongoDB Document Schema
Store compiled PIRs with metadata:
- Version tracking
- Usage statistics (execution count, success rate)
- Validation status
- Source attribution

### Hot-Reload Auto-Update
PIRs check for protocol updates periodically and hot-reload with rollback capability on errors.

## Critical Constraints

1. **No form-based collection**: All data extraction must be conversational
2. **Predictive over reactive**: Guards suggest, they don't block
3. **Local-first execution**: Process on edge, sync only when necessary
4. **No PHI in aggregated data**: System learning uses de-identified patterns
5. **FHIR compliance**: Evidence/audit trails must support regulatory requirements
