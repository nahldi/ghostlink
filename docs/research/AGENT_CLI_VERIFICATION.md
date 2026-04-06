# Agent CLI Integration Verification

**Date:** 2026-04-06
**Verified by:** Claude (independent code audit)

## Summary
**13 agents claimed. 8 have real integration. 5 are placeholder shells.**

## Tier 1: Fully Integrated (8 agents)

| Agent | Command | MCP Connection | Identity Injection | Approval Watcher | MCP-Native Mode |
|-------|---------|---------------|-------------------|------------------|-----------------|
| Claude | `claude` | YES (--mcp-config flag) | .claude/instructions.md | YES (keyed patterns) | YES (stream-json pipe) |
| Codex | `codex` | YES (proxy flag) | .codex/instructions.md | YES (keyed patterns) | YES (exec-per-trigger JSONL) |
| Gemini | `gemini` | YES (env var) | Settings JSON systemInstruction | YES (keyed patterns) | YES (exec-per-trigger) |
| Grok | `grok` | YES (--mcp-config flag) | .grok/instructions.md | YES (generic) | NO |
| Aider | `aider` | YES (proxy) | .aider.conventions.md | YES (generic) | NO |
| Goose | `goose` | YES (env var) | INSTRUCTIONS.md (generic) | YES (generic) | NO |
| Copilot | `gh` | YES (proxy) | INSTRUCTIONS.md (generic) | YES (generic) | NO |
| Ollama | `ollama` | NO | INSTRUCTIONS.md (generic) | YES (generic) | NO |

## Tier 2: Placeholder Agents (5 agents)

These are listed in the UI but have NO real integration code. They launch the CLI but don't connect to MCP, don't receive GhostLink context, and approvals won't work.

| Agent | Command | Why Placeholder |
|-------|---------|----------------|
| Pi | `pi` | No MCP config, no identity injection, no builtin defaults |
| Cursor | `cursor` | IDE-based, not a CLI REPL. Launching via subprocess spawns GUI |
| Cody | `cody` | No MCP config, no identity injection |
| Continue | `continue` | No MCP config, no identity injection |
| OpenCode | `opencode` | No MCP config, no identity injection |

## Recommendation
- Move Pi, Cursor, Cody, Continue, OpenCode to "Experimental" or remove from default list
- Only claim 8 fully integrated agents in docs
- OR implement real integrations for the 5 placeholders
