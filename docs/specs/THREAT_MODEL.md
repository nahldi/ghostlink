# GhostLink Threat Model

**Date:** 2026-04-07
**Scope:** Concrete abuse paths and required controls for a multi-agent orchestration system
**Companion docs:** `PRODUCTIZATION_GUARDRAILS.md` (product/infra policy), `RAILWAY_OPTIONAL_STRATEGY.md` (deployment boundaries)
**Source framework:** OWASP Top 10 for Agentic Applications (December 2025)

---

## 1. OWASP Agentic Risk Coverage

The OWASP Top 10 for Agentic Applications defines the industry-standard threat taxonomy. GhostLink must address all 10. Current status assessed against live codebase.

| # | OWASP Risk | GhostLink Status | Gap |
|---|-----------|-----------------|-----|
| 1 | Agent Goal Hijack | Partial — SOUL injection exists but no validation on inbound context | Need: input sanitization on injected context, @mention content validation |
| 2 | Tool Misuse | Partial — `ExecPolicy` gates shell commands, `pre_tool_use` hook is fail-closed | Need: MCP tool call policy (not just shell), parameter validation on high-risk tools |
| 3 | Identity & Privilege Abuse | Partial — bearer tokens per agent, token rotation | Need: per-agent capability scoping, delegation trust boundaries |
| 4 | Rogue Agents | Minimal — no behavioral baseline or anomaly detection | Need: anomaly detection (unusual tool patterns, cost spikes, loop detection) |
| 5 | Supply Chain | Partial — `SafetyScanner` for plugins, import allowlisting | Need: plugin signing, provenance metadata, checksum verification on load |
| 6 | Memory Poisoning | Minimal — no validation on memory writes | Need: memory write scanning, PII detection, TTL expiration, per-agent isolation |
| 7 | Insecure Communications | OK for local — all agent traffic is localhost HTTP | Need: signed inter-agent messages for any remote/Railway scenario |
| 8 | Cascading Failures | Partial — circuit breakers planned in Phase 4A | Need: agent-level circuit breakers, cascading error propagation detection |
| 9 | Code Execution | Partial — `ExecPolicy` with command allowlists, sandbox modes | Need: OS-native sandbox enforcement, subprocess inheritance |
| 10 | Data Exfiltration | Minimal — no egress monitoring | Need: MCP tool egress allowlists, secret redaction in tool outputs |

---

## 2. Concrete Abuse Paths

### 2.1 Memory Poisoning

**Attack:** A compromised or manipulated agent writes malicious content to persistent memory (`memory_save`). Future sessions load this poisoned memory, corrupting agent behavior permanently.

**Current exposure:** `agent_memory.py` writes to JSON files with no content validation. Any agent can write any content to its own memory. Cross-agent memory search (`search_all_memories`) makes poisoned memories discoverable by other agents.

**Required controls:**
- Scan memory writes for injection patterns (prompt injection markers, system prompt overrides)
- PII detection on memory content (prevent agents from storing user secrets in searchable memory)
- Memory TTL — configurable expiration for volatile facts vs durable knowledge
- Per-agent memory namespace isolation — one agent's memory writes should not be editable by another agent
- Memory integrity checksums — detect tampering of on-disk memory files

**Roadmap phase:** Phase 4A (policy engine) + Phase 6 (memory stratification)

### 2.2 Prompt/Tool Supply Chain

**Attack:** A malicious MCP tool, plugin, or injected instruction file (`.claude/instructions.md`, `.codex/instructions.md`) alters agent behavior. The agent follows the malicious instructions because they appear in a trusted injection path.

**Current exposure:** `wrapper.py:943-995` writes instruction files to the agent's workspace. These files are readable and writable by any process with filesystem access. No signing, no integrity verification.

**Required controls:**
- Sign instruction files with HMAC using a per-session key — agent CLI reads the file but GhostLink can verify it hasn't been tampered with
- Plugin manifest signing — plugins must be signed by a known publisher, checksum verified on load
- MCP tool provenance — track which MCP server provided each tool, log tool source in audit trail
- Instruction file write protection — mark injected files as read-only after write

**Roadmap phase:** Phase 4A (policy engine, hook signing)

### 2.3 Delegation Trust Boundary Escalation

**Attack:** A restricted agent (e.g., read-only reviewer) delegates to a more privileged agent (e.g., full-access coder), effectively escaping its restrictions.

**Current exposure:** The `delegate` MCP tool in `mcp_bridge.py:1594` sends a message to the target agent with delegation context. No check verifies that the delegating agent is permitted to access the target agent's capabilities. No `parent_agent_id` or trust chain is recorded.

**Required controls:**
- Delegation must carry the delegator's capability scope — the receiving agent inherits the INTERSECTION of its own capabilities and the delegator's, not its full capabilities
- Record `parent_agent_id` on delegated tasks for audit trail
- Block delegation from lower-trust to higher-trust agents unless explicitly permitted by operator policy
- Log all delegation events with full context (who, to whom, what capabilities, what scope)

**Roadmap phase:** Phase 2 (profiles/inheritance) + Phase 4A (policy engine)

### 2.4 Remote Control Plane Abuse (Railway scenario)

**Attack:** If GhostLink exposes any optional control-plane service on Railway, an attacker could exploit it to: enumerate agents, inject tasks, read memory, or trigger actions on the operator's local instance.

**Current exposure:** Not currently deployed, but planned as optional. The risk exists if implemented without proper controls.

**Required controls:**
- All remote control-plane endpoints require mutual authentication (not just API keys)
- Short-lived signed tokens (JWT with <15 minute expiry) for any remote action
- Remote endpoints are stateless — no sensitive state stored on Railway
- Rate limiting on all remote endpoints
- No remote endpoint can read local memory, souls, notes, or secrets — only metadata (agent names, status, health metrics)
- Remote compromise must be non-fatal for local operation

**Roadmap phase:** Phase 8.5 (productization) per `RAILWAY_OPTIONAL_STRATEGY.md`

### 2.5 Secret Exfiltration via Tool Calls

**Attack:** An agent uses `web_fetch`, `chat_send`, or a custom MCP tool to exfiltrate secrets from its environment (API keys, tokens, configuration) to an external endpoint.

**Current exposure:** `SecretsManager` in `security.py` stores secrets encrypted at rest, but once loaded into env vars for agent spawn, the agent CLI has full access. `web_fetch` has no domain restrictions. `chat_send` content is not scanned.

**Required controls:**
- Egress allowlist for `web_fetch` and any HTTP-making MCP tool — only whitelisted domains
- Secret pattern scanning on outbound tool call parameters (detect API key patterns, bearer tokens)
- `DataManager.export_all_data()` already redacts API keys (line 426) — extend this pattern to all outbound data paths
- Audit log every external HTTP request made by agents with destination, response code, and payload size

**Roadmap phase:** Phase 4A (egress controls, policy engine)

### 2.6 Founder-Coupling as Security Risk

**Attack vector:** Not an external attack — this is an architectural risk. If GhostLink ships with any of Finn's personal secrets, domains, or account references baked in, every install inherits that coupling. An attacker who reverse-engineers the repo could discover Finn's infrastructure.

**Current exposure:** `.ghostlink-context.md` in repo root contains test agent identity. `config.toml` may contain personal settings. `.env` files are gitignored but patterns could leak.

**Required controls (per PRODUCTIZATION_GUARDRAILS.md):**
- Pre-commit hook scanning for secret patterns (API keys, tokens, Railway URLs)
- No founder-owned domains in any shipped default
- `config.toml.example` instead of `config.toml` in repo
- Wizard generates fresh secrets on first install
- Grep the repo for any hardcoded URLs, tokens, or account IDs before any public release

**Roadmap phase:** Phase 8.5 (productization)

---

## 3. Anomaly Detection Thresholds

Based on OWASP Agentic Security Cheat Sheet recommendations, adapted for GhostLink:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Tool calls per minute per agent | > 30 | Log warning, alert operator |
| Failed tool calls per agent | > 5 in 5 minutes | Circuit breaker — pause agent, require operator resume |
| Prompt injection patterns detected | > 0 | Block the tool call, log full context, alert operator |
| Cost per session | > configurable limit | Pause agent, require operator approval to continue |
| Same tool called with same args | > 3 consecutive | Stuck-loop detection — pause, alert |
| Memory writes per minute | > 20 | Rate limit, log warning |
| External HTTP requests per minute | > 10 | Rate limit, require operator review |
| Agent runtime without heartbeat | > 45 seconds | Mark stale, deregister |

These thresholds should be configurable per-agent and per-workspace.

---

## 4. Signed Artifacts

For production-grade trust, these artifacts should support cryptographic signing:

| Artifact | Signing Method | Verification Point |
|----------|---------------|-------------------|
| Plugin manifests | HMAC-SHA256 with workspace key | Plugin load in `plugin_loader.py` |
| Agent instruction files | HMAC-SHA256 with per-session key | Agent CLI reads file |
| A2A Agent Cards | Asymmetric (Ed25519) | A2A discovery / `a2a_bridge.py` |
| Webhook payloads | HMAC-SHA256 with shared secret | Webhook receiver |
| Remote control-plane actions | JWT with short expiry | Control-plane endpoint handler |
| Memory exports | SHA-256 content hash | Import validation |

---

## 5. Defense-in-Depth Layers

```
Layer 1: Input validation (sanitize @mentions, injected context, memory writes)
Layer 2: Policy engine (per-tool approval, risk tiers, egress allowlists)
Layer 3: Sandbox (OS-native process isolation, managed proxy)
Layer 4: Audit (every action logged with full context, tamper-evident)
Layer 5: Anomaly detection (behavioral baselines, threshold alerts)
Layer 6: Circuit breakers (automatic pause on repeated failures or cost spikes)
Layer 7: Operator review (human-in-the-loop for high-risk actions)
```

GhostLink currently has layers 2 (partial), 4 (basic), 7 (approval interception). Layers 1, 3, 5, 6 are planned in Phase 4A. Layer completeness should be tracked on the OWASP compliance dashboard.

---

## Sources

- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit)
- [Security Patterns for Autonomous Agents](https://www.sitepoint.com/security-patterns-for-autonomous-agents-lessons-from-pentagi/)
- [Codex CLI Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)
