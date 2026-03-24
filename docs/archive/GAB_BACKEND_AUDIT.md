# GAB Backend Audit — GhostLink v2.5.0
## Comprehensive Backend Deep Dive with Test Plans

**Auditor:** GAB (Ghostlink Audit Backend)
**Date:** 2026-03-24
**Scope:** Full backend — app.py, wrapper.py, all 15 modules, config, spawn logic, MCP bridge, security
**Methodology:** Static analysis, architecture review, cross-reference with agent CLI docs
**Status:** READ-ONLY audit — zero code edits made

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Codebase Statistics](#2-codebase-statistics)
3. [Agent CLI Invocation Audit (The Critical Bug)](#3-agent-cli-invocation-audit)
4. [MCP Config Injection System](#4-mcp-config-injection-system)
5. [Gemini PATH Detection Fix](#5-gemini-path-detection-fix)
6. [All API Endpoints (95+)](#6-all-api-endpoints)
7. [Module-by-Module Analysis](#7-module-by-module-analysis)
8. [Complete Bug Registry with Test Plans](#8-complete-bug-registry)
9. [Security Audit](#9-security-audit)
10. [Performance Analysis](#10-performance-analysis)
11. [Comparison with Best-in-Class Platforms](#11-platform-comparison)
12. [Missing Features](#12-missing-features)

---

## 1. Architecture Overview

GhostLink is a local-first multi-agent AI chat platform where 13+ AI CLI agents share a chat room via MCP (Model Context Protocol) tool calls. The architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React, 44 components)                            │
│  ├── WebSocket connection for real-time events              │
│  └── REST API calls to backend                              │
├─────────────────────────────────────────────────────────────┤
│  FastAPI Backend (app.py, 3,279 lines)                      │
│  ├── 95+ REST endpoints                                     │
│  ├── 1 WebSocket endpoint (/ws)                             │
│  ├── Rate limiting middleware                                │
│  ├── Agent spawn/kill lifecycle                              │
│  └── Background threads (health, schedule, MCP servers)     │
├─────────────────────────────────────────────────────────────┤
│  MCP Bridge (mcp_bridge.py, 1,587 lines)                    │
│  ├── HTTP transport on port 8200                             │
│  ├── SSE transport on port 8201                              │
│  └── 30+ MCP tools (chat_send, chat_read, memory_*, etc.)   │
├─────────────────────────────────────────────────────────────┤
│  MCP Proxy (mcp_proxy.py, 244 lines)                        │
│  ├── Per-agent identity stamping                             │
│  └── Dynamic port allocation                                 │
├─────────────────────────────────────────────────────────────┤
│  Wrapper (wrapper.py + wrapper_unix.py, ~1,200 lines)       │
│  ├── tmux session management                                 │
│  ├── @mention → MCP read injection                           │
│  ├── Permission prompt auto-approval                         │
│  ├── Heartbeat + activity monitoring                         │
│  └── Thinking output streaming                               │
├─────────────────────────────────────────────────────────────┤
│  Agent CLI Processes (tmux sessions)                         │
│  ├── Claude Code, Codex, Gemini, Grok, Aider...             │
│  └── Each in its own tmux session: ghostlink-{name}         │
└─────────────────────────────────────────────────────────────┘
```

**Data Layer:** SQLite (WAL mode) via aiosqlite, JSON files for config/secrets/state
**IPC:** File-based queue polling ({agent}_queue.jsonl), HTTP heartbeats

---

## 2. Codebase Statistics

| File | Lines | Purpose |
|------|-------|---------|
| app.py | 3,279 | Main server, all endpoints |
| mcp_bridge.py | 1,587 | MCP tool server |
| wrapper.py | 955 | Agent lifecycle wrapper |
| plugin_sdk.py | 590 | Plugin system, event bus, safety scanner |
| bridges.py | 553 | Discord/Telegram/Slack/WhatsApp bridges |
| security.py | 413 | Encryption, exec policy, GDPR, audit |
| skills.py | 325 | 30+ built-in skills registry |
| store.py | 281 | SQLite message persistence |
| mcp_proxy.py | 244 | Per-agent identity proxy |
| agent_memory.py | 240 | Per-agent persistent memory |
| sessions.py | 214 | Structured conversation sessions |
| plugin_loader.py | 200 | Plugin discovery and loading |
| schedules.py | 171 | Cron-like scheduling |
| providers.py | 333 | 13 AI providers, failover |
| wrapper_unix.py | 159 | tmux session management |
| registry.py | 126 | Agent instance registry |
| rules.py | 113 | Shared rules system |
| jobs.py | 109 | Task/job tracking |
| router.py | 82 | Message routing |
| **Total Backend** | **~9,950** | |

**Provider Count:** 13 (Anthropic, OpenAI, Google, xAI, Groq, Together, HuggingFace, Ollama, Mistral, OpenRouter, DeepSeek, Perplexity, Cohere)
**MCP Tools:** 30+ (chat_send, chat_read, chat_join, chat_who, chat_channels, chat_rules, chat_progress, chat_propose_job, chat_react, chat_claim, memory_save, memory_load, memory_list, memory_search, web_search, web_fetch, image_generate, plus job/rule tools)
**Background Threads:** 4+ (health monitor, schedule checker, MCP HTTP server, MCP SSE server, plus per-agent approval/activity watchers)

---

## 3. Agent CLI Invocation Audit (THE CRITICAL BUG)

### The Problem

`wrapper.py` builds the agent launch command by combining `command + agent_args + extra + mcp_args` (line 715). The agent args (like `--dangerously-skip-permissions`) come from `config.toml` or from `KNOWN_AGENTS` defaults (app.py line 1144-1157). These are passed as `extra_args` to `wrapper_unix.run_agent()`, which builds the tmux command correctly:

```python
# wrapper_unix.py line 88-89
agent_cmd = " ".join(
    [shlex.quote(command)] + [shlex.quote(a) for a in extra_args]
)
# Then: tmux new-session -d -s {session_name} -c {cwd} {agent_cmd}
```

**This is actually correct** — the flags ARE on the launch command line, not sent via send-keys. The tmux session starts the agent with all flags baked in.

However, there are **still critical issues** with how each agent's flags are configured:

### Per-Agent Invocation Analysis

#### 1. Claude Code (`claude`)
**Config (app.py line 1145):** `["--dangerously-skip-permissions"]`
**Built-in default (wrapper.py line 138):** `mcp_inject: "flag"`, `mcp_flag: "--mcp-config"`

**Actual tmux command produced:**
```bash
claude --dangerously-skip-permissions --mcp-config /path/to/data/provider-config/claude-1-mcp.json
```

**ISSUE:** `--dangerously-skip-permissions` disables ALL permission prompts, which means Claude won't ask for MCP tool approval either. This is the intended behavior for GhostLink (auto-approve own tools). BUT the approval_watcher (wrapper.py line 339) still runs and tries to detect prompts that will never appear. Wasted CPU.

**CORRECT invocation for Claude Code (2026):**
```bash
claude --dangerously-skip-permissions --mcp-config config.json -p "initial prompt"
```
Or for headless/non-interactive:
```bash
claude --dangerously-skip-permissions --mcp-config config.json --bare -p "prompt"
```

**Fail Test:** Start Claude agent via spawn-agent, check tmux pane — verify `--dangerously-skip-permissions` is on the command line, not injected as text.
**Fix Test:** The current implementation is correct for the flag placement. The fix is to NOT run the approval_watcher thread when `--dangerously-skip-permissions` is in the args.
**Smoke Test:** Spawn Claude, send @claude message, verify MCP tool call happens without permission prompt.
**Verify:** Check that Claude Code CLI version supports the flags — `claude --version` and `claude --help`.

---

#### 2. Codex CLI (`codex`)
**Config (app.py line 1146):** `["--sandbox", "danger-full-access", "-a", "never"]`
**Built-in default (wrapper.py line 150-153):** `mcp_inject: "proxy_flag"`, template: `-c mcp_servers.{server}.url="{url}"`

**Actual tmux command produced:**
```bash
codex --sandbox danger-full-access -a never -c mcp_servers.ghostlink.url="http://127.0.0.1:{proxy_port}/mcp"
```

**ISSUES:**
- `--sandbox danger-full-access` gives Codex full system access — correct but nuclear option
- `-a never` means "never ask for approval" (full auto-approve)
- The `-c` flag for MCP config is passed as extra CLI args after `--`, which is fragile

**Fail Test:** Spawn codex agent, verify in tmux that the full command includes `-c mcp_servers.ghostlink.url=...`
**Fix Test:** Verify Codex actually picks up the MCP server via the `-c` flag. The proxy_flag template expansion should produce valid config.
**Smoke Test:** Send @codex message, check MCP bridge logs for tool call from codex.
**Verify:** `codex --help` to confirm `-c` flag syntax is still supported.

---

#### 3. Gemini CLI (`gemini`)
**Config (app.py line 1147):** `["-y"]`
**Built-in default (wrapper.py line 144-149):** `mcp_inject: "env"`, `mcp_env_var: "GEMINI_CLI_SYSTEM_SETTINGS_PATH"`

**Actual tmux command produced:**
```bash
env GEMINI_CLI_SYSTEM_SETTINGS_PATH=/path/to/data/provider-config/gemini-1-settings.json gemini -y
```

**ISSUES:**
1. **`-y` flag may not exist** — Gemini CLI's auto-approve flag is undocumented/changed frequently
2. **Settings JSON format** — wrapper.py writes both `httpUrl` and `url` keys (line 110), but Gemini CLI may only read one
3. **The PATH detection bug** (see Section 5) — `shutil.which("gemini")` fails when installed via npm in WSL

**Fail Test:** Run `gemini --help` to verify `-y` is a valid flag. Check if settings JSON is read.
**Fix Test:** Try `gemini --sandbox none` or `gemini --auto-approve` as alternatives.
**Smoke Test:** Spawn gemini, send @gemini, check MCP bridge for tool call.
**Verify:** The env var `GEMINI_CLI_SYSTEM_SETTINGS_PATH` must point to a valid JSON with `mcpServers` key.

---

#### 4. Grok CLI (`grok`)
**Config (app.py line 1148):** `[]` (empty)
**No built-in MCP defaults in wrapper.py**

**ISSUE:** Grok CLI is a third-party community tool (`npx grok`), not an official xAI product. There is no standardized MCP support or auto-approve flag.

**Fail Test:** `which grok` or `npx grok --help` — likely not found.
**Fix Test:** If using the community `grok` package, pass system prompt via stdin or config file.
**Smoke Test:** N/A — agent likely won't connect to MCP.
**Verify:** Check if xAI has released an official CLI since this code was written.

---

#### 5. GitHub Copilot (`gh copilot`)
**Config (app.py line 1149):** `["copilot"]` (passed to `gh` command)

**Actual tmux command:** `gh copilot`

**ISSUE:** `gh copilot` is a conversational CLI, not a code agent. It doesn't support MCP, custom config files, or auto-approve flags. The GhostLink wrapper will inject prompts via tmux send-keys, but Copilot can't call MCP tools.

**Fail Test:** Run `gh copilot` and try to invoke an MCP tool — will fail.
**Fix Test:** Use `gh copilot` in "suggest" mode or switch to GitHub Copilot Coding Agent (if available).
**Smoke Test:** Send @copilot message, verify prompt is injected but MCP tools are NOT called.
**Verify:** `gh copilot --help` for current flags.

---

#### 6. Aider (`aider`)
**Config (app.py line 1150):** `["--yes"]`

**Actual tmux command:** `aider --yes`

**ISSUES:**
- `--yes` auto-confirms file edits
- Aider has no native MCP support
- No built-in MCP injection config in wrapper.py for aider

**Fail Test:** Start aider, verify `--yes` flag is present.
**Fix Test:** Aider supports `--message` for non-interactive input. MCP integration would need a custom adapter.
**Smoke Test:** Send @aider, verify prompt injection works via tmux send-keys.
**Verify:** `aider --help` for current flags.

---

#### 7. Goose (`goose`)
**Config (app.py line 1151):** `[]` (empty)

**ISSUE:** Goose (by Block/Square) supports MCP natively via its config file at `~/.config/goose/config.yaml`. But GhostLink has no built-in injection for it.

**Fail Test:** Spawn goose, verify no MCP config is passed.
**Fix Test:** Add `mcp_inject: "settings_file"` for Goose with config path.
**Smoke Test:** After fix, verify Goose can call GhostLink MCP tools.
**Verify:** `goose --help` and check `~/.config/goose/config.yaml` format.

---

#### 8. Ollama (`ollama`)
**Config (app.py line 1157):** `[]` (empty)

**ISSUE:** Ollama is a model runner, not an agent. Running `ollama` in tmux gives a REPL, but it can't make MCP tool calls. It needs a wrapper agent (like a custom Python script using the Ollama API).

**Fail Test:** Spawn ollama, send @ollama — prompt is injected but no MCP tool calls.
**Fix Test:** Use an agent framework on top of Ollama (e.g., LangChain + Ollama + MCP client).
**Smoke Test:** N/A for raw ollama — needs agent wrapper.
**Verify:** `ollama --help` — confirms it's a model server, not an agent.

---

#### 9-13. Pi, Cursor, Cody, Continue, OpenCode
All have `[]` (empty args) and no MCP injection configuration. These are placeholders — none will successfully connect to GhostLink's MCP bridge.

---

### Summary: Which Agents Actually Work with GhostLink?

| Agent | CLI Exists | Auto-Approve | MCP Support | GhostLink Status |
|-------|-----------|-------------|-------------|-----------------|
| Claude Code | ✅ | ✅ `--dangerously-skip-permissions` | ✅ `--mcp-config` | **WORKS** |
| Codex CLI | ✅ | ✅ `-a never` | ⚠️ `-c` flag (fragile) | **MOSTLY WORKS** |
| Gemini CLI | ✅ | ⚠️ `-y` (unverified) | ✅ env var + JSON | **PARTIALLY WORKS** |
| Aider | ✅ | ✅ `--yes` | ❌ No MCP | **PROMPT ONLY** |
| Goose | ✅ | ❌ None | ✅ Config file | **NEEDS CONFIG** |
| Copilot | ✅ | ❌ None | ❌ No MCP | **PROMPT ONLY** |
| Grok | ⚠️ Community | ❌ None | ❌ No MCP | **BROKEN** |
| Ollama | ✅ | N/A | ❌ Not an agent | **BROKEN** |
| Pi/Cursor/Cody/Continue/OpenCode | ⚠️ | ❌ | ❌ | **PLACEHOLDER** |

---

## 4. MCP Config Injection System

### How It Works (wrapper.py lines 135-231)

The injection system has 5 modes:

1. **`flag`** — Pass `--mcp-config path.json` on CLI (used by Claude Code)
2. **`env`** — Set env var pointing to settings JSON (used by Gemini CLI)
3. **`proxy_flag`** — Pass inline config flags (used by Codex CLI)
4. **`settings_file`** — Write/merge a settings JSON file (available but unused)
5. **`env_content`** — Pass config content in env var (available but unused)

### MCP Config JSON Format (Claude Code)
```json
{
  "mcpServers": {
    "ghostlink": {
      "type": "http",
      "url": "http://127.0.0.1:8200/mcp"
    },
    // ... any existing project MCP servers merged in
  }
}
```

### MCP Settings JSON Format (Gemini CLI)
```json
{
  "mcpServers": {
    "ghostlink": {
      "type": "http",
      "httpUrl": "http://127.0.0.1:8200/mcp",
      "url": "http://127.0.0.1:8200/mcp",
      "trust": true
    }
  },
  "systemInstruction": "# GhostLink Agent Context\n..."
}
```

### Known Issues

#### BUG-MCP-1: Claude Code MCP config not picked up on first run
**Fail Test:** Start Claude Code with `--mcp-config` pointing to a new file that didn't exist before startup. Claude may not detect the MCP server.
**Fix Test:** The config file must exist BEFORE Claude Code starts. wrapper.py writes it at line 219-222, which happens before `run_agent()` at line 928. This should be correct. The issue may be that Claude Code caches MCP config at startup and doesn't re-read.
**Approach A:** Write config file, then start agent (current approach — should work).
**Approach B:** If Claude Code requires `.mcp.json` in the project directory, write there instead.
**Smoke Test:** After spawning Claude, run `tmux capture-pane -t ghostlink-claude-1 -p` and look for "Connected to MCP server: ghostlink" in the output.
**Verify:** Check Claude Code docs for `--mcp-config` behavior — does it accept HTTP transport? Does it need `streamable-http`?

#### BUG-MCP-2: Codex proxy_flag template produces fragile command
**Fail Test:** The template `-c mcp_servers.{server}.url="{url}"` is split by spaces (line 229), which means the URL with port gets quoted wrong if it contains special characters.
**Fix Test:** Use shlex.split() instead of str.split() for the expanded template.
**Smoke Test:** Spawn codex, verify the tmux command has correct `-c` flag.
**Verify:** `codex --help` for the `-c` flag format.

#### BUG-MCP-3: Gemini settings JSON dual-key confusion
**Fail Test:** Write a settings file with both `httpUrl` and `url` keys. Check which one Gemini CLI reads.
**Fix Test:** Remove the redundant key. If Gemini CLI reads `httpUrl`, only write that. If it reads `url`, only write that.
**Smoke Test:** Spawn gemini, check MCP bridge logs for connection.
**Verify:** Gemini CLI source code or docs for settings JSON schema.

#### BUG-MCP-4: Bearer token not verified on MCP bridge
**Fail Test:** Make an MCP tool call to port 8200 with a random/empty Authorization header — see if it's accepted.
**Fix Test:** The MCP bridge extracts the token (line 152) but the verification logic at `_resolve_identity` (line 169) only uses it for identity lookup, not hard rejection.
**Smoke Test:** After fix, verify that invalid tokens produce 401 errors.
**Verify:** Check that legitimate agent connections still work.

---

## 5. Gemini PATH Detection Fix

### The Problem (app.py lines 1102-1128)

The `_check_available()` function tries to find agent CLIs in this order:
1. `shutil.which(cmd)` — checks Windows PATH
2. API key env vars
3. WSL `which` / `command -v`
4. WSL hardcoded paths (`~/.nvm/versions/node/*/bin/`, `/usr/local/bin/`, `npm root -g`)

**Why Gemini detection fails:**
- Gemini CLI is installed via `npm install -g @anthropic-ai/gemini-cli` (or similar npm package)
- In WSL, npm global binaries go to `~/.nvm/versions/node/v{version}/bin/` or `~/.npm-global/bin/`
- The glob pattern on line 1114 (`$HOME/.nvm/versions/node/*/bin/{cmd}`) uses `test -f` which doesn't expand globs
- `which gemini` in WSL may fail if NVM isn't loaded in the login shell

### Fail Test
```bash
# From Windows (where GhostLink server runs):
wsl bash -lc 'which gemini'
# Returns nothing even though gemini is installed

# But this works:
wsl bash -ic 'which gemini'
# Returns /home/user/.nvm/versions/node/v22.0.0/bin/gemini
```
The difference: `-l` (login shell) vs `-i` (interactive shell). NVM is loaded in `.bashrc` (interactive), not `.profile` (login).

### Fix Test
**Approach A (Best):** Use `bash -ic` instead of `bash -lc` for WSL checks:
```python
['wsl', 'bash', '-ic', check]  # Interactive shell loads .bashrc where NVM lives
```
**Approach B:** Source NVM explicitly:
```python
f'source ~/.nvm/nvm.sh 2>/dev/null; which {cmd} 2>/dev/null'
```
**Approach C:** Check the NVM path directly:
```python
f'ls ~/.nvm/versions/node/*/bin/{cmd} 2>/dev/null | head -1'
```
(This already exists on line 1114 but uses `test -f` which doesn't glob.)

**Best approach: A** — changing `-lc` to `-ic` is a one-line fix that solves the root cause for ALL npm-installed agents (gemini, aider, etc.).

### Smoke Test
After fix:
1. `GET /api/agent-templates` should return `gemini` with `available: true`
2. Spawning gemini should succeed without "not found on PATH" error

### Verify
- Confirm `-ic` doesn't cause issues with non-interactive scripts
- Confirm WSL doesn't prompt for input when using `-i`
- Test on a system without NVM to ensure graceful fallback

---

## 6. All API Endpoints (95+)

### Messages (10 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/messages | 664 | Since/limit pagination |
| POST | /api/send | 673 | Main message send |
| POST | /api/messages/{id}/pin | 735 | Toggle pin |
| POST | /api/messages/{id}/react | 749 | Add emoji reaction |
| PATCH | /api/messages/{id} | 763 | Edit message |
| POST | /api/messages/{id}/bookmark | 778 | Toggle bookmark |
| POST | /api/messages/{id}/progress-update | 788 | Progress broadcast |
| DELETE | /api/messages/{id} | 797 | Delete message |
| POST | /api/messages/bulk-delete | 814 | Delete up to 200 |
| POST | /api/upload | 849 | Image upload |

### Agent Lifecycle (8 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| POST | /api/register | 1040 | Agent self-registration |
| POST | /api/deregister/{name} | 1053 | Agent removal |
| GET | /api/agent-templates | 1062 | Available agents |
| POST | /api/pick-folder | 1173 | OS folder picker |
| POST | /api/spawn-agent | 1213 | Start agent process |
| POST | /api/kill-agent/{name} | 1317 | Stop agent |
| POST | /api/cleanup | 1356 | Kill stale sessions |
| POST | /api/shutdown | 1394 | Graceful shutdown |

### Agent State (10 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| POST | /api/agents/{name}/pause | 1462 | Pause agent |
| POST | /api/agents/{name}/resume | 1472 | Resume agent |
| POST | /api/heartbeat/{name} | 1521 | Heartbeat + status |
| POST | /api/agents/{name}/thinking | 1569 | Update thinking |
| GET | /api/agents/{name}/thinking | 1592 | Get thinking |
| GET | /api/agents/{name}/config | 2716 | Get config |
| POST | /api/agents/{name}/config | 2738 | Set config |
| GET | /api/agents/{name}/soul | 2675 | Get identity |
| POST | /api/agents/{name}/soul | 2684 | Set identity |
| GET | /api/agents/{name}/health | 2707 | Health check |

### Channels (5 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/channels | 928 | List channels |
| POST | /api/channels | 933 | Create channel |
| DELETE | /api/channels/{name} | 951 | Delete channel |
| PATCH | /api/channels/{name} | 965 | Rename channel |
| GET | /api/channels/{name}/summary | 986 | AI summary |

### Jobs/Rules/Schedules (12 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/jobs | 1657 | List jobs |
| POST | /api/jobs | 1675 | Create job |
| PATCH | /api/jobs/{id} | 1678 | Update job |
| DELETE | /api/jobs/{id} | 1691 | Delete job |
| GET | /api/rules | 1696 | List rules |
| GET | /api/rules/active | 1702 | Active rules only |
| POST | /api/rules | 1717 | Propose rule |
| PATCH | /api/rules/{id} | 1720 | Update rule |
| GET | /api/schedules | 1733 | List schedules |
| POST | /api/schedules | 1749 | Create schedule |
| PATCH | /api/schedules/{id} | 1752 | Update schedule |
| DELETE | /api/schedules/{id} | 1764 | Delete schedule |

### Sessions (8 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/session-templates | 1769 | List templates |
| POST | /api/session-templates | 1778 | Create template |
| GET | /api/sessions/{ch} | 1787 | Get session |
| POST | /api/sessions/{ch}/start | 1793 | Start session |
| POST | /api/sessions/{ch}/advance | 1817 | Next phase |
| POST | /api/sessions/{ch}/end | 1833 | End session |
| POST | /api/sessions/{ch}/pause | 1842 | Pause |
| POST | /api/sessions/{ch}/resume | 1849 | Resume |

### Security (12 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/security/secrets | 2104 | List secret keys |
| POST | /api/security/secrets | 2110 | Store secret |
| DELETE | /api/security/secrets/{key} | 2125 | Delete secret |
| GET | /api/security/exec-policies | 2133 | List policies |
| GET | /api/security/exec-policy/{name} | 2138 | Get policy |
| POST | /api/security/exec-policy/{name} | 2148 | Set policy |
| POST | /api/security/check-command | 2151 | Verify command |
| GET | /api/security/audit-log | 2163 | Query audit log |
| GET | /api/security/retention | 2168 | Get retention |
| POST | /api/security/retention | 2178 | Set retention |
| GET | /api/security/export | 2181 | GDPR export |
| POST | /api/security/delete-all | 2194 | GDPR erasure |

### Plugins/Marketplace (9 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/plugins | 522 | List plugins |
| POST | /api/plugins/{name}/enable | 526 | Enable |
| POST | /api/plugins/{name}/disable | 531 | Disable |
| POST | /api/plugins/install | 536 | Install custom |
| DELETE | /api/plugins/{name} | 551 | Uninstall |
| POST | /api/plugins/scan | 2239 | Safety scan |
| GET | /api/marketplace | 2215 | Browse |
| POST | /api/marketplace/{id}/install | 2223 | Install from market |
| POST | /api/marketplace/{id}/uninstall | 2232 | Uninstall |

### Providers (5 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/providers | 2464 | Status |
| POST | /api/providers/configure | 2470 | Set API key |
| POST | /api/providers/{id}/test | 2503 | Test key |
| GET | /api/providers/{id}/models | 2546 | List models |
| GET | /api/providers/resolve/{cap} | 2563 | Find best provider |

### Export/Import (4 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/export | 2574 | Channel export |
| GET | /api/share | 2609 | Shareable HTML |
| GET | /api/snapshot | 2977 | Full snapshot |
| POST | /api/snapshot/import | 3002 | Import snapshot |

### Bridges (5 endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/bridges | 2323 | Bridge status |
| POST | /api/bridges/{platform}/configure | 2329 | Configure |
| POST | /api/bridges/{platform}/start | 2339 | Start bridge |
| POST | /api/bridges/{platform}/stop | 2348 | Stop bridge |
| POST | /api/bridges/inbound | 2355 | Receive external |

### Other (15+ endpoints)
| Method | Path | Lines | Notes |
|--------|------|-------|-------|
| GET | /api/status | 869 | Agent status |
| GET/POST | /api/settings | 874-923 | Settings |
| GET | /api/search | 1482 | Full-text search |
| GET | /api/ws-token | 626 | WebSocket auth |
| GET | /api/dashboard | 2874 | Stats |
| GET | /api/activity | 1866 | Activity log |
| GET | /api/server-config | 1913 | Server config |
| GET | /api/preview | 2020 | URL preview |
| GET | /api/hierarchy | 2654 | Agent tree |
| POST | /api/trigger | 2396 | External trigger |
| POST | /api/dm-channel | 3107 | Create DM |
| POST | /api/tunnel/start | 3137 | Cloudflare tunnel |
| POST | /api/approval/respond | 1603 | Approval response |
| GET/POST | /api/templates | 3071-3076 | Message templates |
| GET/POST | /api/usage | 1943/3210 | Token usage (DUPLICATE!) |

---

## 7. Module-by-Module Analysis

### store.py (281 lines) — Message Store
**Purpose:** SQLite-backed persistence with WAL mode, FTS5 full-text search
**Key Issues:**
- Message callbacks (`_on_message`) called without error handling — one failure breaks all
- Silent migration failures (catches all exceptions on column migrations)
- `lastrowid` may be unsafe in concurrent WAL mode

### registry.py (126 lines) — Agent Registry
**Purpose:** Tracks connected agent instances with tokens and lifecycle
**Key Issues:**
- No automatic token rotation
- Expired tokens persist in memory indefinitely
- Slot renaming not atomic

### router.py (82 lines) — Message Router
**Purpose:** Routes messages via @mentions and keyword classification
**Key Issues:**
- Loop counter resets for human messages but doesn't persist between cycles
- Keyword classification is naive substring matching

### jobs.py (109 lines) — Job Store
**Purpose:** Task tracking with status and assignment
**Key Issues:**
- No audit trail for who changed what
- No validation of job types

### rules.py (113 lines) — Rule Store
**Purpose:** Shared system rules with activation limits
**Key Issues:**
- Epoch counter is in-memory only — lost on restart
- No rule conflict detection
- Hard limit of 10 active rules

### skills.py (325 lines) — Skills Registry
**Purpose:** 30+ built-in skills with per-agent assignments
**Key Issues:**
- Skill configs saved in plaintext without encryption
- No validation of custom skill JSON
- Thread-unsafe dict access

### schedules.py (171 lines) — Schedule Store
**Purpose:** Cron-like task scheduling
**Key Issues:**
- No timezone support
- Incomplete cron spec (no L, W, ? support)
- Day-of-week calculation may have off-by-one for Sunday

### sessions.py (214 lines) — Session Manager
**Purpose:** Structured multi-phase conversations
**Key Issues:**
- State not persisted — lost on restart
- No session timeout
- Turn allocation logic may be uneven

### bridges.py (553 lines) — Bridge Manager
**Purpose:** Discord/Telegram/Slack/WhatsApp/webhook integration
**Key Issues:**
- Tokens logged on bridge start
- Message cache doesn't include channel context — collision risk
- No rate limiting for outbound messages
- Threads not joined on stop

### plugin_sdk.py (590 lines) — Plugin SDK
**Purpose:** Event bus, safety scanner, marketplace, hooks
**Key Issues:**
- Event handler exceptions silenced
- SafetyScanner doesn't check `open()`, `requests`, `urllib`
- 5 plugins hardcoded as embedded code strings
- Hook trigger via file write is racy

### plugin_loader.py (200 lines) — Plugin Loader
**Purpose:** Discovery, loading, validation of plugins
**Key Issues:**
- Manifest not written atomically
- sys.path injection without cleanup
- No plugin version conflict resolution

### security.py (413 lines) — Security Manager
**Purpose:** Encryption, exec policy, GDPR, audit
**Key Issues:**
- **CRITICAL:** XOR encryption fallback is trivially crackable
- **CRITICAL:** Key derivation uses predictable machine data (PATH + username), no random salt
- **CRITICAL:** Fernet salt is hardcoded (`b"ghostlink-v1"`)
- Command check splits on space — bypassable with quoted args
- GDPR export not transactionally isolated

### mcp_bridge.py (1,587 lines) — MCP Bridge
**Purpose:** 30+ MCP tools served on HTTP and SSE ports
**Key Issues:**
- Token extraction fragile — assumes specific header structure
- Cursor escalation counter incremented but never used
- No backpressure on bridge callbacks

### mcp_proxy.py (244 lines) — MCP Identity Proxy
**Purpose:** Stamps agent identity on MCP requests
**Key Issues:**
- Sender injection unconditionally trusted
- Dynamic port binding race condition
- Request size unbounded

### agent_memory.py (240 lines) — Agent Memory
**Purpose:** Per-agent persistent key-value store
**Key Issues:**
- Path sanitization could cause collisions
- Memory cache never expires
- No size limits on stored memories

---

## 8. Complete Bug Registry with Test Plans

### CRITICAL SEVERITY

#### BUG-C1: XOR Encryption Fallback Is Cryptographically Broken
**Location:** security.py lines 64-66
**Description:** When `cryptography` package isn't installed, secrets are "encrypted" with single-key XOR, which is trivially reversible.
**Impact:** All stored API keys/secrets exposed if attacker accesses `secrets.enc`

**Fail Test:**
1. Uninstall `cryptography` package: `pip uninstall cryptography`
2. Store a secret via `POST /api/security/secrets` with `key: "test", value: "my-secret-key"`
3. Read `data/secrets.enc` — base64 decode the value
4. XOR the decoded bytes with `SHA256(data_dir + ":" + username)` — plaintext recovered

**Fix Test:**
**Approach A (Best):** Make `cryptography` a hard dependency (it already IS in requirements.txt). Raise on startup if not found:
```python
if not HAS_FERNET:
    raise RuntimeError("cryptography package required for secrets — pip install cryptography")
```
**Approach B:** Use a stronger fallback like AES-GCM from stdlib `hashlib` + `os.urandom`.
**Best: A** — simplest, `cryptography` is already a listed dependency.

**Smoke Test:** Verify secrets are still readable after restart. Store a new secret, read it back.
**Verify:** `pip list | grep cryptography` confirms it's installed. Test on fresh venv.

---

#### BUG-C2: Predictable Encryption Key Derivation
**Location:** security.py lines 51-54
**Description:** Key material is `f"{data_dir}:{username}"` — both values are predictable on any given machine.
**Impact:** Anyone with filesystem access can derive the key and decrypt all secrets.

**Fail Test:**
1. Print `self._data_dir` and `os.getenv('USER')` — both known to any local process
2. Compute `SHA256(f"{data_dir}:{username}")` — this IS the encryption key
3. Decrypt any secret in `secrets.enc` using this key

**Fix Test:**
**Approach A (Best):** Generate a random master key on first run, store in a separate file with restricted permissions:
```python
key_file = data_dir / ".master_key"
if not key_file.exists():
    key_file.write_bytes(os.urandom(32))
    os.chmod(key_file, 0o600)
material = key_file.read_bytes()
```
**Approach B:** Use OS keyring via `keyring` package.
**Best: A** — no new dependencies, significantly stronger.

**Smoke Test:** Delete `secrets.enc`, restart, store new secret, verify decryption still works. Verify that two machines with same username produce different keys.
**Verify:** Key file has 600 permissions. Existing secrets are migrated on first startup after fix.

---

#### BUG-C3: Hardcoded Fernet Salt
**Location:** security.py line 58
**Description:** `salt=b"ghostlink-v1"` is the same on every installation.
**Impact:** Reduces PBKDF2 to a deterministic function of the master key, enabling rainbow table attacks.

**Fail Test:** On two different machines with same username, verify the derived Fernet key is identical.

**Fix Test:** Generate a random salt per-installation:
```python
salt_file = data_dir / ".salt"
if not salt_file.exists():
    salt_file.write_bytes(os.urandom(16))
salt = salt_file.read_bytes()
```

**Smoke Test:** Verify existing secrets still decrypt (migration needed for old salt).
**Verify:** Salt file exists with 16 random bytes. Two installations have different salts.

---

#### BUG-C4: Duplicate `/api/usage` Endpoint
**Location:** app.py lines 1943 and 3210
**Description:** Two conflicting implementations. FastAPI registers the last one, silently shadowing the first.
**Impact:** The POST handler at line 1943 (`_usage` dict) and GET handler at line 3210 (`_usage_log` list) return different data structures.

**Fail Test:**
1. `POST /api/usage` with token data — stored in `_usage` dict
2. `GET /api/usage` — returns from `_usage_log` list (different data!)
3. The POST data never appears in GET responses

**Fix Test:** Merge both into a single coherent implementation. The GET should return from the same store that POST writes to.

**Smoke Test:** POST usage data, then GET it back, verify round-trip consistency.
**Verify:** Frontend token usage display shows correct data.

---

#### BUG-C5: Race Condition in Agent Process Tracking
**Location:** app.py lines 1288-1304, 1341-1344
**Description:** Processes stored as `{base}_{pid}` but wrapper registers with auto-assigned name. Kill logic searches by name prefix, potentially killing the wrong process.

**Fail Test:**
1. Spawn two Claude agents: `claude-1` and `claude-2`
2. Kill `claude-1` via `/api/kill-agent/claude-1`
3. Check if `claude-2`'s process is also terminated (prefix match on "claude")

**Fix Test:** Store processes by their registered name (the name returned from `/api/register`), not by `{base}_{pid}`. Query the registry for the actual assigned name before storing.

**Smoke Test:** Spawn 2 agents with same base, kill one, verify the other is still running.
**Verify:** `tmux list-sessions` shows the surviving agent's session.

---

### HIGH SEVERITY

#### BUG-H1: Thinking Buffer Memory Leak
**Location:** app.py lines 1576-1587
**Description:** `_thinking_buffers` dict never cleaned up. Old agents' buffers accumulate indefinitely.
**Impact:** Memory grows over time with agent churn.

**Fail Test:** Spawn 100 agents, kill them all, check `len(_thinking_buffers)` — should be 100.
**Fix Test:** Clean up buffer in deregister flow. Add TTL-based expiry.
**Smoke Test:** After fix, `len(_thinking_buffers)` stays bounded.
**Verify:** Active agents' thinking still works after cleanup.

---

#### BUG-H2: Settings Mutations Without Lock
**Location:** app.py lines 909-910, 944-945, 958-959, 977-978
**Description:** `_settings` dict modified from multiple async handlers and background threads without synchronization.
**Impact:** Lost updates, corrupted settings on concurrent writes.

**Fail Test:** Send 10 concurrent `POST /api/settings` requests with different values. Check final state for consistency.
**Fix Test:** Add `asyncio.Lock()` around all `_settings` mutations.
**Smoke Test:** Concurrent settings writes produce consistent results.
**Verify:** No deadlocks. Settings persist correctly to disk.

---

#### BUG-H3: Webhook Delivery Fire-and-Forget
**Location:** app.py lines 338-339, 342-365
**Description:** Background thread delivery with no retry, no queue persistence. Failed webhooks silently dropped.
**Impact:** External integrations miss messages.

**Fail Test:** Configure a webhook to an unreachable URL, send a message, check — no error reported.
**Fix Test:** Add retry with exponential backoff (3 attempts). Log failures to audit log.
**Smoke Test:** Temporarily down webhook receives messages after retry.
**Verify:** Normal webhook delivery not slowed by retry logic.

---

#### BUG-H4: Process Termination Without SIGKILL Escalation
**Location:** app.py lines 1347, 1405
**Description:** `proc.terminate()` sends SIGTERM but never escalates to SIGKILL. Hung processes stay forever.
**Impact:** Zombie agent processes accumulate.

**Fail Test:** Start an agent that ignores SIGTERM. Call `/api/kill-agent` — process stays.
**Fix Test:** `proc.terminate()`, wait 5s, check `proc.poll()`, if still alive: `proc.kill()`.
**Smoke Test:** Even hung processes are cleaned up within 5s.
**Verify:** Normal agents still exit cleanly on SIGTERM.

---

#### BUG-H5: Approval Response File Race
**Location:** wrapper.py lines 1618-1624
**Description:** Approval response written to file, wrapper polls and reads. Non-atomic write means wrapper could read partial JSON.
**Impact:** Approval responses silently fail, agent hangs waiting.

**Fail Test:** Write a large approval response JSON while wrapper is polling at high frequency.
**Fix Test:** Write to temp file, then atomic rename: `tmp.write()` → `os.replace(tmp, target)`.
**Smoke Test:** Rapid approval responses all processed correctly.
**Verify:** File system supports atomic rename (all POSIX systems do).

---

#### BUG-H6: Agent Config Workspace Path Traversal
**Location:** app.py lines 2744-2754
**Description:** `workspace` field accepts up to 500 chars with no path validation. Could contain `../../etc/passwd`.
**Impact:** Agents could be pointed to read arbitrary directories.

**Fail Test:** `POST /api/agents/claude-1/config` with `workspace: "../../../../etc"` — check if accepted.
**Fix Test:** Validate workspace path: resolve, check it exists, check it's within allowed boundaries.
**Smoke Test:** Valid paths accepted, traversal paths rejected.
**Verify:** Existing agent configs with relative paths still work.

---

#### BUG-H7: Bridge Token Exposure in Logs
**Location:** bridges.py line 235
**Description:** Discord/Telegram bot tokens printed on bridge start.
**Impact:** Tokens visible in server logs, terminal output.

**Fail Test:** Start Discord bridge, check stdout — full token printed.
**Fix Test:** Mask token in log output: `token[:8] + "..." + token[-4:]`.
**Smoke Test:** Bridge starts successfully, token not fully visible in logs.
**Verify:** Tokens still used correctly for API calls.

---

### MEDIUM SEVERITY

#### BUG-M1: FTS5 Error Silent Fallback
**Location:** app.py lines 1504-1505
**Description:** Any FTS5 error falls back to LIKE search silently.
**Impact:** Could mask SQL injection attempts or malformed queries.

**Fail Test:** Search for `"DROP TABLE messages --` — silently falls back to LIKE.
**Fix Test:** Log the FTS5 error before fallback. Validate search input.
**Smoke Test:** Legitimate searches work. Malformed queries logged.
**Verify:** FTS5 fallback still functions for genuine FTS5 unavailability.

---

#### BUG-M2: Message Reactions Unbounded
**Location:** store.py (react function)
**Description:** Reactions appended without limit. One message could have thousands.
**Impact:** Memory bloat, slow message rendering.

**Fail Test:** Add 1000 reactions to a single message. Check response size.
**Fix Test:** Cap at 50 reactions per message. Reject with 429 after limit.
**Smoke Test:** Normal reactions work. 51st reaction rejected.
**Verify:** Frontend handles the rejection gracefully.

---

#### BUG-M3: Skills Config Stored in Plaintext
**Location:** skills.py
**Description:** Per-skill configurations (which may contain API keys) saved to `skills_config.json` without encryption.
**Impact:** API keys readable by any local process.

**Fail Test:** Configure a skill with an API key, read `skills_config.json` — key in plaintext.
**Fix Test:** Use `SecretsManager` for skill config values that look like keys/tokens.
**Smoke Test:** Skill configs still load. API keys not readable in JSON file.
**Verify:** Skills that need the API key can still retrieve it.

---

#### BUG-M4: Schedule Checker No Timezone Support
**Location:** schedules.py
**Description:** Cron times relative to server timezone. No timezone-aware scheduling.
**Impact:** Schedules fire at wrong times for users in different timezones.

**Fail Test:** Set a schedule for "0 9 * * *" (9 AM), server is UTC, user is PST — fires at 1 AM user time.
**Fix Test:** Add optional `timezone` field to schedules. Use `zoneinfo` for conversion.
**Smoke Test:** Schedule with TZ fires at correct local time.
**Verify:** Existing schedules without TZ default to server time.

---

#### BUG-M5: Plugin Safety Scanner Incomplete
**Location:** plugin_sdk.py (SafetyScanner)
**Description:** AST-based scanner doesn't check `open()`, `urllib`, `requests`, destructive file ops.
**Impact:** Malicious plugins could exfiltrate data or destroy files.

**Fail Test:** Install a plugin that does `open('/etc/passwd').read()` — scanner doesn't flag it.
**Fix Test:** Add checks for `open`, `urllib.request`, `requests.get`, `os.remove`, `shutil.rmtree`.
**Smoke Test:** Legitimate plugins still pass. Dangerous plugins flagged.
**Verify:** No false positives on existing built-in plugins.

---

#### BUG-M6: Session State Not Persisted
**Location:** sessions.py
**Description:** All session state is in-memory. Server restart loses everything.
**Impact:** Multi-phase sessions lost on crash or restart.

**Fail Test:** Start a session, advance to phase 2, restart server, check session — gone.
**Fix Test:** Save session state to SQLite on each state change.
**Smoke Test:** Session survives server restart.
**Verify:** Session performance not degraded by DB writes.

---

#### BUG-M7: Rule Epoch Counter In-Memory Only
**Location:** rules.py
**Description:** Epoch counter lost on restart.
**Impact:** Rule versioning inconsistent after restart.

**Fail Test:** Create rules (epoch=3), restart, check epoch — reset to 0.
**Fix Test:** Persist epoch to DB alongside rules.
**Smoke Test:** Epoch persists across restarts.
**Verify:** Rule version comparisons work correctly.

---

### LOW SEVERITY

#### BUG-L1: Hardcoded Provider Pricing
**Location:** app.py lines 152-164
**Impact:** Cost estimates diverge from reality over time.

#### BUG-L2: Console Output Discarded
**Location:** app.py lines 1284-1285 (`stdout=PIPE, stderr=PIPE` but never read)
**Impact:** Agent startup errors invisible.

#### BUG-L3: `_empty_read_count` Counter Never Used
**Location:** mcp_bridge.py line 48
**Impact:** Dead code, cursor escalation logic incomplete.

#### BUG-L4: Memory Cache Never Expires
**Location:** agent_memory.py line 127
**Impact:** Stale memory instances after agent rename.

#### BUG-L5: Day-of-Week Cron Calculation
**Location:** schedules.py line 126
**Impact:** Potential off-by-one for Sunday scheduling.

---

## 9. Security Audit

### Threat Model
GhostLink runs on localhost with agent processes in tmux. The primary threats are:
1. **Local privilege escalation** — malicious agent executes system commands
2. **Secret exfiltration** — API keys stolen from storage
3. **Agent impersonation** — one agent claims another's identity
4. **Plugin code injection** — malicious plugin installed
5. **Bridge token theft** — external platform tokens exposed

### Security Controls Present
| Control | Status | Notes |
|---------|--------|-------|
| Rate limiting | ✅ | 300 req/60s per IP |
| Input validation | ✅ | Agent name regex, message type whitelist |
| SSRF prevention | ✅ | Private URL blocking in URL preview |
| Webhook signatures | ✅ | HMAC-SHA256 verification |
| WebSocket auth | ✅ | Token-based, localhost-only |
| Execution policy | ✅ | Per-agent command allow/block lists |
| Audit logging | ✅ | JSONL-based with rotation |
| GDPR compliance | ✅ | Export + deletion |
| Secrets encryption | ⚠️ | Fernet, but key derivation is weak |
| Plugin scanning | ⚠️ | AST-based, but incomplete |

### Security Gaps
| Gap | Severity | Description |
|-----|----------|-------------|
| Predictable encryption key | CRITICAL | Derivable from public machine data |
| XOR fallback | CRITICAL | Trivially reversible |
| Hardcoded salt | HIGH | Same salt across all installations |
| No CSRF protection | MEDIUM | REST endpoints lack CSRF tokens |
| No Content-Security-Policy | MEDIUM | XSS risk in shared HTML exports |
| Bridge tokens in logs | HIGH | Full tokens printed on start |
| Plugin scanner gaps | MEDIUM | Missing `open()`, `requests`, `urllib` |
| Path traversal in configs | HIGH | Agent workspace not validated |

---

## 10. Performance Analysis

### Bottlenecks Identified

| Component | Issue | Impact |
|-----------|-------|--------|
| SQLite single-writer | All writes serialized | Message throughput limited |
| File-based IPC | Queue polling every 1s | High-frequency triggers delayed |
| Thinking buffer | Per-agent tmux capture every 2s | CPU cost scales with agents |
| Bridge polling | Discord/Telegram polled every 2-3s | Rate limit risk |
| WSL detection | 5 subprocess calls per agent | Template endpoint slow (~40s for 13 agents) |
| Global dict access | No connection pooling | Concurrent request bottleneck |

### Recommendations
1. **Agent template caching** — WSL detection results should be cached across requests (partially done with `_available_cache` but it's per-request local)
2. **Replace file-based IPC** with Unix domain sockets or SQLite queue
3. **Add connection pooling** for aiosqlite
4. **Batch tmux captures** — one subprocess call for all agents instead of per-agent

---

## 11. Comparison with Best-in-Class Platforms

### Claude Code (Anthropic)
| Feature | Claude Code | GhostLink | Gap |
|---------|------------|-----------|-----|
| MCP support | ✅ Native | ✅ Bridge | None |
| Permission system | ✅ Granular | ✅ Approval watcher | GhostLink more flexible |
| Multi-agent | ❌ Single agent | ✅ 13 agents | GhostLink advantage |
| Testing | ✅ Full suite | ❌ Zero tests | CRITICAL gap |
| Plugin system | ✅ Mature | ✅ Basic | GhostLink needs hardening |
| Persistence | ✅ Conversation history | ✅ SQLite | Comparable |

### OpenHands (formerly OpenDevin)
| Feature | OpenHands | GhostLink | Gap |
|---------|-----------|-----------|-----|
| Multi-agent | ✅ Agent delegation | ✅ Chat room model | Different paradigm |
| Sandbox | ✅ Docker containers | ❌ tmux only | CRITICAL gap |
| Testing | ✅ SWE-bench | ❌ Zero tests | CRITICAL gap |
| Web UI | ✅ Rich | ✅ Rich | Comparable |
| Agent types | 3-4 specialized | 13 generic | GhostLink wider but shallower |

### Codex CLI (OpenAI)
| Feature | Codex CLI | GhostLink | Gap |
|---------|-----------|-----------|-----|
| Sandbox | ✅ Network-isolated | ❌ Full access | HIGH gap |
| MCP support | ✅ `-c` flag | ✅ Proxy | Comparable |
| Multi-agent | ❌ Single | ✅ Multi | GhostLink advantage |
| Auto-approve | ✅ Granular levels | ✅ Per-tool | Comparable |

### Key Differentiators (Where GhostLink Excels)
1. **Multi-agent chat room** — No competitor has 13 AI agents in a shared conversation
2. **Provider diversity** — 13 providers with auto-failover
3. **Bridge system** — Discord/Telegram/Slack integration
4. **Approval UI** — Permission prompts surfaced in chat
5. **Agent identity/soul system** — Unique personality per agent

### Critical Gaps vs. Competition
1. **Zero automated tests** — Every competitor has test suites
2. **No containerized sandbox** — Agents have full system access
3. **No agent output verification** — No guardrails on what agents produce
4. **No conversation branching** — Can't fork/merge conversation threads
5. **No cost controls** — No per-agent spending limits
6. **Monolithic architecture** — Single 3,279-line file

---

## 12. Missing Features

### P0 (Must Have)
- Automated test suite (unit + integration)
- Container sandbox for agent execution
- Per-agent spending limits
- Proper secret key management

### P1 (Should Have)
- app.py decomposition into route modules
- Connection pooling for SQLite
- Agent output verification/guardrails
- Conversation branching/forking
- Proper error recovery for bridge failures

### P2 (Nice to Have)
- Agent-to-agent direct MCP calls (bypass chat)
- Conversation search with semantic matching
- Agent performance benchmarking
- Multi-tenancy support
- API versioning

---

*End of GAB Backend Audit*
