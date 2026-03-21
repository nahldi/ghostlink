"""Agent wrapper — launches CLI agents with MCP config and auto-triggers on @mentions.

Usage:
    python wrapper.py claude
    python wrapper.py codex
    python wrapper.py gemini

How it works:
  1. Registers with the AI Chattr server (POST /api/register)
  2. Starts MCP identity proxy (if needed)
  3. Writes MCP config pointing agent CLI to the MCP bridge
  4. Starts agent in a tmux session
  5. Background thread polls queue file for @mentions
  6. On trigger, injects "mcp read #channel" via tmux send-keys
  7. Heartbeats keep the server aware of agent status
"""

import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).parent
SERVER_NAME = "aichttr"


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
    Used by Gemini CLI."""
    config_file.parent.mkdir(parents=True, exist_ok=True)
    existing: dict = {}
    if config_file.exists():
        try:
            existing = json.loads(config_file.read_text("utf-8"))
        except Exception:
            pass
    servers = existing.get("mcpServers", {})
    if transport in ("http", "streamable-http"):
        entry: dict = {"type": "http", "httpUrl": url, "trust": True}
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
        except Exception:
            pass
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
    config_dir = data_dir / "provider-config"
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
        launch_args = [flag, str(settings_path)]

    elif mode == "proxy_flag":
        template = inject_cfg.get("mcp_proxy_flag_template",
                                  '-c mcp_servers.{server}.url="{url}"')
        expanded = template.format(server=SERVER_NAME, url=proxy_url or "")
        launch_args = expanded.split()

    return launch_args, inject_env, settings_path


# ── Registration ────────────────────────────────────────────────────

def _register(server_port: int, base: str, label: str = "") -> dict:
    import urllib.request
    body = json.dumps({"base": base, "label": label}).encode()
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
    except Exception:
        pass


def _auth_headers(token: str, *, include_json: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if include_json:
        headers["Content-Type"] = "application/json"
    return headers


# ── Queue watcher ───────────────────────────────────────────────────

def _queue_watcher(get_identity_fn, inject_fn, *, server_port: int = 8300,
                   trigger_flag=None, agent_name: str = "", get_token_fn=None):
    """Poll queue file for @mention triggers, inject MCP read prompts."""
    while True:
        try:
            name, queue_file = get_identity_fn()
            if queue_file.exists() and queue_file.stat().st_size > 0:
                with open(queue_file, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                queue_file.write_text("", "utf-8")

                channel = "general"
                has_trigger = False
                job_id = None
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        if isinstance(data, dict):
                            if "channel" in data:
                                channel = data["channel"]
                            if "job_id" in data:
                                job_id = data["job_id"]
                        has_trigger = True
                    except json.JSONDecodeError:
                        continue

                if has_trigger:
                    if trigger_flag is not None:
                        trigger_flag[0] = True
                    time.sleep(0.5)

                    if job_id:
                        prompt = f"mcp read job_id={job_id} - you were mentioned in a job thread, take appropriate action"
                    else:
                        prompt = f"mcp read #{channel} - you were mentioned, take appropriate action"

                    inject_fn(prompt.replace("\n", " "))
        except Exception:
            pass
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
    agent_names = list(config.get("agents", {}).keys())

    parser = argparse.ArgumentParser(description="AI Chattr agent wrapper")
    parser.add_argument("agent", choices=agent_names, help="Agent to wrap")
    parser.add_argument("--no-restart", action="store_true")
    parser.add_argument("--label", type=str, default=None)
    parser.add_argument("--headless", action="store_true",
                        help="Don't attach to tmux (for non-TTY environments)")
    args, extra = parser.parse_known_args()

    agent = args.agent
    agent_cfg = config.get("agents", {}).get(agent, {})
    command = agent_cfg.get("command", agent)
    agent_args = agent_cfg.get("args", [])
    cwd = agent_cfg.get("cwd", ".")
    color = agent_cfg.get("color", "")
    label = args.label or agent_cfg.get("label", "")
    data_dir = ROOT / config.get("server", {}).get("data_dir", "./data")
    data_dir.mkdir(parents=True, exist_ok=True)
    server_port = config.get("server", {}).get("port", 8300)
    mcp_cfg = config.get("mcp", {})

    # Auto-detect headless
    headless = args.headless or not os.isatty(0)

    # Register with server
    try:
        registration = _register(server_port, agent, label)
    except Exception as exc:
        print(f"  Registration failed: {exc}")
        print(f"  Is the AI Chattr server running on port {server_port}?")
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

    # Resolve command
    resolved = shutil.which(command)
    if not resolved:
        print(f"  Error: '{command}' not found on PATH.")
        sys.exit(1)
    command = resolved

    project_dir = (ROOT / cwd).resolve()

    # Build MCP config via inject system
    strip_vars = {"CLAUDECODE"} | set(agent_cfg.get("strip_env", []))
    env = {k: v for k, v in os.environ.items() if k not in strip_vars}

    mcp_args, inject_env, mcp_settings_path = _apply_mcp_inject(
        inject_cfg, assigned_name, data_dir, proxy_url,
        token=assigned_token, mcp_cfg=mcp_cfg, project_dir=project_dir,
    )

    launch_args = list(agent_args) + mcp_args + extra

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
                if server_name != current_name:
                    set_runtime_identity(server_name)
            except urllib.error.HTTPError as exc:
                if exc.code == 409:
                    try:
                        replacement = _register(server_port, agent, label)
                        set_runtime_identity(replacement["name"], replacement["token"])
                    except Exception:
                        pass
                time.sleep(5)
                continue
            except Exception:
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
        REPORT_INTERVAL = 3
        IDLE_REPORT_INTERVAL = 8
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
                    last_report_time = now
            except Exception:
                pass

    threading.Thread(target=_activity_monitor, daemon=True).start()

    # Run agent
    from wrapper_unix import get_activity_checker, run_agent

    session_name = f"aichttr-{assigned_name}"
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
