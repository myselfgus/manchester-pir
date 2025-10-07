# Voither: AI-Native Healthcare System - Technical Knowledge Extract

**Source:** Combined Claude conversations (Portuguese/English)
**Date Extracted:** 2025-10-06
**Status:** Theoretical architecture with validated UX patterns
**Context:** Healthcare workflow automation using edge computing, multi-LLM orchestration, and patient-centric data sovereignty

---

## Executive Summary

Voither is an AI-native healthcare system designed to eliminate administrative friction from clinical workflows by using multiple specialized LLMs operating in parallel at the edge. The system inverts traditional healthcare IT paradigms: data sovereignty belongs to the patient (not the institution), processing happens locally at the edge (not in centralized clouds), and networks are rhizomatic (non-hierarchical). The architectural foundation rests on four core components: PIR (Protocol Intermediate Representation), ROE (Runtime Orchestrator Engine), RRE (Rhizomatic Reasoning Engine), and RMS (Rhizomatic Memory System).

**Validated Foundation:** The core UX pattern was successfully implemented in 2023 using Google Sheets for UPA (emergency care unit) bed management, achieving viral organic adoption across 5 UPAs without marketing or institutional mandate.

---

## 1. Core Architectural Components

### 1.1 PIR (Protocol Intermediate Representation)

**Definition:** "Assembly language for clinical workflows" - transforms medical guidelines (PDFs, SUS protocols) into machine-executable JSON structures.

**Six Fundamental Elements:**

```json
{
  "protocol_id": "triage_emergency_2025",
  "version": "3.2",

  "1_SLOTS": {
    "chief_complaint": {
      "type": "conversational",
      "extract_from": "stt_stream",
      "patterns": ["dor em *", "sinto *", "estou com *"],
      "cost": "low",
      "latency": "<1s",
      "voi": "high",
      "sources": ["voice", "device", "patient_record"]
    },
    "vital_signs.pa": {
      "value": null,
      "cost": "low (device)",
      "voi": "high (risk_calc)",
      "fallback": "last_known(<1h)"
    }
  },

  "2_TASKS": {
    "order.ecg": {
      "reversible": true,
      "endpoints": {
        "do": "/api/exams/ecg/create",
        "undo": "/api/exams/ecg/cancel"
      },
      "effects": ["slot.ecg_ordered = true"],
      "inverse": "cancel_ecg"
    }
  },

  "3_GUARDS": {
    "dose.renal": {
      "type": "predictive",
      "condition": "gfr >= 60",
      "action": "suggest_dose_adjustment",
      "show_reasoning": true,
      "override_allowed": true,
      "log_override": true
    },
    "sepsis_red_flag": {
      "trigger": "when(fever AND hypotension)",
      "action": "suggest_immediate_sepsis_protocol"
    }
  },

  "4_DEADLINES": {
    "triage_completion": {
      "target": "15min",
      "adaptive": true,
      "relaxes_to": "30min if service_load > 80%",
      "escalates_if_missed": "notify_supervisor"
    }
  },

  "5_REWARDS_LOSS": {
    "successful_triage": +10,
    "deadline_met": +5,
    "pattern_detected": +15,
    "preventable_admission_avoided": +25,
    "guard_violated": -50,
    "deadline_missed": -20
  },

  "6_EVIDENCE": {
    "patient_local": {
      "timeline": "encrypted_events",
      "stays_with": "patient_device"
    },
    "system_aggregated": {
      "pattern": "chest_pain + age>50 → MI (confidence: 0.87)",
      "no_phi": true,
      "feeds_into": "RRE"
    },
    "audit": {
      "fhir_bundle": true,
      "immutable": true,
      "regulatory_compliant": ["LGPD", "CFM"]
    }
  }
}
```

**PIR Evolution: Theory vs. Vision**

| Current Theory (70% Complete) | Required Vision (100%) |
|-------------------------------|------------------------|
| Centralized API endpoints | Edge-first, offline-capable execution |
| Form-based SLOTS | Conversational extraction via NLU |
| Reactive GUARDS (block after decision) | Predictive GUARDS (suggest before decision) |
| Static protocol (requires redeploy) | Auto-updating (hot-reload from protocol source) |
| EVIDENCE as audit log only | EVIDENCE retrofeeds PIR (learning loop) |
| Single-service context | Rhizomatic context (patient journey + network state) |

**Critical Gap:** PIR needs context-awareness:

```json
{
  "context": {
    "patient_journey": {
      "visits_last_30d": "query_patient_data(encrypted)",
      "cross_service_pattern": "3x UPA Zona Sul (chest pain)",
      "suggest": "Consider ambulatory cardio referral"
    },
    "network_state": {
      "current_service_load": "12/15 beds occupied",
      "nearby_services": "UPA Zona Norte: 8/20 beds",
      "suggest_transfer_if": "wait_time > 2h AND nearby_available"
    }
  }
}
```

---

### 1.2 ROE (Runtime Orchestrator Engine)

**Definition:** State machine with mathematical guarantees that executes PIR workflows in real-time.

**Core Capabilities:**

1. **Auto-complete SLOTS** via Submodular Optimization
   - Solves Submodular Coverage with costs
   - Each action/source covers multiple slots
   - Greedy solution with VoI (Value of Information) weights
   - Guarantee: 1-1/e quality (~63% optimal)
   - Prioritizes actions that "unlock" protocol fastest

2. **Team Orchestration** via Min-cost Flow
   - Maps TASKS to team members: {Reception, Nursing, Tech, Doctor, Pharmacy, Regulation}
   - Respects precedences and time windows
   - Dynamic reallocation when capacity changes

3. **Runtime Control** via Receding Horizon Control (RHC)
   - Operates under constraints Γ (GUARDS)
   - Recomputes next step at every event
   - Respects deadlines and invariants
   - Horizon H adapts to context (emergency vs. ambulatory)

4. **Action Selection** via Multi-armed Bandits
   - Gittins index (simplified) or VoI always constrained by Γ
   - Exploration vs. exploitation balance
   - Contextual bandits for personalized next-question selection

**Execution Cycle:**

```python
# ROE Runtime Loop
def execute_workflow(pir, patient_state):
    # 1. INSTANTIATION
    instance = create_instance(pir)
    state = initialize_state(patient_state)

    # 2. NEXT BEST ACTION (computed via submodular optimization)
    while not workflow_complete(state):
        next_action = argmax(VoI(slot) / cost(slot))

        # 3. COMPLIANCE CHECK (before execution)
        if violates_guards(next_action, state):
            trigger_grace_mode()  # Human-in-the-loop
            continue

        # 4. ATOMIC EXECUTION
        result = execute_task(next_action, reversible=True)

        # 5. EVIDENCE LOGGING
        rms.append_event({
            "timestamp": now(),
            "actor": current_user,
            "task": next_action,
            "result": result,
            "state_snapshot": state
        })

        # 6. STATE UPDATE
        state.update(result)

        # 7. RRE INJECTION (adds Γ and Φ)
        state = rre.inject_constraints(state)

    return state
```

**Mathematical Foundation:**

- **Submodular Optimization:** `f(A ∪ {e}) - f(A) ≥ f(B ∪ {e}) - f(B)` for A ⊆ B
- **Value of Information:** `VoI(slot) = E[utility_improvement | slot_filled] * P(decision_changes)`
- **Min-cost Flow:** Network flow problem with capacities and costs
- **Receding Horizon:** Optimize over window [t, t+H], execute first action, slide window

**Safeguards:**

- **Grace Mode:** When `uncertainty_score > 0.8`, pause automation and require human validation
- **Saga Compensation:** All TASKS are reversible to ensure distributed consistency
- **Formal Verification:** Γ invariants checked before every state transition

---

### 1.3 RRE (Rhizomatic Reasoning Engine)

**Definition:** Semantic reasoning layer that injects constraints (Γ) and priority fields (Φ) into ROE execution.

**Key Operators:**

```python
class RRE:
    def ALIGN(semantic_vec_a, semantic_vec_b):
        """Semantic alignment via embeddings
        Maps clinical narrative ↔ PIR protocol
        """
        return cosine_similarity(embed(a), embed(b))

    def PRIORITIZE(events, durée_vector):
        """Urgency ranking with phenomenological time decay
        "Fever 1h ago" > "BP 12h ago" for sepsis evaluation
        """
        return sorted(events, key=lambda e: durée_relevance(e))

    def MEET(source_a, source_b):
        """Logical intersection identification
        Finds overlapping constraints/data between sources
        """
        return intersection(a.constraints, b.constraints)

    def SHIFT(perspective_from, perspective_to):
        """Viewpoint transformation
        Patient narrative → Protocol requirements
        """
        return transform_context(from, to)
```

**Injection Mechanisms:**

1. **Constraint Injection (Γ):**
   ```python
   if detected("chest_pain") AND patient.age > 50:
       inject_guard("ECG_mandatory")
   ```

2. **Priority Field Injection (Φ):**
   ```python
   if detected("sepsis_criteria_met"):
       set_priority_field("Emergency - Sepsis Bundle <1h")
   ```

**Critical Insight from Conversation:**

Initially thought RRE was unnecessary because "LLMs already do semantic reasoning." **This was wrong.** RRE performs combinatorial optimization and formal verification, not semantic inference. LLMs complement RRE but don't replace it.

---

### 1.4 RMS (Rhizomatic Memory System)

**Definition:** Immutable event stream that provides audit trail and enables continuous learning.

**Architecture:**

```javascript
// LOCAL (with patient - encrypted)
{
  "stream_id": "patient_123",
  "storage": "SQLite + SQLCipher",
  "events": [
    {
      "type": "triage_started",
      "timestamp": "2025-10-04T14:30:00Z",
      "data": { "chief_complaint": "chest pain" },
      "encrypted": true,
      "phi_included": true
    }
  ]
}

// AGGREGATED (cloud - no PHI)
{
  "pattern": "chest_pain + age>50 + diaphoresis → MI risk 0.87",
  "occurrences": 127,
  "no_phi": true,
  "feeds_into": "RRE_learning",
  "updates": {
    "voi_weights": "continuous_update",
    "guard_thresholds": "quarterly_adjustment"
  }
}
```

**Durée Vector (Phenomenological Time):**

Traditional systems use linear timestamps. RMS models "subjective clinical time" where relevance decays based on clinical significance, not just elapsed time.

```python
relevance(event) = base_importance * decay_function(elapsed_time, clinical_context)

# Example:
# "Fever 1h ago" has higher relevance than "BP 12h ago" for sepsis evaluation
# But "BP 12h ago" has higher relevance than "Fever 1h ago" for HTN follow-up
```

**Learning Loop:**

```python
# RMS → PIR feedback
def update_voi_weights(traces):
    """
    Learns from historical execution traces to improve VoI estimation

    Cold start: Expert-defined weights
    Continuous: Online learning from outcomes
    Signal: Workflow completion time, diagnostic accuracy, professional feedback
    """
    for trace in traces:
        slot_values = extract_slots(trace)
        outcome = measure_outcome(trace)  # Time to resolution, accuracy, etc.

        # Update VoI weights via gradient descent or contextual bandit update
        voi_weights[slot] += learning_rate * (outcome - expected_outcome)
```

**LGPD/GDPR Compliance:**

- **Edge PHI:** Patient data encrypted with SQLCipher, never leaves local device
- **Cloud Metadata:** Only pseudonymized patterns, no identifiable information
- **Audit Trail:** Immutable FHIR-compatible event log
- **Right to Erasure:** Patient can delete their local data stream at any time

---

### 1.5 MDL Engine (Minimum Description Length)

**Definition:** Lossless semantic compression for efficient edge storage.

**Mechanism:**

```javascript
{
  "compression": {
    "method": "semantic_clustering",
    "groups_similar_events": "into_MetaNodes",
    "guarantees": "100% lossless via inverse_map + decodeFn",
    "penalties": "Increase cost for PHI/invariants (prevents critical data compression)"
  },
  "principle": "Cost = L(model) + L(data|model)",
  "benefit": "Optimizes edge storage without compromising auditability"
}
```

**When NOT to compress:**

- PHI elements (patient identifiers, sensitive data)
- GUARDS invariants (safety-critical constraints)
- DEADLINES (time-sensitive information)
- Recent events (< 24h for most protocols)

**Reassessment:** MDL is a **late-stage optimization**, not a foundational requirement. Storage is not a bottleneck with modern hardware (Mac Mini M4: 512GB-2TB). Prioritize functional components first.

---

## 2. System Architecture & Technology Stack

### 2.1 Edge-First Computing Model

**Principle:** Processing happens at the physical point of care, not in distant datacenters.

**Infrastructure:**

```
┌─────────────────────────────────────────┐
│  UPA/UBS (Healthcare Facility)          │
│                                          │
│  ┌────────────────────────────────┐     │
│  │ Mac Mini M4 (Local Server)     │     │
│  │ - LLMs via MLX/Ollama          │     │
│  │ - SQLite + SQLCipher (PHI)     │     │
│  │ - Local WiFi network           │     │
│  │ - ROE runtime                  │     │
│  └────────────────────────────────┘     │
│                                          │
│  Patient connects → Data decrypted      │
│  → Professional accesses via local net  │
│  → Processing <50ms latency             │
│                                          │
└─────────────────────────────────────────┘
                    ↕
        (Sync when online - optional)
                    ↕
┌─────────────────────────────────────────┐
│  Cloudflare Edge (Brazil <10km)        │
│  - Workers: Serverless compute          │
│  - D1: Edge SQL database                │
│  - R2: Object storage                   │
│  - Durable Objects: Stateful compute    │
│  - Workers AI: Embeddings               │
│                                          │
│  MongoDB Atlas (Cloud)                  │
│  - RMS aggregated patterns (no PHI)     │
│  - PIR protocol definitions             │
│  - Analytics & learning                 │
└─────────────────────────────────────────┘
```

**Why Edge-First:**

- **Latency:** <50ms vs. 200-500ms cloud round-trip
- **Privacy:** PHI never traverses public internet
- **Resilience:** Works offline during network outages
- **Cost:** No egress charges for patient data
- **Sovereignty:** Data stays in jurisdiction (Brazil LGPD)

**Cloudflare Role:**

NOT for primary PHI storage. Used for:

1. **Inter-service communication:** Event propagation between UPAs
2. **Protocol distribution:** PIR updates pushed to edges
3. **Aggregated learning:** Anonymized pattern recognition
4. **Backup coordination:** Encrypted patient data backup orchestration

---

### 2.2 Multi-LLM Orchestration Pattern

**Core Insight:** Specialized LLMs operating in parallel dramatically reduce latency vs. sequential processing.

**Example: Triage Workflow**

```
[Professional says: "Dor no peito há 2 horas"]
              ↓
        [STT Transcription]
              ↓
     [ROE dispatches parallel LLMs]
              ↓
    ┌─────────┴─────────┬──────────┬──────────┐
    ↓                   ↓          ↓          ↓
[LLM1: Extract]   [LLM2: Risk]  [LLM3: Protocol]  [LLM4: Docs]
Structured data   Score: 0.87   Suggest: ECG      SOAP note
    │                   │          │          │
    └─────────┬─────────┴──────────┴──────────┘
              ↓
      [ROE aggregates results]
              ↓
    [Professional sees summary]

Latency: Max(LLM1, LLM2, LLM3, LLM4) ≈ 2-3s
vs. Sequential: LLM1 + LLM2 + LLM3 + LLM4 ≈ 8-12s
```

**Dependency Handling:**

```javascript
// LLMs with NO dependencies → Promise.all()
const [extraction, protocol, history] = await Promise.all([
  dataExtractorLLM(transcript),
  protocolMatcherLLM(transcript),
  historyRetrieverLLM(patient_id)
]);

// LLMs WITH dependencies → Sequential
const extraction = await dataExtractorLLM(transcript);
const risk = await riskCalculatorLLM(extraction);  // Needs structured data
const protocol = await protocolMatcherLLM(risk);   // Needs risk score
```

**Conflict Resolution:**

```javascript
function aggregate_llm_outputs(outputs) {
  // 1. Check for contradictions
  if (outputs.llm1.risk === "low" && outputs.llm2.risk === "high") {
    // Conservative approach: Take higher risk
    return max_risk(outputs);
  }

  // 2. Weighted voting for categorical outputs
  if (multiple_category_suggestions(outputs)) {
    return weighted_vote(outputs, confidence_scores);
  }

  // 3. Ensemble for numerical outputs
  if (numerical_scores(outputs)) {
    return weighted_average(outputs, model_weights);
  }
}
```

**LLM Specialization Strategy:**

| Specialist | Model | Task | Latency Target |
|------------|-------|------|----------------|
| DataExtractor | Llama 3.3 70B (local) | NER, slot filling | <1s |
| RiskCalculator | Qwen 2.5 32B (local) | Clinical scoring | <500ms |
| ProtocolMatcher | Claude Sonnet (API) | Complex reasoning | <3s |
| DocumentGenerator | GPT-4 (API) | SOAP notes, referrals | <3s |
| RedFlagDetector | Small specialized model | Binary classification | <200ms |

---

### 2.3 Data Sovereignty & Patient-Centric Architecture

**Paradigm Inversion:**

```
Traditional System:
Hospital owns data → Patient requests access → Data in central EHR

Voither System:
Patient owns data → Service requests access → Data with patient
```

**Technical Implementation (Open Question):**

The conversation identified this as **not yet decided**. Possible approaches:

A. **Mobile App Wallet:**
   - Patient has iOS/Android app
   - Encrypted data stored locally
   - Connects to facility WiFi → Transmits decrypted data via local network

B. **NFC Card:**
   - Patient carries card with chip
   - Card contains encryption key
   - Facility reader authenticates → Retrieves data from patient's cloud backup

C. **QR Code + Cloud Pointer:**
   - Patient shows QR code
   - QR contains pointer to encrypted data (IPFS/blockchain)
   - Facility retrieves and decrypts with patient authorization

D. **CPF-based DHT:**
   - Patient's CPF hashes to distributed hash table
   - Data stored in distributed network (not centralized server)
   - Facility queries DHT with patient's permission

**Synchronization Without Central Server:**

Potential approaches:

- **Gossip Protocol:** Services exchange patient visit events
- **Event Replication via Edge:** Cloudflare Workers propagate events
- **Patient-Mediated Sync:** Patient's device syncs data when visiting new facility

**Access Control:**

```json
{
  "patient_id": "encrypted_id",
  "grants": [
    {
      "facility": "UPA_ZonaSul",
      "scope": ["read_history", "write_encounter"],
      "expiration": "2025-10-05T00:00:00Z",
      "purpose": "emergency_triage"
    }
  ],
  "revocations": [],
  "audit_log": "immutable_patient_access_history"
}
```

---

### 2.4 Technology Stack (Specified)

**Local/Edge:**

- **Hardware:** Mac Mini M4 (Apple Silicon optimized for LLM inference)
- **LLM Runtime:** MLX (Apple) or Ollama
- **Database:** SQLite + SQLCipher (encrypted PHI storage)
- **Network:** Local WiFi (isolated from public internet)
- **OS:** macOS (for Apple Silicon optimization)

**Cloud/Edge Coordination:**

- **Compute:** Cloudflare Workers (serverless JavaScript/TypeScript)
- **Storage:**
  - Cloudflare D1 (SQLite at edge)
  - Cloudflare R2 (object storage)
  - MongoDB Atlas (aggregated patterns, PIR definitions)
- **State:** Cloudflare Durable Objects (session management)
- **AI:** Cloudflare Workers AI (embeddings, small models)
- **Network:** Cloudflare global network (edge <10km from São Paulo)

**LLM APIs:**

- **Claude API:** Complex reasoning, protocol interpretation
- **OpenAI GPT-4:** Document generation, medical writing
- **Local Models:** Llama 3.3 70B, Qwen 2.5 32B (via MLX)
- **Specialized:** Fine-tuned medical models (future)

**Speech-to-Text:**

- **ElevenLabs API v2:** Medical-grade PT-BR transcription
- **Groq Whisper:** Fast alternative
- **Local Whisper:** Privacy-sensitive scenarios

**Protocols:**

- **FHIR:** Interoperability standard (EVIDENCE format)
- **HL7:** Device integration (vital signs monitors)
- **Bluetooth LE:** Device connectivity

---

## 3. Validated UX Pattern: Google Sheets Success (2023)

**Historical Context:** Before LLMs, before Voither theory, a practical solution was deployed using Google Sheets.

**Problem:** UPA observation bed management chaos

- No visibility of patient status
- Manual Kanban calculations (error-prone)
- Poor handoffs between professionals
- Incomplete referrals to regulators

**Solution:** Automated Google Sheets dashboard

```
Features:
✅ CPF lookup → Auto-fill patient data (prevents duplicates/typos)
✅ Dropdown lists → Zero free-text errors
✅ Automatic Kanban calculation → Color-coded by elapsed time
✅ Single free-text field → "What's missing to resolve case?"
✅ TV displays in corridors → Public visibility for all staff
✅ Analytics via timed screenshots → Historical series without DB
```

**Implementation:**

```javascript
// Google Sheets formulas (pseudo-code)
function kanbanColor(entryTime) {
  const elapsed = now() - entryTime;
  if (elapsed < 6h) return "GREEN";
  if (elapsed < 12h) return "YELLOW";
  if (elapsed < 24h) return "ORANGE";
  return "RED";
}

function lookupPatient(cpf) {
  // VLOOKUP to master patient database
  return patientDB.query(cpf);
}
```

**Results:**

- **Week 1:** Deployed in single UPA
- **Week 2:** Creator went on vacation
- **Week 3:** Returned to find **5 UPAs using the system** (organic viral adoption)
- **Impact:** Zero bed availability issues, improved referral quality, nurse satisfaction (quote: "Sebastião always praised what I did")

**Key Success Factors:**

1. **Zero additional workload:** Automation eliminated tasks, didn't add them
2. **Plug-and-play UX:** Minimal training required (visual learning via TV displays)
3. **Immediate value:** Professionals saw benefit in first use
4. **No institutional mandate:** Bottom-up adoption by enthusiastic users
5. **Solved real pain:** Addressed actual workflow friction, not theoretical problems

**Voither Evolution Path:**

```
Google Sheets (2023) → Voither (2025)
─────────────────────────────────────
CPF typed manually → Patient identified (voice/token)
Dropdown lists → LLM extracts from conversation
"What's missing?" field → LLM auto-summarizes
Kanban formula → ROE orchestrates next steps
TV display → Adaptive interface by role
30min screenshot analytics → Real-time event stream
```

**Critical Lesson:** The system succeeded because it **eliminated friction**, not because it was technologically sophisticated. Voither must maintain this principle.

---

## 4. Theoretical Frameworks & Mathematical Foundations

### 4.1 Submodular Optimization for Slot Auto-Complete

**Problem:** Given incomplete patient data, which questions/actions maximize information gain at minimum cost?

**Formulation:**

```
SLOTS = {chief_complaint, vital_signs, history, labs, ...}
ACTIONS = {ask_question, measure_device, query_record, order_test}

Each action a has:
- cost(a): Time, money, discomfort
- covers(a): Set of SLOTS filled by action a

Goal: Find minimum-cost set of actions covering all required SLOTS
```

**Submodular Property:**

```
f(A ∪ {e}) - f(A) ≥ f(B ∪ {e}) - f(B) for all A ⊆ B

Intuition: Diminishing returns - adding action e to small set A
provides more value than adding to larger set B
```

**Greedy Algorithm:**

```python
def auto_complete_slots(pir_slots, patient_state):
    covered = set()
    actions = []

    while not all_required_covered(covered, pir_slots):
        # Greedy: Pick action with best VoI/cost ratio
        best_action = argmax(
            VoI(a, covered, pir_slots) / cost(a)
            for a in available_actions
        )

        actions.append(best_action)
        covered.update(best_action.covers())

    return actions

# Guarantee: Solution is at least (1 - 1/e) ≈ 63% of optimal
```

**Value of Information (VoI):**

```python
def calculate_voi(slot, current_state, pir):
    """
    VoI measures expected improvement in decision quality
    """
    # What decisions depend on this slot?
    dependent_decisions = pir.find_dependencies(slot)

    # Estimate probability that filling slot changes decision
    p_decision_changes = estimate_decision_sensitivity(slot)

    # Estimate utility gain from better decision
    expected_utility_gain = calculate_expected_gain(slot)

    return p_decision_changes * expected_utility_gain
```

---

### 4.2 Min-Cost Flow for Team Orchestration

**Problem:** Assign TASKS to team members (reception, nursing, doctor, etc.) minimizing total time while respecting precedences.

**Network Flow Formulation:**

```
Nodes:
- Source: Workflow start
- Task nodes: Each TASK in PIR
- Team nodes: Each professional/role
- Sink: Workflow complete

Edges:
- Source → Tasks (capacity: 1)
- Tasks → Teams (capacity: team_availability, cost: task_time[team])
- Teams → Sink (capacity: ∞)

Precedences:
- Task A must complete before Task B → Edge A → B with cost 0

Objective: Minimize total flow cost (= total time)
```

**Example:**

```python
tasks = {
    "vital_signs": {
        "can_be_done_by": ["nursing", "tech"],
        "time": {"nursing": 5, "tech": 7},
        "precedence": []
    },
    "ecg": {
        "can_be_done_by": ["tech"],
        "time": {"tech": 10},
        "precedence": ["vital_signs"]
    },
    "medical_exam": {
        "can_be_done_by": ["doctor"],
        "time": {"doctor": 15},
        "precedence": ["vital_signs", "ecg"]
    }
}

# Min-cost flow finds optimal assignment respecting precedences
solution = min_cost_flow(tasks, team_availability)
# Result: nursing→vital_signs (5min) || tech→ecg (10min) → doctor→exam (15min)
# Total: max(5+10, 15) = 15min (parallelized)
```

---

### 4.3 Receding Horizon Control (RHC)

**Problem:** Make real-time decisions as new information arrives, respecting constraints and deadlines.

**Principle:**

```
At time t:
1. Predict patient state over horizon [t, t+H]
2. Optimize action sequence over this window
3. Execute ONLY first action
4. Observe result
5. Move to t+1, repeat (horizon "recedes")
```

**Advantages:**

- Adapts to new information (patient says something unexpected)
- Respects hard constraints (GUARDS Γ)
- Balances immediate vs. future rewards
- Computationally tractable (optimize over window, not entire future)

**Horizon Selection:**

```python
def adaptive_horizon(context):
    if context.urgency == "emergency":
        return 5_minutes  # Short horizon, aggressive action
    elif context.urgency == "urgent":
        return 30_minutes  # Medium horizon
    else:
        return 2_hours  # Long horizon, optimize throughput
```

---

### 4.4 Multi-Armed Bandits for Action Selection

**Problem:** Choose which question to ask or test to order when VoI is uncertain.

**Exploration vs. Exploitation:**

- **Exploit:** Choose action with highest known VoI
- **Explore:** Try uncertain actions to learn their VoI

**Upper Confidence Bound (UCB) Algorithm:**

```python
def select_next_action(actions, history):
    for action in actions:
        # Estimate VoI from past observations
        estimated_voi = mean(history[action].voi)

        # Confidence bonus (higher for rarely-tried actions)
        n_total = sum(history[a].count for a in actions)
        n_action = history[action].count
        confidence = sqrt(2 * log(n_total) / n_action)

        # UCB score balances estimate and uncertainty
        ucb_score = estimated_voi + confidence

    return argmax(ucb_score)
```

**Contextual Bandits:**

VoI may depend on patient context (age, sex, presenting complaint). Contextual bandits learn `VoI(action | context)`.

---

### 4.5 Formal Verification of GUARDS (Γ)

**Challenge:** Verify safety invariants in real-time (<100ms latency).

**Representation Options:**

A. **First-Order Logic:**
```
Γ: ∀ patient. (pregnant(patient) ∧ prescribe(medication_X, patient)) → false
```

B. **Domain-Specific Language:**
```javascript
guard("no_contraindication") {
  if (patient.pregnant && medication.category === "X") {
    block();
    suggest("Consider alternative: medication_Y");
  }
}
```

C. **SMT Solver:**
```smt2
(declare-const pregnant Bool)
(declare-const med_category String)
(assert (=> (and pregnant (= med_category "X")) false))
(check-sat)  ; UNSAT = violation detected
```

**Conflict Resolution:**

```python
def resolve_guard_conflicts(guards):
    """
    Example: Pregnant patient with severe infection
    Γ1: "Pregnant → Don't prescribe antibiotic_X"
    Γ2: "Severe infection → Must prescribe antibiotic_X"
    """
    if conflicts_detected(guards):
        # Rank by priority
        critical = [g for g in guards if g.priority == "life_threatening"]
        important = [g for g in guards if g.priority == "serious_harm"]

        # Apply highest priority, flag conflict for human review
        return {
            "action": apply(critical[0]),
            "alert": "CONFLICT: Requires physician override",
            "explanation": generate_reasoning(guards)
        }
```

---

## 5. Critical Gaps & Open Questions

### 5.1 PIR Compilation

**Status:** Theory exists, implementation path unclear

**Open Questions:**

1. Can LLMs reliably extract PIR structure from PDF protocols?
   - What error rate is acceptable? (Target: <5% structural errors)
   - How to validate compiled PIR before deployment?
   - Feedback loop: When PIR execution fails, how to improve compiler?

2. Multi-source PIR composition:
   - Protocol says X, local guideline says Y, specialist preference says Z
   - How to merge/prioritize these sources?

**Proposed Experiment:**

```
Input: Manchester Triage Protocol (PDF)
Process: Claude API extracts PIR JSON
Validation: Medical expert reviews extracted rules
Metric: Structural accuracy, completeness
Timeline: 2-3 hours to test feasibility
```

---

### 5.2 Multi-LLM Orchestration

**Status:** Conceptual architecture defined, dependencies unclear

**Unresolved Questions:**

1. **When do LLMs run?**
   - During conversation (real-time)?
   - After each sentence?
   - At end of encounter?

2. **Dependency Management:**
   ```
   LLM1 (Extract) → LLM2 (Risk) → LLM3 (Protocol)
   ```
   - Does ROE wait for full dependency chain?
   - Can partial results be used (streaming)?

3. **Latency Budget:**
   ```
   Target: Professional doesn't notice delay
   Threshold: <500ms response time

   Current Reality:
   - STT: ~200ms
   - LLM (local 70B): 1-3s
   - LLM (API): 2-5s

   Problem: Exceeds threshold
   ```

4. **Conflict Aggregation:**
   - Statistical voting?
   - Conservative (max risk)?
   - Weighted by model confidence?

**Proposed Experiment:**

```
Simulate triage with 3 parallel LLMs:
- LLM1: Data extraction (local Llama)
- LLM2: Risk calculation (local Qwen)
- LLM3: Protocol matching (Claude API)

Measure:
- Total latency (parallel vs. sequential)
- Agreement rate between LLMs
- Conflict resolution accuracy
```

---

### 5.3 Patient Data Flow (Technical Implementation)

**Status:** Paradigm defined, mechanism undecided

**Critical Decisions:**

1. **How does patient present data at facility?**
   - App on phone?
   - NFC card?
   - QR code?
   - Biometric + DHT lookup?

2. **Where is data stored during visit?**
   - Temporarily on Mac Mini?
   - Streamed from patient device?
   - Cached in facility database?

3. **Inter-facility synchronization:**
   - Patient visits UPA A, then UPA B
   - How does UPA B get UPA A's encounter data?
   - Edge propagation? Patient-mediated sync?

**Proposed Decision Framework:**

```
Phase 1 (Pilot): Simple centralized approach
- Patient has mobile app
- Data syncs to Cloudflare R2 (encrypted)
- Facility retrieves from R2 with patient auth
- Advantage: Proven technology, fast implementation

Phase 2 (Scale): Decentralized approach
- Patient data in local wallet
- Facility WiFi connection for data transfer
- Edge replication for multi-facility coordination
- Advantage: True data sovereignty, LGPD compliance
```

---

### 5.4 VoI Learning & Cold Start

**Status:** Mathematical framework defined, learning signal unclear

**Open Questions:**

1. **What signal trains VoI?**
   - Outcome-based (days later, hard to attribute)
   - Proxy-based (workflow completion time, immediate)
   - Professional feedback (subjective but valuable)

2. **Cold start problem:**
   - First patient has no VoI history
   - Expert-defined weights?
   - Transfer learning from other facilities?

3. **Exploration-exploitation balance:**
   - Always asking "best" questions → Never learn about alternatives
   - Need exploration, but can't compromise patient care

**Proposed Approach:**

```python
# Hybrid VoI estimation
def estimate_voi(slot, context, history):
    if history.count(slot, context) < 10:
        # Cold start: Use expert prior
        return expert_voi_table[slot][context]
    else:
        # Learned: Weighted average of expert and data
        expert_weight = 0.3
        data_weight = 0.7

        expert_voi = expert_voi_table[slot][context]
        learned_voi = history.estimate_voi(slot, context)

        return expert_weight * expert_voi + data_weight * learned_voi
```

---

### 5.5 Regulatory Compliance

**Status:** Acknowledged as critical, not yet addressed

**Requirements:**

1. **LGPD (Brazilian GDPR):**
   - Patient consent management
   - Right to access data
   - Right to erasure
   - Data minimization
   - Purpose limitation

2. **CFM/CRM (Medical Councils):**
   - Physician responsibility for AI suggestions
   - Audit trail of clinical decisions
   - Override mechanism for AI recommendations
   - Professional licensing integration

3. **e-SUS/RNDS (Brazilian Health System):**
   - Integration with national health record
   - Standardized data formats (FHIR)
   - Vaccination records
   - Notifiable disease reporting

4. **Digital Signature (ICP-Brasil):**
   - Legally valid prescriptions
   - Medical certificates
   - Referrals

**Critical Question from Conversation:**

> "How does CRM audit if data is with patient, not hospital?"

**Potential Solution:**

```
Immutable audit trail (EVIDENCE) stays with patient
CRM audit request → Patient provides encrypted audit log
Auditor verifies with patient's consent
Log is FHIR-compatible and cryptographically signed
```

---

## 6. Implementation Priorities & Decision Points

### 6.1 Foundational vs. Optimization Components

**Conversation Conclusion:**

The initial theoretical architecture (full ROE + RRE + RMS + PIR + MDL) is over-engineered for initial validation.

**Essential Components:**

1. ✅ **PIR (simplified):** Protocol → Executable JSON
2. ✅ **Event Stream:** Audit trail + learning data
3. ✅ **LLM Orchestrator:** Coordinate specialized agents
4. ✅ **State Manager:** Patient data handling

**Optimization Components (Defer):**

1. ❌ **MDL:** Storage compression (not a bottleneck)
2. ❌ **Durée Vector:** Sophisticated time modeling (LLMs handle contextual relevance)
3. ❌ **Full RRE:** Formal operators (LLMs provide semantic reasoning; keep only Γ injection)

**Simplified Architecture:**

```
┌─────────────────────────────────────┐
│  1. PROTOCOL COMPILER               │
│  PDF/Text → PIR JSON                │
│  (LLM-assisted compilation)         │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  2. LLM ORCHESTRATOR                │
│  - STT → Text                       │
│  - Parallel agent dispatch          │
│  - Result aggregation               │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  3. EVENT STREAM                    │
│  - Local: Encrypted patient log     │
│  - Aggregated: Pattern learning     │
│  - Audit: FHIR-compatible           │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  4. STATE MANAGER                   │
│  - Patient data encryption          │
│  - Access control                   │
│  - Inter-service sync               │
└─────────────────────────────────────┘
```

---

### 6.2 Experimental Validation Path

**Hypothesis-Driven Development:**

Rather than building the complete architecture, validate core assumptions through experiments:

**Experiment 1: PIR Compilation Feasibility**

```
Input: Manchester Triage Protocol (PDF)
Process: LLM extracts PIR JSON structure
Validation: Medical expert reviews accuracy
Success Criteria: >90% structural accuracy
Timeline: 2-3 hours
Learning: Can LLMs be PIR compilers?
```

**Experiment 2: Edge Latency**

```
Setup: Cloudflare Worker (São Paulo edge)
Test: Round-trip latency (Mac → Worker → Claude API → Worker → Mac)
Success Criteria: <500ms total
Timeline: 1 hour
Learning: Is edge compute viable for real-time assistance?
```

**Experiment 3: MongoDB Pattern Learning**

```
Data: 100 synthetic triage cases
Process: Extract patterns without PHI
Store: MongoDB aggregated patterns
Query: "For chest pain, what red flags to look for?"
Success Criteria: System "remembers" patterns
Timeline: 3 hours
Learning: Is MongoDB suitable for RMS?
```

**Experiment 4: Multi-Agent Orchestration**

```
Input: Synthetic triage audio
Agents: 3 LLMs in parallel (extraction, risk, protocol)
Measure: Total latency, agreement rate
Success Criteria: <3s total, >85% agreement
Timeline: 4 hours
Learning: Does parallel orchestration work?
```

---

### 6.3 Minimum Viable Foundation (MVF)

**Goal:** Replicate Google Sheets success with LLMs (voice-enabled, automated)

**Scope:**

```
Workflow: UPA observation bed management
Input: Professional speaks to patient
Process:
  1. STT transcribes conversation
  2. LLM extracts: name, age, complaint, vital signs
  3. System calculates Kanban color
  4. Auto-generates "what's missing?" summary
  5. Updates display (web interface, not Google Sheets)
Output: Dashboard visible to all staff
```

**Components:**

- **Frontend:** Simple web app (React/Vue)
- **Backend:** Cloudflare Worker
- **STT:** ElevenLabs API
- **LLM:** Claude API (extraction + summarization)
- **Storage:** MongoDB Atlas (session data)
- **Display:** Real-time updates via WebSocket

**Success Criteria:**

- Professional speaks, data auto-fills (no typing)
- Kanban color updates automatically
- Staff can see patient status at a glance
- System faster than manual entry

**Non-Goals (for MVF):**

- ❌ Full PIR execution
- ❌ Multi-agent orchestration
- ❌ Patient data sovereignty (use test data)
- ❌ Edge processing (cloud acceptable for MVP)
- ❌ Offline operation

**Timeline Avoided:** As per conversation feedback, no timeline imposed. Development proceeds based on validation, not calendar.

---

## 7. Key Architectural Insights from Conversation

### 7.1 "Some Resources Can Be Computed by LLMs, But Require Invisible Simultaneous Actions"

**Quote from conversation:**

> "Não é possível [introduzir variáveis não solicitadas], é por isso que alguns recursos, por mais que possam ser computados por LLMs, exigem aquelas ações simultâneas invisíveis que envolvem histórico de protocolo, fluxo de tarefa, ação e assim por diante."

**Interpretation:**

LLMs provide semantic intelligence, but clinical workflows require orchestration infrastructure that:

1. **Enforces invariants (Γ)** that LLMs might overlook
2. **Tracks multi-step state** across encounters
3. **Coordinates parallel actions** (labs, imaging, referrals)
4. **Maintains audit trail** for regulatory compliance
5. **Optimizes resource allocation** (which team member, when)

**Example:**

```
LLM: "Patient has chest pain, suggests ECG"
✅ Correct semantic inference

ROE:
- Checks Γ: Patient has pacemaker? (ECG interpretation differs)
- Checks availability: Tech available now? Queue if not
- Triggers parallel: While ECG running, prep troponin lab
- Logs evidence: All decisions recorded for audit
- Updates PIR state: ECG_PENDING → ECG_COMPLETE

❌ LLM alone cannot handle this orchestration
```

**Conclusion:** ROE/RRE are **necessary infrastructure**, not redundant abstractions.

---

### 7.2 "Google Sheets Worked, So Why Overengineer?"

**Tension in conversation:**

Initial proposal was to build full ROE + RRE + RMS + PIR + MDL. Response challenged: "Google Sheets worked perfectly with zero MDL, zero Durée Vector, zero formal operators."

**Resolution:**

- **Google Sheets validated UX pattern:** Zero friction, automatic calculations, public visibility
- **LLMs enable conversational input:** Replace dropdowns with natural speech
- **ROE enables protocol execution:** Replace static formulas with dynamic workflows
- **RMS enables learning:** Replace screenshot-based analytics with proper event stream

**But:**

- MDL is premature optimization
- Durée Vector is academic elegance without proven necessity
- Full RRE operators can be replaced by LLM reasoning + simple Γ injection

**Pragmatic Architecture:**

```
Proven (2023): UX pattern from Google Sheets
New (2025): Voice input via LLMs
Enhanced (2025): Protocol auto-execution via simplified ROE
Future (post-pilot): Optimization components only if validated as bottlenecks
```

---

### 7.3 Rhizomatic Networks vs. Hierarchical Systems

**Traditional Healthcare IT:**

```
Hierarchical Flow:
UBS → UPA → Hospital → ICU
(Linear escalation path)

Data Flow:
Local database → Regional database → National database
(Centralized aggregation)
```

**Voither Vision:**

```
Rhizomatic Flow:
Patient moves non-linearly through network
UPA ↔ UBS ↔ Specialist ↔ Emergency ↔ Home Care
(Any-to-any connections based on clinical need)

Data Flow:
Data with patient → Accessed where patient presents
Edge nodes coordinate → No central authority
(Distributed, patient-centric)
```

**Implication for Architecture:**

- Cannot assume hierarchical referral paths in PIR
- Cannot rely on centralized database for patient history
- Must support offline operation (network partition tolerance)
- Synchronization is eventual, not immediate
- Context must include "patient journey through network," not "position in hierarchy"

**Technical Challenge:**

> "Como rola a comunicação entre serviços? É aí que entra o Edge da Cloudflare. Eu não preciso mandar esse negócio para a estrutura local, no Edge, e não para a nuvem."

Edge coordination enables rhizomatic communication without centralized control.

---

### 7.4 Auto-Updating PIR as Competitive Moat

**Traditional Systems:**

```
New guideline published
→ Vendor codes update (months)
→ Hospital pays for upgrade
→ Staff trained on changes (weeks)
→ Compliance audited (months later)
```

**Voither Vision:**

```
New guideline published (PDF)
→ PIR compiler ingests (hours)
→ Hot-reload to edge nodes (minutes)
→ Next patient automatically gets updated protocol
→ Zero staff training required
→ Immediate compliance
```

**Example:**

> "A partir de 2026, triagem deve coletar histórico de vacinação COVID-19."
> PIR updates automatically, next triage collects vaccination data.

**Competitive Advantage:**

- **Speed to compliance:** Days vs. months
- **Zero training cost:** Protocols update silently
- **Adaptability:** Local customization without vendor involvement
- **Evidence-based:** PIR learns from outcomes, not just rules

**Technical Requirement:**

PIR must be:
- Version-controlled (rollback if errors)
- Diffable (identify what changed)
- Mergeable (combine hospital policy + SUS guideline + local protocol)
- Validated (expert review before auto-deployment)

---

## 8. Conversational Context & Meta-Insights

### 8.1 Evolution of Understanding Through Dialogue

**Initial State:**

Claude: "Let me build a simple triage API with MongoDB and Claude"
Gus: "No, this is about invisible automation during natural conversation"

**Mid-Conversation:**

Claude: "ROE/RRE are overengineered, LLMs can do this"
Gus: "Some things require formal orchestration, not just semantic reasoning"

**Final State:**

Claude: "Understood. ROE/RRE necessary but simplified. PIR is foundation. MDL is optional."

**Key Turning Point:**

Sharing the Google Sheets story proved the UX vision was **already validated in production**. This shifted the conversation from "will this work?" to "how do we evolve what already works?"

---

### 8.2 Intellectual Property & Motivation

**Quote:**

> "Disse que não implementaria isso de graça, que valia milhões e que passaria os próximos anos arquitetando um sistema exatamente como eu fiz. E aqui está o resultado."

**Context:**

- This is not an academic exercise
- Validated product-market fit (5 UPAs organic adoption)
- Resignation from position to pursue full-time development
- Multi-year theoretical foundation building
- Clear commercial intent (SaaS model, ~R$300M/year potential at scale)

**Implication for Documentation:**

This knowledge represents proprietary IP. Documentation should:
- Capture theoretical foundations (defensible differentiation)
- Record architectural decisions (avoid rework)
- Identify open questions (prioritize experiments)
- NOT include: Placeholder code, generic advice, unvalidated assumptions

---

### 8.3 Language & Cultural Context

**Conversation Language:** Portuguese (Brazilian medical/technical terminology)

**Key Terms Preserved:**

- **UPA:** Unidade de Pronto Atendimento (Emergency Care Unit)
- **UBS:** Unidade Básica de Saúde (Primary Care Unit)
- **SUS:** Sistema Único de Saúde (Brazilian Public Health System)
- **LGPD:** Lei Geral de Proteção de Dados (Brazilian GDPR)
- **CFM/CRM:** Medical regulatory councils
- **e-SUS/RNDS:** National health record systems
- **Triagem:** Triage (risk-based patient prioritization)
- **Regulação:** Patient transfer coordination system

**Geographic Context:**

- São Paulo, Brazil
- <10km from Cloudflare edge node
- 1Gbps fiber internet
- Apple Silicon (M1/M4) hardware availability
- Portuguese (PT-BR) speech recognition required

---

## 9. Next Steps & Prioritization Framework

### 9.1 Critical Path Items

**Before any code:**

1. **Define patient data flow mechanism**
   - Decision: Mobile app? NFC? QR code?
   - Impacts: All component interfaces
   - Blocker: Cannot build State Manager without this

2. **PIR format specification**
   - Decision: JSON schema for PIR
   - Impacts: Protocol compiler, ROE interpreter
   - Blocker: Cannot build Protocol Compiler without this

3. **Regulatory compliance strategy**
   - Decision: How to handle e-SUS integration, digital signatures
   - Impacts: EVIDENCE format, audit trail
   - Blocker: Pilot deployment impossible without this

**First experiments:**

1. **PIR compilation test** (Experiment 1 above)
2. **Edge latency test** (Experiment 2 above)
3. **Multi-LLM orchestration** (Experiment 4 above)

**First buildable component:**

**Protocol Compiler** (if experiments validate feasibility)

---

### 9.2 Risk Mitigation

**Technical Risks:**

1. **Latency:** LLMs too slow for real-time conversation
   - Mitigation: Smaller specialized models, speculative execution

2. **Accuracy:** LLM hallucinations cause clinical errors
   - Mitigation: GUARDS verification, human-in-loop, shadow mode testing

3. **Complexity:** Distributed system too hard to debug
   - Mitigation: Start simple (cloud-first), migrate to edge incrementally

**Adoption Risks:**

1. **Professional skepticism:** "Another system to learn"
   - Mitigation: Replicate Google Sheets UX (zero training required)

2. **Regulatory barriers:** CFM/LGPD block deployment
   - Mitigation: Early engagement with regulatory bodies

3. **Vendor lock-in perception:** "Dependent on Anthropic/OpenAI"
   - Mitigation: Use local models where possible, LLM abstraction layer

**Business Risks:**

1. **Pilot failure:** 11 municipalities reject system
   - Mitigation: Start with 1 municipality that trusts creator

2. **Scaling challenges:** Works for 100 patients/day, fails at 10,000
   - Mitigation: Edge architecture designed for horizontal scaling

---

### 9.3 Success Metrics

**Technical Validation:**

- PIR compilation accuracy: >90%
- End-to-end latency: <500ms
- LLM agreement rate: >85%
- System uptime: >99.9%
- Offline capability: Full workflow without internet

**UX Validation:**

- Professional setup time: <10 minutes
- Data entry time reduction: >80%
- Nursing satisfaction: >4.5/5
- Viral adoption: Unprompted spread to adjacent facilities

**Clinical Validation:**

- Triage accuracy: ≥Manchester protocol standard
- Adverse event rate: ≤Current standard of care
- Time to treatment: Reduced vs. baseline
- Documentation completeness: >95%

**Business Validation:**

- Cost per facility: <R$10,000/month
- Professional time saved: >2 hours/day
- ROI for municipality: <12 months
- Customer retention: >90% annual

---

## 10. Conclusion & Philosophical Foundation

### The Core Insight

Voither is not fundamentally a "healthcare AI" play. It's a **friction elimination** play that happens to use AI.

The validated insight: **Professionals want to focus on patients, not systems.** Any technology that stands between professional and patient is friction. Any technology that works invisibly alongside the professional is assistance.

Google Sheets succeeded because it eliminated work (automatic calculations, dropdown lists). Voither succeeds by extending that principle to natural conversation: the professional talks to the patient, the system listens and handles everything else.

### The Technical Challenge

The hard parts are not the LLMs (commoditized) or the infrastructure (proven). The hard parts are:

1. **Orchestration:** Coordinating multiple specialized LLMs with formal safety guarantees
2. **Protocol Compilation:** Transforming unstructured medical knowledge into executable workflows
3. **Distributed State:** Patient data sovereignty without centralized coordination
4. **Real-time Constraints:** Sub-second latency for conversational flow

These are solvable with the proposed architecture (PIR + ROE + simplified RRE + RMS).

### The Strategic Opportunity

Healthcare IT incumbents (Epic, Cerner) built for a pre-LLM world. Their architecture assumes:
- Data in centralized servers
- Professionals use keyboards/mice
- Protocols are hard-coded
- Updates require vendor involvement

Voither inverts all of these assumptions, creating architectural leverage that incumbents cannot easily replicate.

The window is now: LLMs are capable enough (2025), but incumbents are still adapting. First-mover advantage goes to the architecture that assumes LLMs from the ground up.

---

**END OF KNOWLEDGE EXTRACT**

**Metadata:**
- **Conversation Length:** ~3,370 lines
- **Technical Depth:** High (mathematical formalism, distributed systems, clinical workflows)
- **Theoretical Completeness:** 70% (PIR/ROE/RRE/RMS defined, implementation details open)
- **Validation Status:** UX pattern validated (2023), technical architecture unproven
- **Next Milestone:** Experimental validation of core hypotheses
