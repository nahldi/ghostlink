# Exhaustive AI Coding Agent Platform Survey

**Compiled:** 2026-04-06  
**Purpose:** Identify every feature, UX pattern, and capability GhostLink should consider incorporating  
**Methodology:** Web research across 40+ platforms, cross-referenced against product documentation, changelogs, and independent reviews

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Theme 1: Agent Architecture & Autonomy](#theme-1-agent-architecture--autonomy)
3. [Theme 2: Context & Memory Systems](#theme-2-context--memory-systems)
4. [Theme 3: Multi-Agent Orchestration](#theme-3-multi-agent-orchestration)
5. [Theme 4: Sandboxing & Security](#theme-4-sandboxing--security)
6. [Theme 5: Multi-Model & Provider Support](#theme-5-multi-model--provider-support)
7. [Theme 6: UX Innovations & Developer Experience](#theme-6-ux-innovations--developer-experience)
8. [Theme 7: Git & Version Control Integration](#theme-7-git--version-control-integration)
9. [Theme 8: Testing & Quality Assurance](#theme-8-testing--quality-assurance)
10. [Theme 9: Deployment & Hosting](#theme-9-deployment--hosting)
11. [Theme 10: Extensibility & Protocols](#theme-10-extensibility--protocols)
12. [Theme 11: Voice, Multimodal & Vision](#theme-11-voice-multimodal--vision)
13. [Theme 12: Collaboration & Team Features](#theme-12-collaboration--team-features)
14. [Theme 13: Cost Management & Token Economics](#theme-13-cost-management--token-economics)
15. [Theme 14: Offline & Local-First](#theme-14-offline--local-first)
16. [Theme 15: Custom Instructions & Rules](#theme-15-custom-instructions--rules)
17. [Theme 16: Approval Workflows & Safety](#theme-16-approval-workflows--safety)
18. [Platform-by-Platform Reference Cards](#platform-by-platform-reference-cards)
19. [GhostLink Competitive Gap Analysis](#ghostlink-competitive-gap-analysis)

---

## Executive Summary

The AI coding agent landscape as of April 2026 has consolidated around several paradigms:

1. **Multi-agent is table stakes.** Every major platform shipped multi-agent in February 2026. Running parallel agents on different parts of a codebase is now the minimum expectation.
2. **MCP is the universal connector.** With 97M+ monthly SDK downloads and adoption by every major AI provider, MCP has become the TCP/IP of AI tooling.
3. **AGENTS.md is the cross-tool standard.** Adopted by 60,000+ repositories, it provides a single instruction file that works across all agent platforms.
4. **A2A (Agent-to-Agent) protocol** from Google complements MCP by enabling agent-to-agent communication, not just agent-to-tool.
5. **Background/cloud agents** are the new frontier. Cursor 3, GitHub Copilot Coding Agent, and Codex all allow agents to work asynchronously while the developer does other things.
6. **4% of all public GitHub commits** (~135K/day) are now authored by Claude Code alone.
7. **Spec-driven development** is emerging as a paradigm where developers write specs and agents implement them.

### Key Takeaway for GhostLink

GhostLink's multi-agent desktop architecture is well-positioned, but must adopt: MCP as the primary extensibility mechanism, AGENTS.md as the universal project instruction format, A2A for inter-agent communication, background agent execution, and spec-driven development workflows.

---

## Theme 1: Agent Architecture & Autonomy

### Autonomy Spectrum

Platforms fall on a spectrum from "autocomplete" to "fully autonomous":

| Level | Description | Platforms |
|-------|-------------|-----------|
| **L1: Completion** | Inline suggestions, single-line | Supermaven (acquired by Cursor), Tabnine, early Copilot |
| **L2: Chat + Edit** | Conversational coding, single-file edits | Continue.dev Chat mode, Cody, Zed AI chat |
| **L3: Agentic Edit** | Multi-file coordinated changes with tool use | Cursor Composer, Windsurf Cascade, Copilot Agent Mode |
| **L4: Autonomous Agent** | Plans, executes, tests, iterates without intervention | Devin, Claude Code, Codex, Goose |
| **L5: Multi-Agent Teams** | Multiple autonomous agents coordinating together | Claude Code Agent Teams, Cursor 3, Grok Build, MetaGPT |

### How Each Platform Handles Autonomy

**Devin (L4-L5):** The most autonomous. Has its own IDE, shell, and browser running in the cloud. Breaks vague requirements into step-by-step plans. Devin v3.0 (2026) supports dynamic re-planning -- if it hits a roadblock, it changes strategy without human intervention. Can spin up multiple instances in parallel. Uniquely, Devin tests apps by actually clicking through the UI using computer use, then sends the developer an edited recording of the test session.

**Claude Code (L4-L5):** Agentic CLI with 14+ lifecycle hooks (SessionStart, PreToolUse, PostToolUse, PermissionRequest, SubagentStart, Stop). Agent Teams (launched Feb 2026) enable multiple independent sessions that coordinate, message each other, and divide work in parallel. Context editing (2026) automatically clears stale tool call outputs, cutting token consumption by 84%.

**Cursor (L3-L5):** Evolved from Composer (L3) to Cursor 3 (L5) with parallel agents across repos and environments. Background agents can run in the cloud while the developer works on other things. The `/best-of-n` command runs the same task in parallel across multiple models, each in its own isolated worktree, then compares outcomes.

**GitHub Copilot (L3-L4):** Agent mode determines which files need to change, makes edits across multiple files, runs terminal commands, and iterates until the task is complete. The Copilot Coding Agent (GA since September 2025) works asynchronously -- assign it an issue and it creates a PR.

**Codex CLI (L4):** Open-source, Rust-based. Runs locally with sandboxing enabled by default (Landlock + seccomp). Supports subagent workflows for parallelizing larger tasks. MCP integration via config.toml.

### Unique Autonomy Features Worth Noting

| Feature | Platform | Description |
|---------|----------|-------------|
| **Dynamic re-planning** | Devin | Changes strategy mid-execution when hitting roadblocks |
| **Computer-use QA** | Devin | Actually clicks through the app UI to test, sends recording |
| **Best-of-N** | Cursor 3 | Same task run in parallel across multiple models, outcomes compared |
| **Cloud-to-local handoff** | Cursor 3 | Move agent session from cloud to local and back |
| **Self-healing** | Copilot Agent | Recognizes errors, automatically fixes them, re-runs |
| **Context editing** | Claude Code | Automatically clears stale context, 84% token reduction |
| **Devin Wiki** | Devin | Machine-generated documentation of any codebase |
| **Devin Search** | Devin | Interactive search-and-answer engine to query code |

---

## Theme 2: Context & Memory Systems

### Context Window Approaches

Two fundamentally different philosophies exist:

**Pre-indexed (RAG-based):**
- **Cursor**: Scans project, chunks code using tree-sitter AST-aware splitters, stores vector embeddings. Re-syncs every ~5 minutes. Hybrid retrieval (AST/code graph + vector search) improves factual correctness by 8% over vector-only.
- **Windsurf**: Multi-layer context system from RAG-based codebase indexing to Cascade's real-time action tracking. Windsurf Flow updates AI context as you work, not just when you prompt it.
- **Augment Code**: Context Engine handles 400,000+ files. Builds comprehensive model of project architecture including source code, connected documentation, issue trackers, and communication channels.
- **Cody/Sourcegraph**: Sourcegraph Search pulls context from local and remote repositories. Understands relationships across entire enterprise-scale codebases spanning multiple repos.

**Runtime exploration (no index):**
- **Claude Code**: No index at all. The model explores the codebase at runtime using grep, glob, and file reads. This avoids stale index problems but costs more tokens.
- **Aider**: Builds a compact "repo map" of the entire repository so the LLM understands the architecture, but doesn't use traditional vector embeddings.

### Memory Persistence Across Sessions

| Platform | Memory Mechanism | Persistence |
|----------|-----------------|-------------|
| **Claude Code** | CLAUDE.md files (project/user/folder level) | Git-tracked, survives sessions |
| **Windsurf** | Memories system -- save project context as Memory | Auto-loaded on every future session |
| **Cursor** | .cursorrules, Project Rules, User Rules | File-based, git-trackable |
| **Codex CLI** | AGENTS.md + config.toml | File-based |
| **Goose** | Built-in memory extension via MCP | Persisted across sessions |
| **Aider** | Git history as implicit memory | Every change is a commit |
| **Amazon Q** | Conversation history preserved between sessions | Searchable, exportable as markdown |
| **LangGraph** | Checkpoint store (Postgres/Redis) | Full state replay, time-travel debugging |
| **CrewAI** | Shared message pool | Per-workflow persistence |
| **Mastra** | Observational memory system (Feb 2026) | Agent learns from usage patterns |

### Innovative Memory Features

- **Windsurf's proactive memory**: The AI's context updates as you work in real-time, not just when you prompt it. This "Flow" concept means the agent is always aware of your recent edits.
- **LangGraph checkpointing**: After each node execution, saves complete graph state. Enables time-travel debugging (inspect/replay any previous state), fault tolerance, and human-in-the-loop pauses.
- **Amazon Q conversation export**: Export entire conversation history as markdown for documentation.
- **Augment's living specs**: Multiple agents share a "living spec" and coordinate around a single evolving plan.
- **Qodo 2.1 Rules System**: Persistent memory for code review -- stops making the same useless suggestions after being corrected.
- **Mastra observational memory**: Agent learns from developer usage patterns without explicit instruction.

---

## Theme 3: Multi-Agent Orchestration

### Architecture Patterns

**1. Role-Based Teams (CrewAI, MetaGPT, ChatDev)**

CrewAI assigns distinct roles: Manager, Worker, Researcher. Supports sequential, parallel, and conditional processing. Hierarchical coordination with senior agents overriding junior decisions.

MetaGPT simulates a complete software company: Product Manager, Architect, Engineer, QA. Uses Standard Operating Procedures (SOPs) to govern collaboration. Shared message pool (publish-subscribe) keeps communication clean and scalable. Hits 85.9% Pass@1 on code generation.

ChatDev v2.0 evolved from rigid virtual company structure to flexible zero-code orchestration platform. Puppeteer-style paradigm with learnable central orchestrator optimized via reinforcement learning.

**2. Graph-Based Workflows (LangGraph)**

Models workflows as directed graphs with explicit state. Each node performs a discrete operation. Centralized state acts as shared memory. Reducer-driven state schemas prevent data loss. TypeScript version has 42K+ weekly npm downloads. Persistence integrates directly with Postgres and Redis.

**3. Conversation-Based (AutoGen/Microsoft Agent Framework)**

AutoGen merged with Semantic Kernel to form Microsoft Agent Framework (MAF). Agents are "conversable" -- any agent can send/receive messages. Human-in-the-loop configurable. Typical enterprise: 5-12 agents (Planner, Researcher, Coder, Tester, Reviewer, Documenter, Human Approver).

**4. Swarm/Arena (Agency Swarm, OpenAI Swarm, Grok Build)**

OpenAI Agents SDK (production successor to Swarm) uses three primitives: Handoffs, Guardrails, Tracing. Grok Build's Arena Mode spawns up to 8 agents that compete, with outputs ranked algorithmically before human review.

**5. Agent Teams (Claude Code, Cursor 3)**

Claude Code Agent Teams: Multiple independent sessions coordinate, message each other, divide work. Distinction between subagents (isolated workers reporting to boss) and Agent Teams (collaborative squad).

Cursor 3: Each agent runs in its own Git worktree. Complete file isolation. Self-hosted cloud agents keep code in your own infrastructure.

**6. Flexible Frameworks (CAMEL, Mastra)**

CAMEL: Systems with millions of agents. Workforce module for team building. Society module for collaboration. CAMEL-SCALE for auto-scalable message queues.

Mastra: TypeScript-native. Supervisor pattern for multi-agent orchestration (Feb 2026). 3,300+ models from 94 providers. 22K+ GitHub stars.

### Multi-Agent Features GhostLink Should Adopt

| Feature | Source | Priority |
|---------|--------|----------|
| Role-based agent specialization | CrewAI, MetaGPT | High |
| Graph-based workflow state | LangGraph | High |
| Agent arena/competition mode | Grok Build | Medium |
| Git worktree isolation per agent | Cursor 3 | High |
| Publish-subscribe message pool | MetaGPT | Medium |
| SOPs for agent collaboration | MetaGPT | Medium |
| Supervisor pattern | Mastra | High |
| A2A protocol for inter-agent comms | Google | High |
| Best-of-N parallel execution | Cursor 3 | Medium |
| Hierarchical agent authority | CrewAI | Medium |

---

## Theme 4: Sandboxing & Security

### Isolation Approaches by Platform

| Platform | Isolation Method | Default? |
|----------|-----------------|----------|
| **Codex CLI** | Landlock + seccomp | Yes (only major agent with default sandboxing) |
| **Claude Code** | Bubblewrap (Linux), Seatbelt (macOS) | No (opt-in) |
| **Gemini CLI** | Docker or Podman containers | No (opt-in) |
| **Devin** | Cloud sandbox with own IDE, shell, browser | Yes (cloud-only) |
| **OpenHands** | Docker containers | Yes |
| **Cursor 3** | Git worktrees per agent | Yes (file isolation) |
| **Docker Sandboxes** | MicroVM-based isolation | Yes |
| **Bolt.new** | WebContainers (browser-only Node.js) | Yes (inherent to architecture) |

### Isolation Technology Comparison

**MicroVMs (Firecracker, Kata Containers):**
- Strongest isolation. Dedicated kernel per workload.
- Boot in ~125ms, <5 MiB memory overhead.
- Used by ~50% of Fortune 500 for AI agent workloads.
- Docker Sandboxes use this -- only solution allowing agents to build/run Docker containers while remaining isolated.

**gVisor (user-space kernel):**
- Syscall interception without full VMs.
- 10-30% overhead on I/O-heavy workloads, minimal on compute.

**Containers (Docker/Podman):**
- Share host kernel. Container escape = full host access.
- NOT a sandbox. Useful for development isolation, not security.

**WebContainers (Bolt.new):**
- Browser-only Node.js runtime. Inherently sandboxed by browser security model.
- Limited to web technologies.

### Security Features Worth Noting

- **Tabnine**: Air-gapped deployment. Zero data retention. SOC 2, GDPR, ISO 27001. On-premise Kubernetes or fully offline clusters.
- **Augment Code**: First AI coding tool with ISO/IEC 42001 certification (AI management systems).
- **Grok Build**: Local-first architecture. No source code transmitted to servers. Every action auditable before execution. Fine-grained permissions for file access, script execution, network requests.
- **Cline**: Human-in-the-loop approval at every step. Browser automation with screenshot capture at each action.

### GhostLink Implications

GhostLink should offer tiered sandboxing: file-isolation (worktrees) by default, Docker containers as opt-in, and microVM support for enterprise. Codex CLI's approach of sandbox-by-default is the gold standard.

---

## Theme 5: Multi-Model & Provider Support

### Provider Breadth by Platform

| Platform | Providers Supported |
|----------|-------------------|
| **Continue.dev** | Any model -- GPT, Claude, Gemini, Codestral, local via Ollama. Fully air-gapped capable. |
| **Bolt.diy** | 20+ providers: OpenAI, Anthropic, Ollama, OpenRouter, Gemini, LMStudio, Mistral, xAI, HuggingFace, DeepSeek, Groq, Together, etc. |
| **Roo Code** | Any LLM: Claude, GPT, Gemini, Mistral, local via Ollama |
| **Cline** | Claude, GPT, Gemini, Bedrock, Azure, OpenAI-compatible, Ollama, LM Studio |
| **Aider** | 100+ models. GPT-4o, Claude 3.7, DeepSeek, local models |
| **Goose** | Any LLM. OpenAI, Anthropic, Ollama-compatible APIs |
| **Mastra** | 3,300+ models from 94 providers |
| **Trae** | Claude 4, GPT-4o, DeepSeek R1 (free) |
| **Gemini CLI** | Gemini 2.5 Pro with 1M token context (free) |

### Model Routing & Optimization

- **PearAI Router**: Selects best model per request automatically. Workload-specific routing (larger-context models for multi-file reasoning).
- **Cursor**: Uses different models for different tasks. Custom Composer models optimized for agentic tasks.
- **Grok Build Arena Mode**: Agents compete using the same or different models, outputs ranked.
- **Cursor /best-of-n**: Same task run across multiple models, outcomes compared in isolated worktrees.
- **Windsurf SWE-1.5**: Custom model specifically trained for agentic coding workflows.

### GhostLink Implications

GhostLink already supports 13 API providers. Key additions: automatic model routing (right model for right task), model comparison mode (like Cursor's /best-of-n), and local model support via Ollama for offline use.

---

## Theme 6: UX Innovations & Developer Experience

### IDE-Level UX Innovations

**Cursor:**
- Design Mode: Annotate and target UI elements directly in the browser preview. Point to exact parts you want changed instead of describing in text.
- @-mentions for context: @file, @web, @docs, @codebase references in prompts.
- Agents Window: Standalone window for managing parallel agents.
- Tab completion: Predicts next edit location and jumps there.

**Windsurf:**
- Cascade as proactive partner, not just suggestion tool. Highlights issues before you ask.
- Windsurfrules for team-wide coding standards.
- Real-time Flow context that updates as you work.

**Zed:**
- 120fps AI editing across multiple files simultaneously.
- Zeta edit prediction model (open source, open dataset).
- Agent Panel as first-class interaction, not bolted-on chat.
- Rust-based -- fastest editor, sub-millisecond response times.

**Trae:**
- Builder Mode: Autonomous scaffolding of complete projects from natural language.
- Voice interaction (v2.0).
- Completely free including premium models (Claude 4, GPT-4o).

### App Builder UX Innovations

**Bolt.new:**
- Full-stack dev entirely in browser. No local setup.
- Live preview while coding.
- Auto-provisions databases with visual table editor.
- One-click deploy to Netlify, Vercel, or Cloudflare.

**v0 by Vercel:**
- Generates production-ready React/Next.js/Tailwind/shadcn components.
- Blocks that can be previewed in chat, then copied or installed via CLI.
- Supports Svelte, Vue, React, and HTML output.
- Git integration, VS Code-style editor, database connectivity (Feb 2026).

**Lovable:**
- Plan Mode: Shows detailed plan before writing any code (Feb 2026).
- Visual Edits: Click on interface elements to modify without writing prompts. 40% faster UI iteration.
- Voice Mode for describing changes by speaking.
- Figma-to-code import.
- $6.6B valuation, $200M ARR.

**Replit:**
- Agent tests itself, works 200 minutes autonomously, builds other agents.
- 30+ connectors (Stripe, Figma, Notion, PayPal, Salesforce, etc.).
- Figma import to working code.
- React Native / Expo for full-stack mobile apps.
- New creation UX: visualize what Agent would build before committing.

### Clever Small Features (Beginners Wouldn't Know to Ask For)

| Feature | Platform | Why It's Great |
|---------|----------|---------------|
| **Preview before commit** | Replit, Lovable Plan Mode | See what the agent will build before spending tokens |
| **Visual element targeting** | Cursor Design Mode, Lovable Visual Edits | Click on what you want changed instead of describing it |
| **Voice-to-code** | Aider, Lovable, Trae 2.0 | Speak architectural intent instead of typing |
| **Conversation export** | Amazon Q | Export AI conversations as markdown documentation |
| **Figma import** | Replit, v0 | Convert designs directly to code |
| **Auto-database provisioning** | Bolt.new, Replit, Lovable Cloud | No manual DB setup ever needed |
| **Repo map** | Aider | Compact architecture map for LLM understanding |
| **Windsurfrules** | Windsurf | Team-wide AI coding standards in a file |
| **Code Review Agent** | Tabnine | Won "Best Innovation in AI Coding" 2025 |
| **Self-healing tests** | Multiple | Tests auto-fix when locators change |
| **Prompt caching** | Claude API | 90% discount on repeated context, 89.5% cost reduction |

---

## Theme 7: Git & Version Control Integration

### Innovation Beyond Basic Commits

**Aider (Best-in-class git integration):**
- Every AI-suggested change gets an automatic commit with clear messages.
- Each session is a branch you can review, revert, or cherry-pick.
- Uses familiar git tools for diffing, managing, and undoing changes.
- Git history serves as implicit memory for the agent.

**Cursor 3 (Worktree isolation):**
- Each parallel agent runs in its own Git worktree.
- Separate working directories linked to the same repository.
- File edits completely isolated. Agents cannot overwrite each other's work.

**GitHub Copilot Coding Agent:**
- Assign a GitHub issue and it creates a complete PR.
- Code review agent gathers full project context before analyzing PRs.
- When review finds issues, passes suggestions directly to coding agent, which generates fix PRs automatically.

**Sweep AI:**
- Tag an issue with 'sweep' and it reads codebase, plans changes, writes code, submits PR with tests.
- Interacts with comments on the PR to make requested changes.
- Linear webhook integration -- tag a Linear ticket to invoke Sweep.

**Spec-Driven Development (GitHub Spec Kit):**
- Write a plain-language or formal spec for a feature.
- AI agents generate implementation code, test plans, and more following that spec.

### GhostLink Implications

GhostLink should implement: per-agent worktree isolation, auto-commit with semantic messages, issue-to-PR workflows, spec-driven development, and PR review + auto-fix loops.

---

## Theme 8: Testing & Quality Assurance

### Testing Integration by Platform

| Platform | Testing Approach |
|----------|-----------------|
| **Devin** | End-to-end testing using computer use. Clicks through desktop apps. Sends edited recording of testing to developer. |
| **GitHub Copilot** | Runs tests, checks output, identifies failures, loops back to fix |
| **Replit Agent** | Agent tests itself autonomously |
| **Qodo** | Multi-agent architecture: bug detection, code quality, security analysis, test coverage gaps in parallel. F1 score 60.1%. |
| **Claude Code** | Hooks system: mandatory linting/formatting/security on every action |
| **Aider** | Linting and testing workflows built in |
| **Tusk** | Generates unit and integration tests for code changes, integrates with PRs |
| **Tabnine** | Code Review Agent catches defects, style inconsistencies, policy violations at PR level |

### Key Testing Innovations

- **Agentic testing**: The shift from AI-assisted to AI-agentic testing. 81% of teams now use AI in testing.
- **Self-healing tests**: When a locator fails, automatically finds an alternative based on element properties. Now working reliably.
- **Devin's visual testing**: Actually runs the app and clicks through the UI. This is the most innovative testing approach in the market.
- **Shift-right testing**: 38% of organizations testing in production using production telemetry to derive new tests.
- **Qodo multi-agent review**: Specialized agents (bug detection, quality, security, coverage) work in parallel.

---

## Theme 9: Deployment & Hosting

### Who Can Deploy, Not Just Write Code

| Platform | Deployment Capability |
|----------|---------------------|
| **Replit** | Full hosting: autoscaling, static, scheduled, reserved VMs |
| **Bolt.new** | One-click deploy to Netlify, Vercel, Cloudflare. Auto-provisions databases. |
| **v0 by Vercel** | Built-in Vercel deployment. Database connectivity. |
| **Lovable** | Lovable Cloud: database, auth, file storage, hosting all built-in |
| **Devin** | Full deployment capabilities. Can install dependencies, run build scripts, deploy. |
| **GitHub Copilot** | Creates PRs that trigger existing CI/CD pipelines |
| **Cursor 3** | Cloud agents with self-hosted infrastructure option |

### Database Provisioning

- **Bolt.new**: Auto-creates databases with visual table editor, activity logs, edge functions, secrets.
- **Replit**: Built-in database, app storage, production databases (beta). 30+ connectors.
- **Lovable Cloud**: Database, authentication, file storage all automatic.
- **v0**: Database connectivity added Feb 2026.

---

## Theme 10: Extensibility & Protocols

### MCP (Model Context Protocol) Adoption

MCP has become the universal standard. Key stats:
- 97M+ monthly SDK downloads (Python + TypeScript)
- Adopted by every major AI provider
- Donated to Linux Foundation's AAIF in Dec 2025
- 3,000+ tools available for Claude Code alone

**Who supports MCP:**
Cursor, Claude Code, Codex CLI, Windsurf, Goose, Cline, Roo Code, Amazon Q CLI, Gemini CLI, Trae, Mastra, Continue.dev, Replit (custom MCP servers), and many more.

### A2A (Agent-to-Agent Protocol)

Google's complement to MCP:
- MCP = agent-to-tool communication
- A2A = agent-to-agent communication
- Built on HTTP, SSE, JSON-RPC
- Agent Cards (JSON) for capability discovery
- Supports audio and video streaming
- 50+ technology partners at launch (Atlassian, Salesforce, SAP, etc.)
- gRPC support added in v0.3
- Donated to Linux Foundation June 2025

### AGENTS.md

The cross-tool standard for project instructions:
- Adopted by 60,000+ repositories
- Works with Codex, Cursor, Copilot, Devin, Amp, Jules, Gemini CLI, VS Code
- Standard Markdown format
- Hierarchical: nearest file to edited code takes precedence in monorepos
- Stewarded by AAIF under Linux Foundation

### Extensibility Comparison

| Platform | Extension Mechanism |
|----------|-------------------|
| **Claude Code** | MCP servers, hooks (14+ lifecycle points), subagents, slash commands, skills, plugins |
| **Cursor** | Rules, MCP, custom commands, team dashboard config |
| **Goose** | MCP-based extensions (built-in + custom), desktop app + CLI |
| **Cline** | MCP integration, can create new tools to extend its own capabilities |
| **Roo Code** | Mode Gallery (community-published configurations), MCP |
| **Continue.dev** | YAML config, open plugin architecture, multiple runtimes |
| **Mastra** | Native MCP server authoring within framework |
| **CrewAI** | Flows (event-driven), Crews (role-based), native MCP + A2A |

### GhostLink Implications

GhostLink must support: MCP for tool integration, A2A for inter-agent communication, AGENTS.md for project instructions, lifecycle hooks, and a community marketplace for extensions/skills.

---

## Theme 11: Voice, Multimodal & Vision

### Voice Support

| Platform | Voice Features |
|----------|---------------|
| **Aider** | /voice command. Speak intent, agent implements. "Surprisingly effective for high-level architectural instructions." |
| **Lovable** | Voice Mode for describing changes by speaking |
| **Trae 2.0** | Voice interaction feature added |
| **OpenAI Realtime API** | gpt-realtime for sub-800ms latency bidirectional audio |

### Image/Screenshot Support

| Platform | Vision Capabilities |
|----------|-------------------|
| **Codex CLI** | Attach screenshots or design specs. Paste images into composer. |
| **Aider** | Add images and web pages to chat for visual context |
| **Cursor Design Mode** | Annotate UI elements directly in browser preview |
| **Devin** | Built-in browser for visual browsing and testing |
| **Cline** | Browser automation with screenshots at each step |
| **GLM-5V-Turbo** | Generate HTML/CSS/JS from mockups, Figma exports, hand-drawn sketches |
| **Lovable Visual Edits** | Click on interface elements to modify directly |

### Emerging Multimodal Capabilities

- **OpenAI Realtime + Vision**: Build multimodal voice agents with image input + SIP phone calling
- **Production requirements**: Sub-800ms voice latency, cross-modal information fusion, graceful degradation
- **GLM-5V-Turbo**: End-to-end vision-driven tool use -- images as tool parameters without text conversion

---

## Theme 12: Collaboration & Team Features

### Real-Time Multi-Agent Collaboration

| Platform | Collaboration Architecture |
|----------|--------------------------|
| **GitHub Agent HQ** | Run Claude, Codex, and Copilot simultaneously on same task (Feb 2026) |
| **Grok Build** | 8 agents working simultaneously with built-in conflict resolution for overlapping file edits |
| **Cursor 3** | Parallel agents in worktrees, cloud, local, SSH. Self-hosted cloud agents. |
| **Codex App** | macOS command center for managing parallel AI workflows across projects |
| **Claude Code** | Agent Teams with inter-agent messaging |

### Team Features

| Platform | Team Capability |
|----------|----------------|
| **Cursor** | Team dashboard for custom commands, rules, and prompts. Team Rules. |
| **Roo Cloud** | Synced sessions, task analytics, "Roomote" collaboration |
| **Tabnine** | Organization-wide context engine learning team patterns |
| **Augment Intent** | Desktop app for multi-agent orchestration with living specs |
| **Qodo** | Multi-repo intelligence for enterprise code review |
| **Cline Enterprise** | Team-oriented deployment |

### GhostLink Implications

GhostLink should support: running heterogeneous agents simultaneously (like Agent HQ), conflict resolution for overlapping edits, shared specs/plans, team dashboards for rules/commands, and session sharing.

---

## Theme 13: Cost Management & Token Economics

### Real-World Cost Data

- Average Claude Code cost: $6/developer/day. 90th percentile: $12/day.
- 8 months of daily usage: 10B tokens consumed, $15,000+ at API pricing.
- Studies found 70% of tokens are waste (reading too many files, exploring irrelevant paths, repeating searches).
- Prompt caching: 90% discount on cached input tokens (89.5% reduction over 200 calls with 5K system prompt).

### Cost Management Features

| Feature | Platform |
|---------|----------|
| **Per-request, per-task, per-day/month spending caps** | Claude API, OpenAI |
| **Alerts at 50% and 80% thresholds** | Multiple |
| **Token usage dashboards** | LangSmith, Helicone, Portkey |
| **Model routing for cost optimization** | PearAI, Cursor, custom configs |
| **Scoped prompts (30-50% fewer tokens)** | Best practice across tools |
| **Free tiers** | Gemini CLI (1000 req/day), Trae (5000 completions/month), Continue.dev (all features free) |

### Cost Optimization Strategies

1. Model routing + caching: 40-60% savings
2. Scoped prompts: 30-50% fewer tokens
3. Prompt caching: 89.5% reduction on repeated context
4. Context editing (Claude Code): 84% token reduction
5. Smaller models for simple tasks, large models for complex reasoning

### GhostLink Implications

GhostLink needs: per-agent cost tracking, spending caps with alerts, model routing to optimize cost/quality, prompt caching, and a token waste dashboard showing where tokens are being spent.

---

## Theme 14: Offline & Local-First

### Offline-Capable Platforms

| Platform | Offline Capability |
|----------|-------------------|
| **Continue.dev** | Full air-gapped deployment with Ollama. No internet needed. |
| **Goose** | Local-first. Works with local LLM runtimes. No network needed. |
| **Aider** | Supports local models via Ollama |
| **Roo Code** | Any local model via Ollama |
| **Cline** | Local models via Ollama, LM Studio |
| **Bolt.diy** | 20+ providers including local options |
| **PearAI** | Local model support |
| **Refact.ai** | Full self-hosted with custom model fine-tuning |
| **Jan** | Completely offline ChatGPT alternative |

### Local LLM Recommendations (2026)

- **Minimum hardware**: 8GB RAM for 3-7B param models, 16GB for 8-13B
- **Top recommendations**: Meta Llama 3.1 8B, GLM-4-9B-0414, Qwen3-8B
- **Enterprise coding**: Qwen3-Coder-480B for agentic coding workflows
- **Runtimes**: Ollama (simplest), LM Studio (GUI), Jan (offline ChatGPT alternative)

### Real-World Story

One developer flew for seven hours with zero internet and built working code using local AI. Modern laptops (16GB+ RAM) are sufficient.

### GhostLink Implications

GhostLink should support: Ollama integration for local models, graceful degradation from cloud to local, model download management in the desktop app, and hybrid mode (local for simple tasks, cloud for complex reasoning).

---

## Theme 15: Custom Instructions & Rules

### File Format Comparison

| Platform | File | Location | Format |
|----------|------|----------|--------|
| **Claude Code** | CLAUDE.md | Project root, ~/.claude/, per-folder | Markdown |
| **Cursor** | .cursorrules, Project/Team/User Rules | Project root, dashboard | Markdown/YAML |
| **Codex CLI** | AGENTS.md | Project root (hierarchical) | Markdown |
| **Copilot** | .github/copilot-instructions.md, .instructions.md | .github/ dir | Markdown |
| **Windsurf** | .windsurfrules | Project root | Markdown |
| **JetBrains Junie** | .junie/guidelines.md | .junie/ dir | Markdown |
| **AGENTS.md (universal)** | AGENTS.md | Any level (nearest wins) | Markdown |

### Key Patterns

1. **All use Markdown** -- no proprietary format needed.
2. **Hierarchical**: Most support per-folder overrides. AGENTS.md's "nearest file wins" in monorepos is the most elegant.
3. **Version-controlled**: All can be git-tracked, enabling team-wide consistency.
4. **Slash commands**: Claude Code stores prompt templates in `.claude/commands/` as Markdown files, available through slash menu.
5. **Team rules**: Cursor allows team admins to define rules from a dashboard.

### What Goes in Rules Files

Based on research across platforms:
- Coding style, conventions, naming patterns
- Testing requirements (coverage thresholds, test frameworks)
- File structure and architecture guidelines
- "Do" and "don't" lists for the agent
- Examples of good code patterns from the project
- Security requirements
- Build/deploy instructions

### GhostLink Implications

GhostLink should support: AGENTS.md as primary format, CLAUDE.md compatibility, hierarchical per-folder rules, team dashboard for shared rules, slash commands from markdown files, and a rules editor in the UI.

---

## Theme 16: Approval Workflows & Safety

### The Approval Spectrum

| Level | Description | Platforms |
|-------|-------------|-----------|
| **Always ask** | Every action requires approval | Cline (default) |
| **Configurable tiers** | Different approval levels per action type | Claude Code hooks, Cursor |
| **Auto-approve safe, ask for dangerous** | File reads auto-approved, deletions require approval | Most IDE agents |
| **Fully autonomous** | No human approval needed | Devin (configurable), Background agents |
| **Confidence-based** | Agent asks when confidence is low | Devin 2.0 |

### Known Vulnerabilities

A critical discovery in late 2025: attackers can manipulate HITL dialogs by hiding malicious instructions, padding with benign text, or crafting prompts that generate misleading summaries. Defenses needed beyond simple approve/deny.

### Best Practices (2026 State of the Art)

1. **Approval gates before destructive actions**: rm -rf, database writes, deployments.
2. **Configurable autonomy per task type**: Different levels for read, write, execute, deploy.
3. **Audit trails of every agent action**: Required by EU AI Act (enforcement Aug 2026), SOC 2, GDPR.
4. **Circuit breaker architecture**: Governance built into pipeline, not just checkpoints.
5. **Claude Code hooks**: Guarantee execution of security checks regardless of model behavior. 14+ lifecycle trigger points.

### GhostLink Implications

GhostLink needs: tiered approval (per action type), audit logging of all agent actions, circuit breaker for production operations, hook-based mandatory checks, and protection against HITL manipulation attacks.

---

## Platform-by-Platform Reference Cards

### Tier 1 -- Major Platforms

#### Cursor
- **Unique**: Design Mode (point at UI elements), /best-of-n (multi-model comparison), background agents, cloud-to-local handoff, 8 parallel agents
- **Memory**: .cursorrules, Project/Team/User Rules
- **Models**: Multi-model, custom Composer models
- **Extensibility**: MCP, team dashboard
- **Traction**: $2B ARR, half of Fortune 500

#### Windsurf (Codeium, acquired by Cognition Dec 2025)
- **Unique**: Cascade (deep codebase awareness), Flow (real-time context updates), proactive suggestions
- **Memory**: Memories system (auto-loaded per session), .windsurfrules
- **Models**: SWE-1.5 custom model, multi-model support
- **Extensibility**: MCP, rules, memory APIs

#### Devin (Cognition)
- **Unique**: Cloud sandbox with IDE/shell/browser, computer-use QA testing with video recording, dynamic re-planning, Devin Wiki/Search
- **Memory**: Session-based, project context learning
- **Models**: Proprietary
- **Traction**: Enterprise (Goldman Sachs pilot with 12K developers)

#### Replit
- **Unique**: Full hosting stack (autoscaling, scheduled, reserved VMs), 30+ connectors, Figma import, Agent builds other agents
- **Memory**: Project-based
- **Models**: Multi-model
- **Extensibility**: Custom MCP servers, 30+ connectors

#### GitHub Copilot
- **Unique**: Issue-to-PR Coding Agent (GA Sept 2025), agentic code review (March 2026), Spec Kit for spec-driven development
- **Memory**: Conversation persistence, .github/copilot-instructions.md
- **Models**: Multi-model (GPT, Claude, Gemini available)
- **Extensibility**: VS Code, JetBrains, Eclipse, Xcode

#### Claude Code
- **Unique**: 14+ lifecycle hooks, Agent Teams (inter-agent messaging), context editing (84% token reduction), subagents, 4% of all GitHub commits
- **Memory**: CLAUDE.md (project/user/folder), slash commands
- **Models**: Claude family
- **Extensibility**: MCP (3,000+ tools), hooks, skills, plugins, Agent SDK

#### Codex CLI (OpenAI)
- **Unique**: Only major agent with sandbox-by-default (Landlock + seccomp), open-source Rust, image support
- **Memory**: AGENTS.md, config.toml
- **Models**: GPT-5-Codex optimized for coding
- **Extensibility**: MCP, subagent workflows

#### Continue.dev
- **Unique**: Four modes (Agent, Chat, Autocomplete, Edit), fully free, full air-gapped local deployment
- **Memory**: YAML config files
- **Models**: Any model (cloud + local)
- **Extensibility**: Open plugin architecture

#### Cody (Sourcegraph)
- **Unique**: Enterprise-scale multi-repo context via Sourcegraph Search, Smart Apply for cross-file modifications
- **Memory**: Sourcegraph code intelligence
- **Models**: Multi-model, self-hosted options
- **Note**: Free/Pro plans discontinued July 2025, enterprise only

#### Aider
- **Unique**: Best git integration (every edit is a commit), voice input, repo map, 100+ languages
- **Memory**: Git history as implicit memory
- **Models**: 100+ models including local

#### Goose (Block)
- **Unique**: Open-source, local-first, desktop app + CLI, MCP-native, contributed to Linux Foundation AAIF
- **Memory**: Built-in memory extension via MCP
- **Models**: Any LLM
- **Extensibility**: MCP-first architecture

### Tier 2 -- Specialized/Indie

#### Bolt.new (StackBlitz)
- **Unique**: Full-stack dev entirely in browser via WebContainers, auto-database provisioning with visual editor
- **Open variant**: bolt.diy supports 20+ providers

#### v0 (Vercel)
- **Unique**: Production-ready React/Next.js/Tailwind/shadcn output, Blocks system, multi-framework output (Svelte, Vue, React, HTML)
- **Evolution**: From UI generator to full-stack app builder (Feb 2026)

#### Lovable
- **Unique**: Visual Edits (click to modify, 40% faster), Plan Mode (preview before build), Voice Mode, Lovable Cloud
- **Traction**: $6.6B valuation, $200M ARR, Klarna/Uber/Zendesk customers

#### OpenHands (formerly OpenDevin)
- **Unique**: Open-source, hierarchical agent delegation, multiple agent types (CodeAct, Browser, Micro-agents), MIT license
- **Deployment**: SDK for defining agents in code, local GUI, cloud scaling

#### SWE-Agent (Princeton/Stanford)
- **Unique**: Custom agent-computer interface (ACI), SWE-bench benchmark leadership, Mini-SWE-agent (100 lines, 74% on SWE-bench)
- **Purpose**: Research agent for benchmarking and automated issue fixing

#### Cline
- **Unique**: Plan/Act mode separation, browser automation via computer use, MCP tool self-creation
- **Traction**: 5M+ developers, Samsung Electronics pilot

#### Roo Code
- **Unique**: Five built-in modes (Code, Architect, Ask, Debug, Custom), Mode Gallery for community configs, modes auto-suggest switching
- **Collaboration**: Roo Cloud with synced sessions and "Roomote"

#### Trae (ByteDance)
- **Unique**: Completely free including premium models, Builder Mode (autonomous project scaffolding), voice (v2.0)
- **Traction**: 6M+ users in 12 months

#### Amazon Q Developer
- **Unique**: Deep AWS integration (CloudWatch, Lambda, VPC, IAM diagnostics), GitLab Duo integration, 25+ languages
- **Enterprise**: Cross-region inferencing, data residency compliance

#### Tabnine
- **Unique**: Air-gapped deployment, zero data retention, Code Review Agent (won "Best Innovation" 2025), enterprise context engine
- **Privacy**: SOC 2, GDPR, ISO 27001, on-premise Kubernetes, fully offline

#### Others
- **PearAI**: Open-source, integrates Aider + Supermaven + Continue + Mem0 + Perplexity. Model Router for automatic selection.
- **Zed AI**: Fastest editor (Rust, 120fps), Zeta prediction model (open source), Agent Panel first-class.
- **Supermaven**: Acquired by Cursor. Sub-10ms latency, 1M token context. Technology integrated into Cursor.
- **Augment Code**: 400K+ file context engine, Intent desktop app (multi-agent living specs), 51.8% SWE-bench Pro (top score), ISO/IEC 42001 certified.
- **Qodo**: Multi-agent code review (F1 60.1%), persistent Rules System, test generation + review unified. $40M Series A.
- **Refact.ai**: Open-source, self-hosted, fine-tunable. 50 engineers per GPU for completion. 45% code written after fine-tuning.
- **Sweep AI**: Issue-to-PR with Linear webhook integration. Interacts with PR comments.

### Tier 3 -- Multi-Agent Frameworks

#### CrewAI
- **Unique**: Role-based (Manager/Worker/Researcher), Crews + Flows architecture, hierarchical coordination, 100K+ certified developers
- **Enterprise**: AMP Suite, on-premise/cloud deployment

#### AutoGen / Microsoft Agent Framework
- **Unique**: Merged with Semantic Kernel. Conversable agents, human-in-the-loop configurable, 5-12 agent enterprise patterns
- **Enterprise**: Part of Microsoft Agent Framework ecosystem

#### LangGraph
- **Unique**: Graph-based with explicit state, checkpointing (Postgres/Redis), time-travel debugging, TypeScript adoption (42K weekly npm downloads)
- **Industry**: Won the stateful workflow segment

#### MetaGPT
- **Unique**: SOP-governed agent collaboration, shared publish-subscribe message pool, 85.9% Pass@1, MGX natural language programming product
- **Architecture**: Simulates complete software company

#### ChatDev
- **Unique**: Waterfall model with AI, zero-code orchestration platform (v2.0), puppeteer-style paradigm with RL-optimized orchestrator
- **Research**: NeurIPS 2025 accepted paper

#### CAMEL
- **Unique**: Scalable to millions of agents, CAMEL-SCALE message queue system, OWL local execution agent, Workforce + Society modules
- **Scope**: Research-oriented, broadest agent scale

#### Mastra
- **Unique**: TypeScript-native, 94 providers / 3,300+ models, supervisor pattern, observational memory, from Gatsby team
- **Traction**: 22K+ GitHub stars, 300K+ weekly npm downloads

---

## GhostLink Competitive Gap Analysis

Based on this survey, here are the features GhostLink should prioritize to compete at the highest level:

### Must-Have (Critical Gaps)

| Feature | Why | Reference Platform |
|---------|-----|-------------------|
| **MCP as primary extensibility** | Universal standard, 97M+ downloads | Claude Code, Cursor, Goose |
| **AGENTS.md support** | Cross-tool project instruction standard | All major platforms |
| **A2A protocol** | Agent-to-agent communication standard | Google, Linux Foundation |
| **Background/async agents** | Agents work while developer does other things | Cursor 3, Copilot, Codex |
| **Per-agent worktree isolation** | Parallel agents without file conflicts | Cursor 3 |
| **Tiered approval workflows** | Safety for destructive operations | Claude Code hooks, Cline |
| **Per-agent cost tracking** | Know where tokens are spent | Industry standard |
| **Model routing** | Right model for right task, cost optimization | PearAI, Cursor |

### Should-Have (Competitive Differentiators)

| Feature | Why | Reference Platform |
|---------|-----|-------------------|
| **Spec-driven development** | Define specs, agents implement | GitHub Spec Kit, Augment Intent |
| **Plan Mode (preview before build)** | See what agent will build before spending tokens | Lovable, Devin |
| **Visual element targeting** | Click on what you want changed | Cursor Design Mode, Lovable |
| **Voice input** | Speak architectural intent | Aider, Lovable, Trae |
| **Arena/competition mode** | Multiple agents compete, best output selected | Grok Build, Cursor /best-of-n |
| **Role-based agent specialization** | Different agents for different tasks | CrewAI, MetaGPT, Roo Code modes |
| **Lifecycle hooks** | Mandatory checks regardless of model behavior | Claude Code (14+ hooks) |
| **Graph-based workflow state** | Checkpointing, time-travel, fault tolerance | LangGraph |
| **Self-hosted cloud agents** | Enterprise: code stays in their infrastructure | Cursor 3 |

### Nice-to-Have (Delight Features)

| Feature | Why | Reference Platform |
|---------|-----|-------------------|
| **Figma import** | Convert designs directly to code | Replit, v0 |
| **Auto-database provisioning** | No manual DB setup | Bolt.new, Replit, Lovable |
| **Conversation export** | Export AI conversations as documentation | Amazon Q |
| **Agent testing via computer use** | Visual QA by clicking through the app | Devin |
| **Community mode gallery** | Pre-built agent configurations | Roo Code |
| **Observational memory** | Agent learns from usage patterns | Mastra |
| **Code review agent** | Automated PR review with persistent rules | Qodo, Tabnine |
| **Local model support (Ollama)** | Offline and privacy-first usage | Continue.dev, Goose |
| **One-click deployment** | Deploy directly from the agent | Bolt.new, Replit, Lovable |
| **Living specs** | Multiple agents share and evolve a single plan | Augment Intent |

---

## Key Industry Trends GhostLink Must Track

1. **February 2026 was the multi-agent inflection point.** Every major tool shipped multi-agent in the same two-week window.
2. **4% of GitHub commits are now AI-authored.** This number is growing exponentially.
3. **Enterprise compliance** (EU AI Act enforcement Aug 2026) requires audit trails, approval workflows, and accountability-in-the-loop.
4. **The MCP + A2A + AGENTS.md trinity** is the emerging foundation of the agentic AI ecosystem, all under the Linux Foundation's AAIF.
5. **Background agents** are the next UX paradigm -- agents working asynchronously while developers context-switch.
6. **Token waste** is a massive problem (70% waste in studies). Platforms that solve this win on cost.
7. **Spec-driven development** is emerging as the workflow for vibe coding at scale.
8. **Gartner reports 1,445% surge** in multi-agent system inquiries from Q1 2024 to Q2 2025.
9. **Privacy-first enterprise deployment** (Tabnine, Refact.ai, Cursor self-hosted) is a growing segment.
10. **Local-first with cloud fallback** is the optimal architecture for cost, privacy, and reliability.

---

## Sources

### Tier 1 Platforms
- [Cursor Features](https://cursor.com/features)
- [Cursor 3 Release](https://cursor.com/changelog/3-0)
- [Cursor Agent Docs](https://cursor.com/docs/agent/overview)
- [Windsurf Cascade](https://windsurf.com/cascade)
- [Windsurf Flow Context Engine](https://markaicode.com/windsurf-flow-context-engine/)
- [Devin AI Docs](https://docs.devin.ai/release-notes/overview)
- [Devin Review 2026](https://vibecoding.app/blog/devin-review)
- [Replit Agent](https://replit.com/products/agent)
- [Replit 2025 Year in Review](https://blog.replit.com/2025-replit-in-review)
- [GitHub Copilot Agent Mode](https://code.visualstudio.com/blogs/2025/02/24/introducing-copilot-agent-mode)
- [GitHub Copilot CLI Changelog](https://github.blog/changelog/2026-01-14-github-copilot-cli-enhanced-agents-context-management-and-new-ways-to-install/)
- [Claude Code Architecture](https://www.penligent.ai/hackinglabs/inside-claude-code-the-architecture-behind-tools-memory-hooks-and-mcp/)
- [Claude Code Production Guide](https://dev.to/lizechengnet/how-to-structure-claude-code-for-production-mcp-servers-subagents-and-claudemd-2026-guide-4gjn)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Codex CLI GitHub](https://github.com/openai/codex)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features)
- [Continue.dev](https://www.continue.dev/)
- [Cody Sourcegraph](https://sourcegraph.com/cody)
- [Aider](https://aider.chat/)
- [Goose by Block](https://block.github.io/goose/)

### Tier 2 Platforms
- [Bolt.new GitHub](https://github.com/stackblitz/bolt.new)
- [v0 by Vercel Guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026)
- [Lovable AI](https://lovable.dev/guides/best-ai-app-builders)
- [OpenHands](https://openhands.dev/)
- [SWE-Agent GitHub](https://github.com/SWE-agent/SWE-agent)
- [Sweep AI](https://aiagentslist.com/agents/sweep-ai)
- [Cline](https://cline.bot)
- [Roo Code](https://roocode.com/)
- [PearAI](https://www.trypear.ai/)
- [Zed AI](https://zed.dev/ai)
- [Trae IDE](https://traeide.com/)
- [Amazon Q Developer](https://aws.amazon.com/q/developer/)
- [Tabnine](https://www.tabnine.com/)
- [Supermaven](https://supermaven.com/)
- [Augment Code](https://www.augmentcode.com/)
- [Qodo AI](https://www.qodo.ai/)
- [Refact.ai](https://refact.ai/)

### Tier 3 Frameworks
- [CrewAI](https://crewai.com/)
- [AutoGen / Microsoft Agent Framework](https://github.com/microsoft/autogen)
- [LangGraph](https://www.langchain.com/langgraph)
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT)
- [ChatDev](https://github.com/OpenBMB/ChatDev)
- [CAMEL AI](https://www.camel-ai.org/)
- [Mastra](https://mastra.ai/)

### Cross-Cutting Topics
- [Docker Sandboxes for AI](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- [Sandbox Comparison 2026](https://northflank.com/blog/how-to-sandbox-ai-agents)
- [Codebase Indexing Strategies](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [AI Agent Security Guide 2026](https://www.mintmcp.com/blog/ai-agent-security)
- [AI Coding Cost Management](https://www.morphllm.com/ai-coding-costs)
- [Claude Code Cost Guide](https://code.claude.com/docs/en/costs)
- [AGENTS.md Specification](https://agents.md/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [Grok Build](https://www.adwaitx.com/grok-build-vibe-coding-cli-agent/)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
