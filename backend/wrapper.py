"""Agent wrapper — launches CLI agents with MCP config and auto-triggers on @mentions.

Usage:
    python wrapper.py claude
    python wrapper.py codex
    python wrapper.py gemini

How it works:
  1. Registers with the GhostLink server (POST /api/register)
  2. Starts MCP identity proxy (if needed)
  3. Writes MCP config pointing agent CLI to the MCP bridge
  4. Starts agent in a tmux session
  5. Background thread polls queue file for @mentions
  6. On trigger, injects "mcp read #channel" via tmux send-keys
  7. Heartbeats keep the server aware of agent status
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).parent
SERVER_NAME = "ghostlink"
_CLI_PATH_HINTS = (
    str(Path.home() / ".npm-global" / "bin"),
    str(Path.home() / ".local" / "bin"),
    "/usr/local/bin",
)

# ── v2.5.0: ANSI escape code pattern for thinking output cleanup ──
_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[@-~]')

# Patterns to filter from thinking output (startup commands, flags, config paths)
_THINKING_FILTER_PATTERNS = [
    re.compile(r'--dangerously-skip-permissions', re.IGNORECASE),
    re.compile(r'--mcp-config\s+\S+'),
    re.compile(r'--sandbox\s+\S+'),
    re.compile(r'--full-auto'),
    re.compile(r'--permission-mode\s+\S+'),
    re.compile(r'GEMINI_CLI_SYSTEM_SETTINGS_PATH=\S+'),
    re.compile(r'provider-config/\S+'),
    re.compile(r'^\s*\$\s*(?:claude|codex|gemini|grok|aider|ollama)\b.*', re.MULTILINE),
    re.compile(r'^\s*env\s+-u\s+\S+.*$', re.MULTILINE),
]


def _expanded_cli_path(path_value: str | None = None) -> str:
    existing = [p for p in (path_value or os.environ.get("PATH", "")).split(os.pathsep) if p]
    ordered: list[str] = []
    for candidate in [*_CLI_PATH_HINTS, *existing]:
        if candidate and candidate not in ordered:
            ordered.append(candidate)
    return os.pathsep.join(ordered)


def _sanitize_thinking(text: str) -> str:
    """Clean raw tmux pane output for display as thinking content.

    Strips ANSI escape codes, filters startup commands/flags, removes
    blank lines and terminal artifacts.
    """
    # Strip ANSI escape codes
    text = _ANSI_RE.sub('', text)
    # Filter out command lines and config paths
    for pattern in _THINKING_FILTER_PATTERNS:
        text = pattern.sub('', text)
    # Remove blank/whitespace-only lines and collapse multiple newlines
    lines = [line for line in text.split('\n') if line.strip()]
    text = '\n'.join(lines)
    # Trim to reasonable length
    return text[-1500:] if len(text) > 1500 else text


# ── Per-instance provider config ────────────────────────────────────

def _write_claude_mcp_config(
    config_file: Path,
    url: str,
    *,
    token: str = "",
    project_servers: dict | None = None,
) -> Path:
    """Write a Claude Code --mcp-config file with bearer auth."""
    config_file.parent.mkdir(parents=True, exist_ok=True)
    servers = dict(project_servers or {})
    entry: dict = {"type": "http", "url": url}
    if token:
        entry["headers"] = {"Authorization": f"Bearer {token}"}
    servers[SERVER_NAME] = entry
    payload = {"mcpServers": servers}
    config_file.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    return config_file


def _write_json_mcp_settings(config_file: Path, url: str, transport: str = "http",
                              *, token: str = "") -> Path:
    """Write/merge a settings-style JSON file with nested mcpServers config.
    Used by Gemini CLI.

    v2.5.0: Fixed to support both httpUrl and url formats for MCP compatibility.
    Gemini CLI expects "httpUrl" for HTTP transport, "url" for SSE.
    """
    config_file.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if config_file.exists():
        try:
            existing = json.loads(config_file.read_text("utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  Warning: failed to read existing MCP settings: {e}")
    servers = existing.get("mcpServers", {})
    if transport in ("http", "streamable-http"):
        # Gemini CLI uses httpUrl for HTTP-based MCP servers
        entry: dict = {"type": "http", "httpUrl": url, "url": url, "trust": True}
    else:
        entry = {"type": transport, "url": url, "trust": True}
    if token:
        entry["headers"] = {"Authorization": f"Bearer {token}"}
    servers[SERVER_NAME] = entry
    existing["mcpServers"] = servers
    config_file.write_text(json.dumps(existing, indent=2) + "\n", "utf-8")
    return config_file


def _read_project_mcp_servers(project_dir: Path) -> dict:
    """Read existing MCP servers from the project's .mcp.json."""
    mcp_file = project_dir / ".mcp.json"
    if mcp_file.exists():
        try:
            data = json.loads(mcp_file.read_text("utf-8"))
            servers = data.get("mcpServers", {})
            servers.pop(SERVER_NAME, None)
            return servers
        except Exception as e:
            print(f"  Warning: failed to read .mcp.json: {e}")
    return {}


# ── Built-in provider defaults ──────────────────────────────────────

_BUILTIN_DEFAULTS: dict[str, dict] = {
    "claude": {
        "mcp_inject": "flag",
        "mcp_flag": "--mcp-config",
        "mcp_transport": "http",
        "mcp_merge_project": True,
    },
    "gemini": {
        "mcp_inject": "env",
        "mcp_env_var": "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
        "mcp_transport": "http",
        "mcp_merge_project": True,
    },
    "codex": {
        "mcp_inject": "proxy_flag",
        "mcp_proxy_flag_template": '-c mcp_servers.{server}.url="{url}"',
    },
    "grok": {
        "mcp_inject": "flag",
        "mcp_flag": "--mcp-config",
        "mcp_transport": "http",
        "mcp_merge_project": True,
    },
    "aider": {
        # Aider doesn't natively support MCP — uses proxy
        "mcp_inject": "proxy_flag",
        "mcp_proxy_flag_template": "",
    },
    "goose": {
        "mcp_inject": "env",
        "mcp_env_var": "GOOSE_MCP_CONFIG",
        "mcp_transport": "http",
    },
    "copilot": {
        # gh copilot doesn't support MCP — uses proxy
        "mcp_inject": "proxy_flag",
        "mcp_proxy_flag_template": "",
    },
}

_VALID_INJECT_MODES = {"settings_file", "env", "flag", "proxy_flag", "env_content"}


def _resolve_mcp_inject(agent: str, agent_cfg: dict) -> dict:
    """Resolve MCP injection config: explicit agent_cfg > built-in defaults > None."""
    inject_mode = agent_cfg.get("mcp_inject")
    if inject_mode:
        return dict(agent_cfg)
    if agent in _BUILTIN_DEFAULTS:
        merged = dict(_BUILTIN_DEFAULTS[agent])
        merged.update({k: v for k, v in agent_cfg.items() if k.startswith("mcp_")})
        return merged
    return {}


def _get_server_url(mcp_cfg: dict, transport: str) -> str:
    """Build the MCP server URL for the given transport."""
    if transport == "sse":
        port = mcp_cfg.get("sse_port", 8201)
        return f"http://127.0.0.1:{port}/sse"
    port = mcp_cfg.get("http_port", 8200)
    return f"http://127.0.0.1:{port}/mcp"


def _apply_mcp_inject(
    inject_cfg: dict,
    instance_name: str,
    data_dir: Path,
    proxy_url: str | None,
    *,
    token: str = "",
    mcp_cfg: dict | None = None,
    project_dir: Path | None = None,
) -> tuple[list[str], dict[str, str], Path | None]:
    """Apply MCP config injection based on the resolved inject config.

    Returns (extra_launch_args, inject_env, settings_path_or_None).
    """
    mode = inject_cfg.get("mcp_inject")
    if not mode:
        return [], {}, None

    launch_args: list[str] = []
    inject_env: dict[str, str] = {}
    settings_path: Path | None = None
    config_dir = (data_dir / "provider-config").resolve()
    transport = inject_cfg.get("mcp_transport", "http")
    server_url = _get_server_url(mcp_cfg or {}, transport)

    if mode == "env":
        env_var = inject_cfg.get("mcp_env_var")
        if not env_var:
            raise ValueError("mcp_inject = 'env' requires mcp_env_var")
        settings_path = _write_json_mcp_settings(
            config_dir / f"{instance_name}-settings.json",
            server_url, transport=transport, token=token,
        )
        inject_env[env_var] = str(settings_path)

    elif mode == "flag":
        flag = inject_cfg.get("mcp_flag", "--mcp-config")
        merge_project = inject_cfg.get("mcp_merge_project", False)
        project_servers = _read_project_mcp_servers(project_dir) if (merge_project and project_dir) else {}
        settings_path = _write_claude_mcp_config(
            config_dir / f"{instance_name}-mcp.json",
            server_url, token=token, project_servers=project_servers,
        )
        launch_args = [flag, str(settings_path.resolve())]

    elif mode == "proxy_flag":
        template = inject_cfg.get("mcp_proxy_flag_template",
                                  '-c mcp_servers.{server}.url="{url}"')
        expanded = template.format(server=SERVER_NAME, url=proxy_url or "")
        launch_args = shlex.split(expanded)  # shlex handles quoted URLs with spaces/special chars

    return launch_args, inject_env, settings_path


# ── Registration ────────────────────────────────────────────────────

def _register(server_port: int, base: str, label: str = "", role: str = "") -> dict:
    import urllib.request
    # Include our own pid so the server can link this process to the registered name.
    # This fixes the {base}_{pid} keying race in process tracking.
    payload = {"base": base, "label": label, "pid": os.getpid()}
    if role:
        payload["role"] = role
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{server_port}/api/register",
        method="POST",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def _deregister(server_port: int, name: str, token: str = ""):
    import urllib.request
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"http://127.0.0.1:{server_port}/api/deregister/{name}",
        method="POST",
        data=b"",
        headers=headers,
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        import logging
        logging.getLogger(__name__).debug("Deregister %s failed: %s", name, e)


def _auth_headers(token: str, *, include_json: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if include_json:
        headers["Content-Type"] = "application/json"
    return headers


# ── Approval prompt detection ──────────────────────────────────────

# Patterns that match permission/approval prompts in CLI output.
# Checked against the last 15 lines of tmux pane output.
_APPROVAL_PATTERNS = [
    # Claude Code: "Allow tool_name? (y/n)" or "(y)es, (n)o, (a)lways"
    re.compile(r'(?:Allow|Approve|Permit).*\?\s*\(([yYnNaA/\s,]+)\)\s*$', re.MULTILINE | re.IGNORECASE),
    # Claude Code MCP: "Do you want to proceed?" with numbered options
    re.compile(
        r'Do you want to proceed\?.*'
        r'[\s\S]*?1[.\)]\s*Yes'
        r'[\s\S]*?(?:2|3)[.\)]\s*(?:No|Deny)',
        re.MULTILINE | re.IGNORECASE,
    ),
    # Numbered options: "1) Allow/Yes  2) ... 3) Deny/No"  (with possible > cursor)
    re.compile(
        r'[>\s]*1[.\)]\s*(?:Allow|Yes|Accept|Approve).*'
        r'(?:[\s\S]*?2[.\)]\s*(?:Allow|Yes|Accept|Approve|Session|don).*)?'
        r'[\s\S]*?(?:2|3)[.\)]\s*(?:Deny|No|Reject|Cancel)',
        re.MULTILINE | re.IGNORECASE,
    ),
    # Generic y/n with question
    re.compile(
        r'(?:Do you want to|Would you like to|Should I)\s+'
        r'(?:allow|approve|permit|run|execute|proceed).*\?\s*'
        r'[\[\(]([yYnNaA/]+)[\]\)]',
        re.MULTILINE | re.IGNORECASE,
    ),
    # Approve plan / sandbox prompt: "Approve? (y/n)"
    re.compile(r'(?:Approve|Confirm|Continue)\??\s*[\[\(]([yYnNaA/]+)[\]\)]', re.MULTILINE | re.IGNORECASE),
]

# Matches actual MCP tool prompt format: "ghostlink/chat_read" or "ghostlink.chat_send"
_GHOSTLINK_MCP_RE = re.compile(
    r'ghostlink[/.](?:chat_read|chat_send|chat_join|chat_who|chat_channels|chat_rules|'
    r'chat_progress|chat_propose_job|chat_react|chat_claim|'
    r'memory_save|memory_load|memory_list|memory_search|memory_search_all|'
    r'web_search|web_fetch|image_generate|delegate|'
    r'set_thinking|sessions_list|sessions_send)',
    re.IGNORECASE,
)

# Key mappings: what key to inject for each response, per agent base
_APPROVAL_KEYMAPS: dict[str, dict[str, str]] = {
    "claude":   {"allow_once": "1", "allow_session": "2", "deny": "3"},
    "codex":    {"allow_once": "y", "allow_session": "a", "deny": "n"},
    "gemini":   {"allow_once": "y", "allow_session": "a", "deny": "n"},
    "_default": {"allow_once": "y", "allow_session": "a", "deny": "n"},
}


# v2.5.0: Shared channel tracking — updated by queue watcher, read by approval watcher
_last_channel = "general"
_last_channel_lock = threading.Lock()


def _set_last_channel(channel: str):
    global _last_channel
    with _last_channel_lock:
        _last_channel = channel


def _get_last_channel() -> str:
    with _last_channel_lock:
        return _last_channel


def _approval_watcher(
    session_name: str,
    get_identity_fn,
    agent_base: str,
    *,
    server_port: int = 8300,
    data_dir: Path,
):
    """Watch tmux pane for permission prompts, post to chat UI, wait for response, inject."""
    import urllib.request

    last_prompt_hash: int | None = None
    waiting = False
    waiting_since = 0.0
    APPROVAL_TIMEOUT = 120  # seconds before auto-deny

    while True:
        try:
            current_name, _ = get_identity_fn()
            response_file = data_dir / f"{current_name}_approval.json"

            if waiting:
                # Check for response file
                if response_file.exists():
                    try:
                        resp_data = json.loads(response_file.read_text("utf-8"))
                        response_file.unlink(missing_ok=True)
                    except Exception:
                        response_file.unlink(missing_ok=True)
                        waiting = False
                        last_prompt_hash = None
                        time.sleep(1)
                        continue

                    response = resp_data.get("response", "deny")
                    keymap = _APPROVAL_KEYMAPS.get(agent_base, _APPROVAL_KEYMAPS["_default"])
                    key = keymap.get(response, "n")

                    # Inject the key into tmux
                    subprocess.run(
                        ["tmux", "send-keys", "-t", session_name, key],
                        capture_output=True, timeout=3,
                    )
                    time.sleep(0.1)
                    subprocess.run(
                        ["tmux", "send-keys", "-t", session_name, "Enter"],
                        capture_output=True, timeout=3,
                    )

                    waiting = False
                    last_prompt_hash = None
                    time.sleep(1)
                    continue

                # Check for timeout
                if time.time() - waiting_since > APPROVAL_TIMEOUT:
                    # Auto-deny after timeout
                    keymap = _APPROVAL_KEYMAPS.get(agent_base, _APPROVAL_KEYMAPS["_default"])
                    subprocess.run(
                        ["tmux", "send-keys", "-t", session_name, keymap["deny"]],
                        capture_output=True, timeout=3,
                    )
                    time.sleep(0.1)
                    subprocess.run(
                        ["tmux", "send-keys", "-t", session_name, "Enter"],
                        capture_output=True, timeout=3,
                    )
                    response_file.unlink(missing_ok=True)
                    waiting = False
                    last_prompt_hash = None

                time.sleep(0.5)
                continue

            # Capture last 15 lines of tmux pane
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-15"],
                capture_output=True, timeout=3,
            )
            if result.returncode != 0:
                time.sleep(2)
                continue

            pane_text = result.stdout.decode("utf-8", errors="replace")
            if not pane_text.strip():
                time.sleep(1)
                continue

            # Check for approval patterns
            for pattern in _APPROVAL_PATTERNS:
                match = pattern.search(pane_text)
                if match:
                    prompt_hash = hash(match.group(0).strip())
                    if prompt_hash == last_prompt_hash:
                        break  # Already sent this prompt

                    # Auto-approve GhostLink MCP tool prompts (our own tools)
                    if _GHOSTLINK_MCP_RE.search(pane_text):
                        # Use the agent-specific keymap for "allow session" (safest approach)
                        keymap = _APPROVAL_KEYMAPS.get(agent_base, _APPROVAL_KEYMAPS["_default"])
                        key = keymap.get("allow_session", "a")
                        subprocess.run(["tmux", "send-keys", "-t", session_name, key], capture_output=True, timeout=3)
                        time.sleep(0.15)
                        subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], capture_output=True, timeout=3)
                        last_prompt_hash = prompt_hash
                        time.sleep(1)
                        break

                    # Check if auto-approve is enabled for this agent
                    try:
                        auto_approve_url = f"http://127.0.0.1:{server_port}/api/agents/{current_name}/config"
                        req = urllib.request.Request(auto_approve_url, method="GET")
                        with urllib.request.urlopen(req, timeout=3) as resp:
                            agent_config = json.loads(resp.read())
                            if agent_config.get("autoApprove"):
                                keymap = _APPROVAL_KEYMAPS.get(agent_base, _APPROVAL_KEYMAPS["_default"])
                                subprocess.run(
                                    ["tmux", "send-keys", "-t", session_name, keymap["allow_session"]],
                                    capture_output=True, timeout=3,
                                )
                                time.sleep(0.1)
                                subprocess.run(
                                    ["tmux", "send-keys", "-t", session_name, "Enter"],
                                    capture_output=True, timeout=3,
                                )
                                last_prompt_hash = prompt_hash
                                time.sleep(1)
                                break
                    except Exception:
                        pass  # Fall through to manual approval

                    # Extract context: last 10 non-empty lines
                    lines = [l for l in pane_text.strip().split('\n') if l.strip()]
                    context = '\n'.join(lines[-10:])

                    # Post to chat as approval_request message (v2.5.0: use tracked channel)
                    try:
                        body = json.dumps({
                            "sender": current_name,
                            "text": f"Permission prompt from {current_name}",
                            "type": "approval_request",
                            "channel": _get_last_channel(),
                            "metadata": json.dumps({
                                "agent": current_name,
                                "prompt": context,
                                "options": ["allow_once", "allow_session", "deny"],
                            }),
                        }).encode()
                        req = urllib.request.Request(
                            f"http://127.0.0.1:{server_port}/api/send",
                            data=body,
                            headers={"Content-Type": "application/json"},
                            method="POST",
                        )
                        urllib.request.urlopen(req, timeout=5)
                    except Exception as e:
                        import logging
                        logging.getLogger(__name__).debug("Failed to post approval request: %s", e)

                    last_prompt_hash = prompt_hash
                    waiting = True
                    waiting_since = time.time()
                    break

        except Exception as e:
            import logging
            logging.getLogger(__name__).debug("Approval watcher error: %s", e)
        time.sleep(1)


# ── Queue watcher ───────────────────────────────────────────────────

def _build_trigger_prompt(channel: str, agent_name: str, server_port: int,
                          *, get_token_fn=None, job_id=None) -> str:
    """Build a clean, self-contained trigger prompt with recent message context.

    Fetches the last few messages from the channel so the agent has full context
    and can respond immediately without needing to call chat_read first.
    """
    import urllib.request

    # Fetch recent messages for context
    recent_msgs = []
    try:
        url = f"http://127.0.0.1:{server_port}/api/messages?channel={channel}&limit=5"
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read())
            recent_msgs = data.get("messages", [])[-5:]
    except Exception:
        pass

    # Fetch online agents for peer awareness
    online_agents = []
    try:
        url = f"http://127.0.0.1:{server_port}/api/status"
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read())
            for a in data.get("agents", []):
                aname = a.get("name", "")
                if aname and aname != agent_name and a.get("state") in ("active", "idle", "pending"):
                    label = a.get("label", aname)
                    role = a.get("role", "")
                    base = a.get("base", "")
                    desc = f"@{aname}"
                    if label and label != aname:
                        desc += f' "{label}"'
                    if role:
                        desc += f" ({role})"
                    if base and base != aname:
                        desc += f" [{base}]"
                    online_agents.append(desc)
    except Exception:
        pass

    # Build the context
    parts = [f"[GhostLink #{channel}]"]

    if online_agents:
        parts.append(f"Online teammates: {', '.join(online_agents)}")

    if recent_msgs:
        parts.append("Recent messages:")
        for msg in recent_msgs:
            sender = msg.get("sender", "?")
            text = msg.get("text", "")[:300]
            if sender != agent_name:  # Don't show agent's own messages
                parts.append(f"  {sender}: {text}")
    else:
        parts.append("(Use chat_read to see messages)")

    if job_id:
        parts.append(f"Action: You were assigned job #{job_id}. Complete the task and report back.")
    else:
        parts.append(f"Action: Reply to the above using chat_send with channel=\"{channel}\".")

    return " | ".join(parts)


def _queue_watcher(get_identity_fn, inject_fn, *, server_port: int = 8300,
                   trigger_flag=None, agent_name: str = "", get_token_fn=None):
    """Poll queue file for @mention triggers, inject MCP read prompts."""
    while True:
        try:
            name, queue_file = get_identity_fn()
            if queue_file.exists() and queue_file.stat().st_size > 0:
                # Atomic read-and-clear: rename to .processing, read, delete.
                # New writes go to the original filename, so no triggers are lost.
                processing_file = queue_file.with_suffix(".processing")
                try:
                    queue_file.rename(processing_file)
                except (OSError, FileNotFoundError):
                    time.sleep(1)
                    continue
                with open(processing_file, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                processing_file.unlink(missing_ok=True)

                channel = "general"
                has_trigger = False
                job_id = None
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if isinstance(data, dict) and data:
                            if "channel" in data:
                                channel = data["channel"]
                            if "job_id" in data:
                                job_id = data["job_id"]
                            has_trigger = True
                    except json.JSONDecodeError:
                        continue

                if has_trigger:
                    _set_last_channel(channel)  # v2.5.0: track for approval watcher
                    if trigger_flag is not None:
                        trigger_flag[0] = True
                    time.sleep(0.5)

                    # v3.9.1: Fetch recent messages and build a clean context prompt
                    prompt = _build_trigger_prompt(
                        channel, agent_name, server_port,
                        get_token_fn=get_token_fn, job_id=job_id,
                    )

                    inject_fn(prompt.replace("\n", " "))
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug("Queue watcher error: %s", e)
        time.sleep(1)


# ── Config loading ──────────────────────────────────────────────────

def load_config() -> dict:
    config_path = ROOT / "config.toml"
    with open(config_path, "rb") as f:
        return tomllib.load(f)


# ── Main ────────────────────────────────────────────────────────────

def main():
    import argparse
    import urllib.error
    import urllib.request

    config = load_config()

    parser = argparse.ArgumentParser(description="GhostLink agent wrapper")
    parser.add_argument("agent", help="Agent base name (e.g. claude, codex, gemini)")
    parser.add_argument("--no-restart", action="store_true")
    parser.add_argument("--label", type=str, default=None)
    parser.add_argument("--headless", action="store_true",
                        help="Don't attach to tmux (for non-TTY environments)")
    args, extra = parser.parse_known_args()
    # Strip the '--' separator that argparse leaves in extra
    extra = [a for a in extra if a != "--"]

    agent = args.agent
    agent_cfg = config.get("agents", {}).get(agent, {})
    # Fall back to known command mapping, then agent name
    _KNOWN_COMMANDS = {
        "claude": "claude", "codex": "codex", "gemini": "gemini", "grok": "grok",
        "copilot": "gh", "aider": "aider", "goose": "goose", "pi": "pi",
        "cursor": "cursor", "cody": "cody", "continue": "continue",
        "opencode": "opencode", "ollama": "ollama",
    }
    command = agent_cfg.get("command") or _KNOWN_COMMANDS.get(agent, agent)
    agent_args = agent_cfg.get("args", [])
    cwd = os.environ.get("GHOSTLINK_AGENT_CWD") or agent_cfg.get("cwd", ".")
    color = agent_cfg.get("color", "")
    label = args.label or agent_cfg.get("label", "")
    data_dir = ROOT / config.get("server", {}).get("data_dir", "./data")
    data_dir.mkdir(parents=True, exist_ok=True)
    server_port = config.get("server", {}).get("port", 8300)
    mcp_cfg = config.get("mcp", {})

    # Auto-detect headless
    headless = args.headless or not os.isatty(0)

    # Read role description from env (set by routes/agents.py spawn)
    agent_role_desc = os.environ.get("GHOSTLINK_AGENT_ROLE", "")

    # Register with server — include role so other agents can see it via chat_who
    try:
        registration = _register(server_port, agent, label, role=agent_role_desc)
    except Exception as exc:
        print(f"  Registration failed: {exc}")
        print(f"  Is the GhostLink server running on port {server_port}?")
        sys.exit(1)

    assigned_name = registration["name"]
    assigned_token = registration.get("token", "")
    print(f"  Registered as: {assigned_name} (slot {registration.get('slot', '?')})")

    # Identity tracking
    _identity_lock = threading.Lock()
    _identity = {
        "name": assigned_name,
        "queue": data_dir / f"{assigned_name}_queue.jsonl",
        "token": assigned_token,
    }

    def get_identity():
        with _identity_lock:
            return _identity["name"], _identity["queue"]

    def get_token():
        with _identity_lock:
            return _identity["token"]

    proxy = None
    proxy_url = None

    # Resolve MCP injection mode
    inject_cfg = _resolve_mcp_inject(agent, agent_cfg)
    inject_mode = inject_cfg.get("mcp_inject", "")
    needs_proxy = inject_mode in ("proxy_flag", "") or not inject_mode

    if needs_proxy:
        from mcp_proxy import McpIdentityProxy
        transport = inject_cfg.get("mcp_transport", "http")
        if transport == "sse":
            upstream_base = f"http://127.0.0.1:{mcp_cfg.get('sse_port', 8201)}"
            proxy_path = "/sse"
        else:
            upstream_base = f"http://127.0.0.1:{mcp_cfg.get('http_port', 8200)}"
            proxy_path = "/mcp"

        proxy = McpIdentityProxy(
            upstream_base=upstream_base,
            upstream_path=proxy_path,
            agent_name=assigned_name,
            instance_token=assigned_token,
        )
        if not proxy.start():
            print("  Failed to start MCP proxy. Continuing without it.")
            proxy = None
            proxy_url = f"{upstream_base}{proxy_path}"
        else:
            proxy_url = f"{proxy.url}{proxy_path}"

    def set_runtime_identity(new_name=None, new_token=None):
        with _identity_lock:
            old_name = _identity["name"]
            old_token = _identity["token"]
            changed = False
            if new_name and new_name != old_name:
                _identity["name"] = new_name
                _identity["queue"] = data_dir / f"{new_name}_queue.jsonl"
                changed = True
            if new_token and new_token != old_token:
                _identity["token"] = new_token
                changed = True
            current_name = _identity["name"]
            current_token = _identity["token"]

        if changed and proxy is not None:
            proxy.agent_name = current_name
            proxy.token = current_token
        if changed:
            if new_name and new_name != old_name:
                print(f"  Identity updated: {old_name} -> {new_name}")
            if new_token and new_token != old_token:
                print(f"  Session refreshed for @{current_name}")
        return changed

    # Clear stale queue
    queue_file = _identity["queue"]
    if queue_file.exists():
        queue_file.write_text("", "utf-8")

    # Resolve command against the same expanded PATH the server uses.
    cli_path = _expanded_cli_path()
    os.environ["PATH"] = cli_path
    resolved = shutil.which(command, path=cli_path)
    if not resolved:
        print(f"  Error: '{command}' not found on PATH.")
        sys.exit(1)
    command = resolved

    project_dir = (ROOT / cwd).resolve()

    # Build MCP config via inject system
    strip_vars = {"CLAUDECODE"} | set(agent_cfg.get("strip_env", []))
    env = {k: v for k, v in os.environ.items() if k not in strip_vars}
    env["PATH"] = cli_path

    mcp_args, inject_env, mcp_settings_path = _apply_mcp_inject(
        inject_cfg, assigned_name, data_dir, proxy_url,
        token=assigned_token, mcp_cfg=mcp_cfg, project_dir=project_dir,
    )

    # Permission/model flags first, then MCP config (CLI parsers expect flags before config)
    # Deduplicate: if extra args overlap with agent_args from config, use config's
    combined_args = list(agent_args)
    for a in extra:
        if a not in combined_args:
            combined_args.append(a)
    launch_args = combined_args + mcp_args

    # ── v2.5.0: Agent identity injection ──────────────────────────────
    # Write context files so agents know who they are and what GhostLink is
    from agent_memory import set_soul, generate_agent_context
    try:
        # Use label and role from spawn (env vars set by routes/agents.py)
        agent_label = os.environ.get("GHOSTLINK_AGENT_LABEL", "") or label or assigned_name

        # Always build identity from current label + role (not stale saved soul)
        # This ensures preset roles like "Code Reviewer" always take effect
        soul_parts = [f'You are **{agent_label}** (agent name: @{assigned_name}).']
        if agent_role_desc:
            soul_parts.append(f'Your role: {agent_role_desc}.')
        soul_parts.append('You collaborate with other agents and humans via @mentions in GhostLink.')
        soul_parts.append('Be helpful, thorough, and proactive. Stay in character for your role.')
        soul = ' '.join(soul_parts)
        # Persist so it survives restarts
        set_soul(data_dir, assigned_name, soul)
        print(f"  Soul set: {agent_label} — {agent_role_desc or 'general assistant'}")

        context_content = generate_agent_context(assigned_name, soul)

        # Write .ghostlink-context.md to the agent's workspace
        context_file = project_dir / ".ghostlink-context.md"
        context_file.write_text(context_content, "utf-8")
        print(f"  Context: {context_file}")

        # Provider-specific identity injection
        if agent in ("claude",):
            # Claude Code reads .claude/instructions.md automatically
            claude_dir = project_dir / ".claude"
            claude_dir.mkdir(parents=True, exist_ok=True)
            instructions_file = claude_dir / "instructions.md"
            # Only write if it doesn't exist or is our managed file
            if not instructions_file.exists() or instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
                instructions_file.write_text(context_content, "utf-8")
                print(f"  Claude instructions: {instructions_file}")

        elif agent in ("codex",):
            # Codex reads .codex/instructions.md
            codex_dir = project_dir / ".codex"
            codex_dir.mkdir(parents=True, exist_ok=True)
            instructions_file = codex_dir / "instructions.md"
            if not instructions_file.exists() or instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
                instructions_file.write_text(context_content, "utf-8")
                print(f"  Codex instructions: {instructions_file}")

        elif agent in ("gemini",):
            # Gemini: add systemInstruction to the settings JSON if we wrote one
            if mcp_settings_path and mcp_settings_path.exists():
                try:
                    settings = json.loads(mcp_settings_path.read_text("utf-8"))
                    settings["systemInstruction"] = context_content[:4000]
                    mcp_settings_path.write_text(json.dumps(settings, indent=2) + "\n", "utf-8")
                    print(f"  Gemini system instruction injected")
                except Exception as e:
                    print(f"  Warning: failed to inject Gemini system instruction: {e}")

        elif agent in ("aider",):
            # Aider reads .aider.conf.yml or AIDER_* env vars
            # Write conventions file that aider reads automatically
            conventions_file = project_dir / ".aider.conventions.md"
            if not conventions_file.exists() or conventions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
                conventions_file.write_text(context_content, "utf-8")
                print(f"  Aider conventions: {conventions_file}")

        elif agent in ("grok",):
            # Grok: write instructions to .grok/instructions.md
            grok_dir = project_dir / ".grok"
            grok_dir.mkdir(parents=True, exist_ok=True)
            instructions_file = grok_dir / "instructions.md"
            if not instructions_file.exists() or instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
                instructions_file.write_text(context_content, "utf-8")
                print(f"  Grok instructions: {instructions_file}")

        else:
            # Generic fallback: write INSTRUCTIONS.md that many agents auto-discover
            instructions_file = project_dir / "INSTRUCTIONS.md"
            if not instructions_file.exists() or instructions_file.read_text("utf-8").startswith("# GhostLink Agent Context"):
                instructions_file.write_text(context_content, "utf-8")
                print(f"  Generic instructions: {instructions_file}")

    except Exception as e:
        print(f"  Warning: identity injection failed: {e}")
    # ── End identity injection ────────────────────────────────────────

    print(f"  === {assigned_name.capitalize()} Chat Wrapper ===")
    if not needs_proxy:
        print(f"  MCP: direct connect ({inject_mode}) with bearer auth")
        if mcp_settings_path:
            print(f"  Config: {mcp_settings_path}")
    elif proxy_url:
        print(f"  Local MCP proxy: {proxy_url}")
    print(f"  @{assigned_name} mentions auto-inject MCP reads")
    print(f"  Starting {command} in {cwd}...\n")

    # Heartbeat
    def _heartbeat():
        while True:
            current_name, _ = get_identity()
            current_token = get_token()
            url = f"http://127.0.0.1:{server_port}/api/heartbeat/{current_name}"
            try:
                req = urllib.request.Request(
                    url, method="POST", data=b"",
                    headers=_auth_headers(current_token),
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp_data = json.loads(resp.read())
                server_name = resp_data.get("name", current_name)
                new_token = resp_data.get("token")
                if server_name != current_name or new_token:
                    set_runtime_identity(
                        server_name if server_name != current_name else None,
                        new_token,
                    )
            except urllib.error.HTTPError as exc:
                if exc.code == 409:
                    try:
                        replacement = _register(server_port, agent, label, role=agent_role_desc)
                        set_runtime_identity(replacement["name"], replacement["token"])
                    except Exception as e:
                        import logging
                        logging.getLogger(__name__).debug("Re-registration failed: %s", e)
                time.sleep(5)
                continue
            except Exception as e:
                import logging
                logging.getLogger(__name__).debug("Heartbeat failed: %s", e)
                time.sleep(5)
                continue
            time.sleep(5)

    threading.Thread(target=_heartbeat, daemon=True).start()

    # Queue watcher setup
    _trigger_flag = [False]
    _watcher_inject_fn = None

    def start_watcher(inject_fn):
        nonlocal _watcher_inject_fn
        _watcher_inject_fn = inject_fn
        threading.Thread(
            target=_queue_watcher,
            args=(get_identity, inject_fn),
            kwargs={
                "server_port": server_port,
                "trigger_flag": _trigger_flag,
                "agent_name": assigned_name,
                "get_token_fn": get_token,
            },
            daemon=True,
        ).start()

    # Activity monitor
    _activity_checker = None

    def _activity_monitor():
        last_active = None
        last_report_time = 0
        last_thinking_text = ""
        REPORT_INTERVAL = 3
        IDLE_REPORT_INTERVAL = 8
        THINKING_INTERVAL = 2  # Stream thinking every 2s
        while True:
            time.sleep(1)
            if not _activity_checker:
                continue
            try:
                active = _activity_checker()
                now = time.time()
                should_send = (
                    active != last_active
                    or (active and now - last_report_time >= REPORT_INTERVAL)
                    or (not active and now - last_report_time >= IDLE_REPORT_INTERVAL)
                )
                if should_send:
                    current_name, _ = get_identity()
                    current_token = get_token()
                    url = f"http://127.0.0.1:{server_port}/api/heartbeat/{current_name}"
                    body = json.dumps({"active": active}).encode()
                    req = urllib.request.Request(
                        url, method="POST", data=body,
                        headers=_auth_headers(current_token, include_json=True),
                    )
                    urllib.request.urlopen(req, timeout=5)
                    last_active = active

                # Stream thinking output when agent is active
                if active and now - last_report_time >= THINKING_INTERVAL:
                    try:
                        result = subprocess.run(
                            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-20"],
                            capture_output=True, timeout=3,
                        )
                        if result.returncode == 0:
                            raw_text = result.stdout.decode("utf-8", errors="replace").strip()
                            pane_text = _sanitize_thinking(raw_text)
                            if pane_text and pane_text != last_thinking_text:
                                last_thinking_text = pane_text
                                current_name, _ = get_identity()
                                think_body = json.dumps({"text": pane_text, "active": True}).encode()
                                think_req = urllib.request.Request(
                                    f"http://127.0.0.1:{server_port}/api/agents/{current_name}/thinking",
                                    method="POST", data=think_body,
                                    headers={"Content-Type": "application/json"},
                                )
                                urllib.request.urlopen(think_req, timeout=3)
                    except Exception:
                        pass
                    last_report_time = now
                elif not active and last_thinking_text:
                    # Clear thinking when idle
                    try:
                        current_name, _ = get_identity()
                        clear_body = json.dumps({"text": "", "active": False}).encode()
                        clear_req = urllib.request.Request(
                            f"http://127.0.0.1:{server_port}/api/agents/{current_name}/thinking",
                            method="POST", data=clear_body,
                            headers={"Content-Type": "application/json"},
                        )
                        urllib.request.urlopen(clear_req, timeout=3)
                        last_thinking_text = ""
                    except Exception:
                        pass
                    last_report_time = now
            except Exception as e:
                import logging
                logging.getLogger(__name__).debug("Activity monitor error: %s", e)

    threading.Thread(target=_activity_monitor, daemon=True).start()

    # Approval prompt watcher — detects CLI permission prompts in tmux.
    # Skip when --dangerously-skip-permissions is active (all prompts auto-approved).
    session_name = f"ghostlink-{assigned_name}"
    _auto_approve = any(
        "dangerously-skip-permissions" in a
        for a in (extra + agent_args)
    )
    if not _auto_approve:
        threading.Thread(
            target=_approval_watcher,
            args=(session_name, get_identity, agent),
            kwargs={
                "server_port": server_port,
                "data_dir": data_dir,
            },
            daemon=True,
        ).start()

    # Run agent
    from wrapper_unix import get_activity_checker, run_agent

    _activity_checker = get_activity_checker(session_name, trigger_flag=_trigger_flag)

    try:
        run_agent(
            command=command,
            extra_args=launch_args,
            cwd=cwd,
            env=env,
            queue_file=queue_file,
            agent=agent,
            no_restart=args.no_restart,
            start_watcher=start_watcher,
            strip_env=list(strip_vars),
            session_name=session_name,
            inject_env=inject_env,
            inject_delay=agent_cfg.get("inject_delay", 0.3),
            headless=headless,
        )
    finally:
        current_name, _ = get_identity()
        current_token = get_token()
        _deregister(server_port, current_name, current_token)
        print(f"  Deregistered {current_name}")
        if proxy:
            proxy.stop()
    print("  Wrapper stopped.")


if __name__ == "__main__":
    main()
