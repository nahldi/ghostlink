"""Agent registry, spawn, control, and memory routes."""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import deps
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter()
log = logging.getLogger(__name__)

_VALID_AGENT_NAME = deps._VALID_AGENT_NAME
_SAFE_AGENT_ARG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/=+\-@]*$")
_KNOWN_AGENT_ARG_PRESETS: dict[str, set[tuple[str, ...]]] = {
    "claude": {
        (),
        ("--dangerously-skip-permissions",),
        ("--permission-mode", "acceptEdits"),
        ("--permission-mode", "plan"),
    },
    "codex": {
        (),
        ("--sandbox", "danger-full-access", "-a", "never"),
        ("--full-auto",),
    },
    "gemini": {
        (),
        ("-y",),
        ("--approval-mode", "auto_edit"),
        ("--approval-mode", "plan"),
    },
    "grok": {()},
    "aider": {
        (),
        ("--yes",),
    },
    "goose": {()},
    "opencode": {()},
    "copilot": {()},
    "ollama": {
        (),
        ("run", "qwen2.5-coder"),
    },
}
_KNOWN_MODEL_FLAGS: dict[str, str] = {
    "claude": "--model",
    "codex": "-m",
    "gemini": "-m",
    "grok": "--model",
    "aider": "--model",
}


def _warn_missing_worktree_manager(action: str, agent_name: str) -> None:
    log.warning("Worktree cleanup skipped during %s for %s: manager unavailable", action, agent_name)


async def _record_activity(event_type: str, text: str, *, agent: str = "", channel: str = "") -> None:
    event = {
        "id": f"{int(time.time() * 1000)}-{agent or 'system'}-{event_type}",
        "type": event_type,
        "text": text,
        "agent": agent or None,
        "channel": channel or None,
        "timestamp": time.time(),
    }
    deps._activity_log.append(event)
    await deps.broadcast("activity", event)


async def add_replay_event(
    agent_name: str,
    event_type: str,
    *,
    title: str,
    detail: str = "",
    surface: str = "",
    path: str = "",
    url: str = "",
    query: str = "",
    command: str = "",
    tool: str = "",
    metadata: dict | None = None,
) -> dict:
    event = {
        "id": f"{int(time.time() * 1000)}-{agent_name}-{event_type}",
        "agent": agent_name,
        "type": event_type,
        "title": title,
        "detail": detail,
        "surface": surface,
        "path": path,
        "url": url,
        "query": query,
        "command": command,
        "tool": tool,
        "metadata": metadata or {},
        "timestamp": time.time(),
    }
    with deps._agent_state_lock:
        deps._agent_replay_log.append(event)
    await deps.broadcast("agent_replay", event)
    return event


def _get_agent_label(name: str) -> str:
    inst = deps.registry.get(name) if deps.registry else None
    return (inst.label if inst and inst.label else name) if name else "system"


async def set_agent_presence(
    agent_name: str,
    *,
    surface: str,
    status: str,
    detail: str = "",
    path: str = "",
    url: str = "",
    query: str = "",
    command: str = "",
    tool: str = "",
    artifact_url: str = "",
    state: str = "",
) -> dict:
    payload = {
        "agent": agent_name,
        "label": _get_agent_label(agent_name),
        "surface": surface,
        "status": status,
        "detail": detail,
        "path": path,
        "url": url,
        "query": query,
        "command": command,
        "tool": tool,
        "artifact_url": artifact_url,
        "state": state or (deps.registry.get(agent_name).state if deps.registry and deps.registry.get(agent_name) else ""),
        "updated_at": time.time(),
    }
    with deps._agent_state_lock:
        current = dict(deps._agent_presence.get(agent_name, {}))
        current.update(payload)
        current["agent"] = agent_name
        current["label"] = _get_agent_label(agent_name)
        current["updated_at"] = payload["updated_at"]
        deps._agent_presence[agent_name] = current
        payload = dict(current)
    await deps.broadcast("agent_presence", payload)
    return payload


async def set_agent_browser_state(
    agent_name: str,
    *,
    mode: str,
    status: str,
    url: str = "",
    query: str = "",
    title: str = "",
    preview: str = "",
    artifact_path: str = "",
) -> dict:
    state = {
        "agent": agent_name,
        "mode": mode,
        "status": status,
        "url": url,
        "query": query,
        "title": title,
        "preview": preview[:4000],
        "artifact_path": artifact_path,
        "artifact_url": f"/api/agents/{agent_name}/browser/artifact" if artifact_path else "",
        "updated_at": time.time(),
    }
    with deps._agent_state_lock:
        deps._agent_browser_state[agent_name] = state
    await set_agent_presence(
        agent_name,
        surface="browser",
        status=status,
        detail=title or url or query,
        url=url,
        query=query,
        artifact_url=state["artifact_url"],
    )
    await deps.broadcast("browser_state", state)
    return state


async def set_terminal_stream(agent_name: str, output: str, active: bool) -> dict:
    payload = {
        "agent": agent_name,
        "output": output[-12000:],
        "active": active,
        "updated_at": time.time(),
    }
    with deps._agent_state_lock:
        deps._terminal_streams[agent_name] = payload
    await deps.broadcast("terminal_stream", payload)
    return payload


async def add_workspace_change(agent_name: str, action: str, path: str) -> dict:
    payload = {
        "agent": agent_name,
        "action": action,
        "path": path,
        "timestamp": time.time(),
    }
    with deps._agent_state_lock:
        deps._workspace_changes.append(payload)
    await deps.broadcast("workspace_change", payload)
    verb = {"created": "Created", "modified": "Updated", "deleted": "Deleted"}.get(action, "Changed")
    await _record_activity("message", f"{verb} {path}", agent=agent_name)
    await add_replay_event(
        agent_name,
        "workspace_change",
        title=f"{verb} file",
        detail=path,
        surface="files",
        path=path,
        metadata={"action": action},
    )
    await set_agent_presence(
        agent_name,
        surface="files",
        status=f"{verb} file",
        detail=path,
        path=path,
    )
    return payload


def _read_text_file_for_diff(file_path: Path, *, max_bytes: int = 200_000) -> str:
    try:
        if not file_path.is_file():
            return ""
        if file_path.stat().st_size > max_bytes:
            return ""
        return file_path.read_text("utf-8", errors="replace")
    except Exception:
        return ""


async def cache_file_diff(agent_name: str, path: str, before: str, after: str, action: str) -> dict:
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    diff_text = "\n".join(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
        )
    )
    payload = {
        "agent": agent_name,
        "path": path,
        "action": action,
        "before": before,
        "after": after,
        "diff": diff_text,
        "timestamp": time.time(),
    }
    with deps._agent_state_lock:
        agent_cache = deps._file_diff_cache.setdefault(agent_name, {})
        agent_cache[path] = payload
    await deps.broadcast("file_diff", {
        "agent": agent_name,
        "path": path,
        "action": action,
        "diff": diff_text,
        "timestamp": payload["timestamp"],
    })
    await add_replay_event(
        agent_name,
        "file_diff",
        title="Updated file diff",
        detail=path,
        surface="files",
        path=path,
        metadata={"action": action, "has_diff": bool(diff_text)},
    )
    return payload


def _validate_spawn_args(base: str, extra_args: object, cfg_args: object) -> list[str]:
    if extra_args is None:
        raw_args: list[object] = []
    elif isinstance(extra_args, list):
        raw_args = list(extra_args)
    else:
        raise ValueError("args must be an array of strings")

    if len(raw_args) > 8:
        raise ValueError("too many args")

    normalized: list[str] = []
    for raw in raw_args:
        if not isinstance(raw, str):
            raise ValueError("args must be strings")
        arg = raw.strip()
        if not arg or len(arg) > 128 or not _SAFE_AGENT_ARG_RE.match(arg):
            raise ValueError(f"invalid arg: {raw!r}")
        normalized.append(arg)

    allowed = set(_KNOWN_AGENT_ARG_PRESETS.get(base, {()}))
    if isinstance(cfg_args, list):
        cfg_tuple = tuple(str(arg).strip() for arg in cfg_args if isinstance(arg, str) and str(arg).strip())
        allowed.add(cfg_tuple)

    if tuple(normalized) in allowed:
        return normalized

    model_flag = _KNOWN_MODEL_FLAGS.get(base)
    if model_flag and len(normalized) >= 2 and len(normalized) <= 6:
        for preset in allowed:
            prefix = list(preset)
            if normalized[:len(prefix)] != prefix:
                continue
            remainder = normalized[len(prefix):]
            if len(remainder) == 2 and remainder[0] == model_flag and _SAFE_AGENT_ARG_RE.match(remainder[1]):
                return normalized

    raise ValueError(f"unsupported args for {base}")


async def _wait_for_spawn_health(proc: subprocess.Popen, base: str, stderr_buf: list[str]) -> None:
    delay = 0.25
    max_delay = 2.0
    deadline = time.time() + 6.0

    while time.time() < deadline:
        if proc.poll() is not None:
            await asyncio.sleep(0.2)
            stderr_output = "\n".join(stderr_buf[-30:]).strip()
            error_msg = stderr_output or f"Agent '{base}' exited immediately. Is the '{base}' CLI installed and authenticated?"
            raise RuntimeError(error_msg)

        async with deps._agent_lock:
            if proc.pid not in deps._pending_spawns:
                return

        await asyncio.sleep(delay)
        delay = min(max_delay, delay * 2)

    if proc.poll() is not None:
        stderr_output = "\n".join(stderr_buf[-30:]).strip()
        error_msg = stderr_output or f"Agent '{base}' exited before registration completed."
        raise RuntimeError(error_msg)


def _drain_pipe(pipe, agent_base: str, buf: list | None = None) -> None:
    """Drain a subprocess pipe line-by-line, logging output at DEBUG."""
    try:
        for raw in iter(pipe.readline, b""):
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                log.debug("[wrapper/%s] %s", agent_base, line)
                if buf is not None:
                    buf.append(line)
    except Exception:
        pass


@router.post("/api/register")
async def register_agent(request: Request):
    body = await request.json()
    base = body.get("base", body.get("name", ""))
    label = body.get("label", "")
    color = body.get("color", "")
    role = body.get("role", "")
    wrapper_pid = body.get("pid")
    if not base:
        return JSONResponse({"error": "base required"}, 400)
    inst = deps.registry.register(base, label, color)
    if role:
        inst.role = role
    if hasattr(deps, "worktree_manager") and deps.worktree_manager:
        deps.worktree_manager.create_worktree(inst.name)
    else:
        _warn_missing_worktree_manager("register", inst.name)
    if wrapper_pid is not None:
        try:
            pid_int = int(wrapper_pid)
        except (TypeError, ValueError):
            pid_int = None
        if pid_int is not None:
            async with deps._agent_lock:
                proc = deps._pending_spawns.pop(pid_int, None)
                if proc is not None:
                    deps._agent_processes[inst.name] = proc
    from app_helpers import get_full_agent_list
    await deps.broadcast("status", {"agents": get_full_agent_list()})
    await _record_activity("agent_join", f"{inst.label or inst.name} connected", agent=inst.name)
    await add_replay_event(inst.name, "agent_join", title="Agent connected", detail="Session started", surface="session")
    await set_agent_presence(inst.name, surface="session", status="Connected", detail="Agent online", state=inst.state)
    return inst.to_dict()


@router.post("/api/deregister/{name}")
async def deregister_agent(name: str):
    import mcp_bridge
    if hasattr(deps, "worktree_manager") and deps.worktree_manager:
        deps.worktree_manager.merge_changes(name)
        deps.worktree_manager.remove_worktree(name)
    else:
        _warn_missing_worktree_manager("deregister", name)
    ok = deps.registry.deregister(name)
    if ok:
        mcp_bridge.cleanup_agent(name)
        deps._thinking_buffers.pop(name, None)
        from app_helpers import get_full_agent_list
        await deps.broadcast("status", {"agents": get_full_agent_list()})
        await _record_activity("agent_leave", f"{name} disconnected", agent=name)
        await add_replay_event(name, "agent_leave", title="Agent disconnected", detail="Session ended", surface="session")
        await set_agent_presence(name, surface="session", status="Disconnected", detail="Agent offline", state="offline")
    return {"ok": ok}


@router.get("/api/agent-templates")
async def agent_templates(connected: str = ""):
    """Return available agent CLI templates with defaults."""
    import shutil as _shutil
    _connected_set = set(c.strip() for c in connected.split(",") if c.strip())
    stored = deps._settings.get("connectedAgents", [])
    if isinstance(stored, list):
        _connected_set.update(stored)

    _API_KEY_ENV = {
        "claude": ["ANTHROPIC_API_KEY"],
        "codex": ["OPENAI_API_KEY"],
        "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "grok": ["XAI_API_KEY"],
    }

    _available_cache: dict[str, bool] = {}

    def _is_available(name: str, cmd: str) -> bool:
        # For agents with subcommand requirements, always do the deep check
        _NEEDS_DEEP_CHECK = {"copilot"}
        if name not in _NEEDS_DEEP_CHECK:
            if name in _connected_set:
                return True
            _PROVIDER_TO_BASE = {"anthropic": "claude", "openai": "codex", "google": "gemini", "github": "copilot"}
            if _PROVIDER_TO_BASE.get(name, name) in _connected_set or name in [_PROVIDER_TO_BASE.get(c, c) for c in _connected_set]:
                return True
        if name in _available_cache:
            return _available_cache[name]
        result = _check_available(name, cmd)
        _available_cache[name] = result
        return result

    def _check_available(name: str, cmd: str) -> bool:
        cached = deps._AGENT_DETECTION_CACHE.get(name)
        if cached is not None and time.time() - cached[1] < deps._AGENT_DETECTION_CACHE_TTL:
            return cached[0]
        result = _do_check_available(name, cmd)
        deps._AGENT_DETECTION_CACHE[name] = (result, time.time())
        return result

    def _do_check_available(name: str, cmd: str) -> bool:
        if _shutil.which(cmd):
            # Extra validation for agents that need subcommands/extensions
            if name == "copilot" and cmd == "gh":
                try:
                    r = subprocess.run(["gh", "copilot", "--help"], capture_output=True, timeout=5)
                    if r.returncode != 0:
                        return False
                except Exception:
                    return False
            return True
        for key in _API_KEY_ENV.get(name, []):
            if os.environ.get(key):
                return True
        wsl_checks = [
            f'which {cmd} 2>/dev/null',
            f'command -v {cmd} 2>/dev/null',
            f'test -f "$HOME/.nvm/versions/node/*/bin/{cmd}" 2>/dev/null && echo found',
            f'test -f "/usr/local/bin/{cmd}" 2>/dev/null && echo found',
            f'ls $(npm root -g 2>/dev/null)/.bin/{cmd} 2>/dev/null',
        ]
        for check in wsl_checks:
            try:
                r = subprocess.run(
                    ['wsl', 'bash', '-ic', check],
                    capture_output=True, timeout=8,
                )
                if r.returncode == 0 and r.stdout.strip():
                    return True
            except Exception:
                pass
        return False

    agents_cfg = deps.CONFIG.get("agents", {})
    templates = []
    for name, cfg in agents_cfg.items():
        cmd = cfg.get("command", name)
        templates.append({
            "base": name,
            "command": cmd,
            "label": cfg.get("label", name.capitalize()),
            "color": cfg.get("color", "#a78bfa"),
            "defaultCwd": cfg.get("cwd", "."),
            "defaultArgs": cfg.get("args", []),
            "available": _is_available(name, cmd),
        })
    KNOWN_AGENTS = [
        ("claude", "claude", "Claude", "#e8734a", "Anthropic", ["--dangerously-skip-permissions"]),
        ("codex", "codex", "Codex", "#10a37f", "OpenAI", ["--sandbox", "danger-full-access", "-a", "never"]),
        ("gemini", "gemini", "Gemini", "#4285f4", "Google", ["--sandbox", "none", "-y"]),
        ("grok", "grok", "Grok", "#ff6b35", "xAI", []),
        ("copilot", "gh", "Copilot", "#6cc644", "GitHub", ["copilot", "chat"]),
        ("aider", "aider", "Aider", "#14b8a6", "Aider", ["--yes"]),
        ("goose", "goose", "Goose", "#f59e0b", "Block", []),
        ("pi", "pi", "Pi", "#8b5cf6", "Inflection", []),
        ("cursor", "cursor", "Cursor", "#7c3aed", "Cursor", []),
        ("cody", "cody", "Cody", "#ff5543", "Sourcegraph", []),
        ("continue", "continue", "Continue", "#0ea5e9", "Continue", []),
        ("opencode", "opencode", "OpenCode", "#22c55e", "OpenCode", []),
        ("ollama", "ollama", "Ollama", "#ffffff", "Ollama (Local)", []),
    ]
    for name, cmd, label, color, provider, default_args in KNOWN_AGENTS:
        if not any(t["base"] == name for t in templates):
            templates.append({
                "base": name, "command": cmd, "label": label,
                "color": color, "defaultCwd": ".", "defaultArgs": default_args,
                "available": _is_available(name, cmd), "provider": provider,
            })
        else:
            for t in templates:
                if t["base"] == name:
                    t["provider"] = provider
    return {"templates": templates}


@router.post("/api/spawn-agent")
async def spawn_agent(request: Request):
    """Spawn a new agent wrapper process."""
    body = await request.json()
    base = body.get("base", "").strip()
    label = body.get("label", "").strip()
    cwd = body.get("cwd", "").strip()
    extra_args = body.get("args", [])
    role_description = body.get("roleDescription", "").strip()

    if not base:
        return JSONResponse({"error": "base is required"}, 400)

    # Validate workspace path — block directory traversal
    if cwd:
        resolved_cwd = Path(cwd).resolve()
        if not resolved_cwd.exists() or not resolved_cwd.is_dir():
            return JSONResponse({"error": f"workspace path does not exist: {cwd}"}, 400)
        cwd_str = str(resolved_cwd)
        blocked = ("/etc", "/bin", "/sbin", "/usr", "/boot", "/dev", "/proc", "/sys",
                   "C:\\Windows", "C:\\Program Files")
        if any(cwd_str.startswith(b) for b in blocked):
            return JSONResponse({"error": "workspace path not allowed"}, 400)
        cwd = cwd_str

    # Resolve the agent command — check config.toml first, then known agent defaults
    agents_cfg = deps.CONFIG.get("agents", {})
    cfg = agents_cfg.get(base, {})
    # Known agent command mappings (base → actual CLI command)
    _KNOWN_COMMANDS = {
        "claude": "claude", "codex": "codex", "gemini": "gemini", "grok": "grok",
        "copilot": "gh", "aider": "aider", "goose": "goose", "pi": "pi",
        "cursor": "cursor", "cody": "cody", "continue": "continue",
        "opencode": "opencode", "ollama": "ollama",
    }
    command = cfg.get("command") or _KNOWN_COMMANDS.get(base, base)
    try:
        extra_args = _validate_spawn_args(base, extra_args, cfg.get("args", []))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 400)
    if len(role_description) > 500:
        return JSONResponse({"error": "roleDescription too long"}, 400)

    import shutil as _shutil

    # Extra check for agents that need subcommands/extensions
    if base == "copilot" and _shutil.which("gh"):
        try:
            r = subprocess.run(["gh", "copilot", "--help"], capture_output=True, timeout=5)
            if r.returncode != 0:
                return JSONResponse({"error": "GitHub Copilot extension not installed. Run: gh extension install github/gh-copilot"}, 400)
        except Exception:
            return JSONResponse({"error": "GitHub Copilot extension not installed. Run: gh extension install github/gh-copilot"}, 400)

    if not _shutil.which(command):
        found_in_wsl = False
        wsl_checks = [
            f'which {command} 2>/dev/null',
            f'command -v {command} 2>/dev/null',
            f'npx --yes {command} --version 2>/dev/null && echo found',
            f'test -f "$HOME/.nvm/versions/node/*/bin/{command}" 2>/dev/null && echo found',
            f'ls $(npm root -g 2>/dev/null)/.bin/{command} 2>/dev/null',
            f'pip show {command} 2>/dev/null && echo found',
        ]
        for check in wsl_checks:
            try:
                r = subprocess.run(['wsl', 'bash', '-ic', check], capture_output=True, timeout=10)
                if r.returncode == 0 and r.stdout.strip():
                    found_in_wsl = True
                    break
            except Exception:
                pass
        if not found_in_wsl:
            # Provide specific install instructions per agent
            _INSTALL_HINTS = {
                "claude": "npm install -g @anthropic-ai/claude-code",
                "codex": "npm install -g @openai/codex",
                "gemini": "npm install -g @google/gemini-cli",
                "grok": "npm install -g grok (requires xAI subscription)",
                "copilot": "gh extension install github/gh-copilot",
                "aider": "pip install aider-chat",
                "goose": "brew install goose (or pip install goose-ai)",
                "pi": "npm install -g @inflection/pi",
                "cursor": "Download from cursor.com (IDE-based agent)",
                "cody": "Download from sourcegraph.com/cody",
                "continue": "Install from continue.dev (VS Code extension)",
                "opencode": "curl -fsSL https://opencode.ai/install | bash",
                "ollama": "curl -fsSL https://ollama.ai/install.sh | sh",
            }
            hint = _INSTALL_HINTS.get(base, "check the agent's documentation")
            return JSONResponse({"error": f"'{base}' is not installed. Install: {hint}"}, 400)

    # Update in-memory config for this session
    if cwd or extra_args:
        if base not in deps.CONFIG.get("agents", {}):
            deps.CONFIG.setdefault("agents", {})[base] = {
                "command": command,
                "label": label or base.capitalize(),
                "color": cfg.get("color", "#a78bfa"),
                "cwd": cwd or ".",
                "args": extra_args or [],
            }
        else:
            if cwd:
                deps.CONFIG["agents"][base]["cwd"] = cwd
            if extra_args:
                deps.CONFIG["agents"][base]["args"] = extra_args

    # Build the wrapper command
    wrapper_path = str(deps.BASE_DIR / "wrapper.py")
    venv_python = str(deps.BASE_DIR.parent / ".venv" / "bin" / "python")
    if not Path(venv_python).exists():
        venv_python = sys.executable

    spawn_args = [venv_python, wrapper_path, base, "--headless"]
    if label:
        spawn_args.extend(["--label", label])
    if extra_args:
        spawn_args.append("--")
        spawn_args.extend(extra_args)

    try:
        spawn_env = os.environ.copy()
        if cwd:
            spawn_env["GHOSTLINK_AGENT_CWD"] = cwd
        if role_description:
            spawn_env["GHOSTLINK_AGENT_ROLE"] = role_description
        if label:
            spawn_env["GHOSTLINK_AGENT_LABEL"] = label
        proc = subprocess.Popen(
            spawn_args,
            cwd=str(deps.BASE_DIR),
            env=spawn_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        import threading as _th
        _stderr_buf: list[str] = []
        _th.Thread(target=_drain_pipe, args=(proc.stdout, base), daemon=True).start()
        _th.Thread(target=_drain_pipe, args=(proc.stderr, base, _stderr_buf), daemon=True).start()

        async with deps._agent_lock:
            deps._pending_spawns[proc.pid] = proc

        try:
            await _wait_for_spawn_health(proc, base, _stderr_buf)
        except RuntimeError as spawn_err:
            error_msg = str(spawn_err)
            if not _stderr_buf and command and error_msg.endswith("installed and authenticated?"):
                error_msg = f"Agent '{base}' exited immediately. Is the '{command}' CLI installed and authenticated?"
            log.warning("Agent spawn failed for %s: %s", base, error_msg)
            async with deps._agent_lock:
                deps._pending_spawns.pop(proc.pid, None)
            return JSONResponse({"error": error_msg}, 400)

        return {
            "ok": True,
            "pid": proc.pid,
            "base": base,
            "message": f"Agent '{base}' spawning (pid {proc.pid})",
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.post("/api/kill-agent/{name}")
async def kill_agent(name: str):
    """Kill a specific agent by name."""
    import mcp_bridge
    if hasattr(deps, "worktree_manager") and deps.worktree_manager:
        deps.worktree_manager.merge_changes(name)
        deps.worktree_manager.remove_worktree(name)
    else:
        _warn_missing_worktree_manager("kill", name)
    ok = deps.registry.deregister(name)
    if ok:
        mcp_bridge.cleanup_agent(name)

    session_name = f"ghostlink-{name}"
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", session_name],
            capture_output=True, timeout=5,
        )
    except Exception as e:
        log.debug("tmux kill-session for %s: %s", name, e)

    async with deps._agent_lock:
        proc = deps._agent_processes.pop(name, None)
        if proc is None:
            for key in list(deps._agent_processes):
                if key.startswith(name + "_"):
                    proc = deps._agent_processes.pop(key, None)
                    break
    if proc:
        try:
            proc.terminate()
        except Exception as e:
            log.debug("Process terminate for %s: %s", name, e)

        async def _sigkill_escalation(_proc=proc, _name=name):
            await asyncio.sleep(5)
            try:
                if _proc.poll() is None:
                    _proc.kill()
                    log.info("SIGKILL sent to %s (SIGTERM was ignored)", _name)
            except Exception as _e:
                log.debug("SIGKILL escalation for %s: %s", _name, _e)
        asyncio.get_running_loop().create_task(_sigkill_escalation())

    if ok:
        from app_helpers import get_full_agent_list
        await deps.broadcast("status", {"agents": get_full_agent_list()})
        await _record_activity("agent_leave", f"{name} stopped", agent=name)
        await add_replay_event(name, "agent_leave", title="Agent stopped", detail="Process terminated", surface="session")
        await set_agent_presence(name, surface="session", status="Stopped", detail="Agent stopped", state="offline")
    return {"ok": ok or proc is not None}


@router.post("/api/cleanup")
async def cleanup_stale():
    """Kill stale tmux sessions, clear orphaned processes, free resources."""
    cleaned = []

    try:
        result = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                                capture_output=True, text=True, timeout=5)
        sessions = [s.strip() for s in result.stdout.strip().split("\n") if s.strip().startswith("ghostlink-")]
    except Exception as e:
        log.debug("tmux list-sessions: %s", e)
        sessions = []

    live_names = {inst.name for inst in deps.registry.get_all()}
    for session in sessions:
        agent_name = session.replace("ghostlink-", "")
        if agent_name not in live_names:
            try:
                subprocess.run(["tmux", "kill-session", "-t", session], capture_output=True, timeout=5)
                cleaned.append(session)
            except Exception as e:
                log.debug("Failed to kill stale session %s: %s", session, e)

    async with deps._agent_lock:
        for key, proc in list(deps._agent_processes.items()):
            try:
                if proc.poll() is not None:
                    deps._agent_processes.pop(key, None)
                    cleaned.append(f"process:{key}")
            except Exception as e:
                log.debug("Process cleanup for %s: %s", key, e)

    return {"ok": True, "cleaned": cleaned, "count": len(cleaned)}


@router.post("/api/shutdown")
async def shutdown_server():
    """Gracefully stop the backend server."""
    import signal

    procs_to_kill = []
    async with deps._agent_lock:
        for inst in list(deps.registry.get_all()):
            try:
                proc = deps._agent_processes.get(inst.name)
                if proc and proc.poll() is None:
                    proc.terminate()
                    procs_to_kill.append(proc)
            except Exception as e:
                log.debug("Shutdown: failed to terminate %s: %s", inst.name, e)
    if procs_to_kill:
        await asyncio.sleep(5)
        for proc in procs_to_kill:
            try:
                if proc.poll() is None:
                    proc.kill()
            except Exception:
                pass

    try:
        await deps.broadcast("system", {"event": "server_shutdown", "message": "Server is shutting down"})
    except Exception as e:
        log.debug("Shutdown broadcast failed: %s", e)

    async def _do_shutdown():
        await asyncio.sleep(0.5)
        # Use os._exit on Windows since SIGTERM doesn't work reliably there
        if os.name == 'nt':
            os._exit(0)
        else:
            os.kill(os.getpid(), signal.SIGTERM)

    asyncio.get_running_loop().create_task(_do_shutdown())
    return {"ok": True, "message": "Server shutting down"}


@router.post("/api/heartbeat/{agent_name}")
async def heartbeat(agent_name: str, request: Request):
    inst = deps.registry.get(agent_name)
    if inst:
        deps._last_heartbeats[agent_name] = time.time()
        old_state = inst.state
        was_triggered = getattr(inst, '_was_triggered', False)
        if was_triggered:
            inst.state = "thinking"
            inst._think_ts = time.time()  # type: ignore[attr-defined]
            inst._was_triggered = False  # type: ignore[attr-defined]
        try:
            body = await request.json()
            if body.get("active"):
                if time.time() - inst.registered_at > 5:
                    inst.state = "thinking"
                    inst._think_ts = time.time()  # type: ignore[attr-defined]
            else:
                last_think = getattr(inst, '_think_ts', 0)
                if old_state == "thinking" and (time.time() - last_think) < 3:
                    pass
                elif not was_triggered:
                    inst.state = "active"
        except Exception:
            last_think = getattr(inst, '_think_ts', 0)
            if old_state == "thinking" and (time.time() - last_think) < 3:
                pass
            elif not was_triggered:
                inst.state = "active"
        if inst.state != old_state:
            from app_helpers import get_full_agent_list
            await deps.broadcast("status", {"agents": get_full_agent_list()})
            state_detail = "Processing requests" if inst.state == "thinking" else "Connected"
            await set_agent_presence(
                agent_name,
                surface="thinking" if inst.state == "thinking" else "session",
                status=inst.state.capitalize(),
                detail=state_detail,
                state=inst.state,
            )
        result: dict = {"ok": True, "name": inst.name}
        if inst.is_token_expired():
            result["token"] = inst.rotate_token()
        return result
    return JSONResponse({"error": "not found"}, 404)


@router.post("/api/agents/{agent_name}/thinking")
async def update_thinking(agent_name: str, request: Request):
    """Update an agent's thinking buffer."""
    body = await request.json()
    text = body.get("text", "")
    active = body.get("active", True)

    deps._thinking_buffers[agent_name] = {
        "text": text[-2000:] if text else "",
        "updated_at": time.time(),
        "active": active,
    }

    await deps.broadcast("thinking_stream", {
        "agent": agent_name,
        "text": text[-2000:] if text else "",
        "active": active,
    })
    summary = (text or "").strip().splitlines()[0][:180] if text else ""
    if summary:
        await add_replay_event(
            agent_name,
            "thinking",
            title="Thinking update",
            detail=summary,
            surface="thinking",
        )
    await set_agent_presence(
        agent_name,
        surface="thinking" if active else "session",
        status="Thinking" if active else "Active",
        detail=summary or ("Working" if active else "Idle"),
        state="thinking" if active else "active",
    )

    return {"ok": True}


@router.get("/api/agents/{agent_name}/thinking")
async def get_thinking(agent_name: str):
    """Get current thinking buffer for an agent."""
    buf = deps._thinking_buffers.get(agent_name)
    if not buf or time.time() - buf.get("updated_at", 0) > 30:
        return {"text": "", "active": False}
    return buf


@router.post("/api/approval/respond")
async def respond_approval(request: Request):
    """Respond to an agent's permission prompt."""
    body = await request.json()
    agent_name = (body.get("agent", "") or "").strip()
    response = (body.get("response", "") or "").strip()
    message_id = body.get("message_id", 0)

    if not agent_name or not response:
        return JSONResponse({"error": "agent and response required"}, 400)
    if not _VALID_AGENT_NAME.match(agent_name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    if response not in ("allow_once", "allow_session", "deny"):
        return JSONResponse({"error": "response must be allow_once, allow_session, or deny"}, 400)

    response_file = deps.DATA_DIR / f"{agent_name}_approval.json"
    response_data = json.dumps({
        "response": response,
        "message_id": message_id,
        "timestamp": time.time(),
    })
    tmp_path = response_file.with_suffix(".tmp")
    tmp_path.write_text(response_data)
    os.replace(str(tmp_path), str(response_file))

    if message_id and deps.store._db:
        try:
            cursor = await deps.store._db.execute("SELECT metadata FROM messages WHERE id = ?", (message_id,))
            try:
                row = await cursor.fetchone()
            finally:
                await cursor.close()
            if row:
                try:
                    meta = json.loads(row["metadata"]) if row["metadata"] else {}
                except (json.JSONDecodeError, TypeError):
                    meta = {}
                meta["responded"] = response
                await deps.store._db.execute(
                    "UPDATE messages SET metadata = ? WHERE id = ?",
                    (json.dumps(meta), message_id),
                )
                await deps.store._db.commit()
        except Exception as e:
            log.warning("Failed to update approval message metadata: %s", e)

    await deps.broadcast("approval_response", {
        "agent": agent_name,
        "response": response,
        "message_id": message_id,
    })

    return {"ok": True}


@router.post("/api/agents/{name}/pause")
async def pause_agent(name: str):
    inst = deps.registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    inst.state = "paused"
    from app_helpers import get_full_agent_list
    await deps.broadcast("status", {"agents": get_full_agent_list()})
    await _record_activity("message", f"{inst.label or name} paused", agent=name)
    await add_replay_event(name, "pause", title="Agent paused", detail="Awaiting resume", surface="session")
    await set_agent_presence(name, surface="session", status="Paused", detail="Awaiting resume", state="paused")
    return {"ok": True, "state": "paused"}


@router.post("/api/agents/{name}/resume")
async def resume_agent(name: str):
    inst = deps.registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    inst.state = "active"
    from app_helpers import get_full_agent_list
    await deps.broadcast("status", {"agents": get_full_agent_list()})
    await _record_activity("message", f"{inst.label or name} resumed", agent=name)
    await add_replay_event(name, "resume", title="Agent resumed", detail="Work resumed", surface="session")
    await set_agent_presence(name, surface="session", status="Active", detail="Ready", state="active")
    return {"ok": True, "state": "active"}


# ── Skills ──────────────────────────────────────────────────────────

@router.get("/api/skills")
async def list_skills(category: str = "", search: str = ""):
    """List all available skills, optionally filtered."""
    skills = deps.skills_registry.get_all_skills()
    if category:
        skills = [s for s in skills if s.get("category", "").lower() == category.lower()]
    if search:
        q = search.lower()
        skills = [s for s in skills if q in s["name"].lower() or q in s.get("description", "").lower()]
    return {"skills": skills, "categories": deps.skills_registry.get_categories()}


@router.get("/api/skills/agent/{agent_name}")
async def get_agent_skills(agent_name: str):
    """Get enabled skills for a specific agent."""
    enabled = deps.skills_registry.get_agent_skills(agent_name)
    all_skills = deps.skills_registry.get_all_skills()
    result = []
    for s in all_skills:
        result.append({**s, "enabled": s["id"] in enabled})
    return {"skills": result, "agent": agent_name}


@router.post("/api/skills/agent/{agent_name}/toggle")
async def toggle_agent_skill(agent_name: str, request: Request):
    """Enable or disable a skill for an agent."""
    body = await request.json()
    skill_id = body.get("skillId", "")
    enabled = body.get("enabled", True)
    if enabled:
        deps.skills_registry.enable_skill(agent_name, skill_id)
    else:
        deps.skills_registry.disable_skill(agent_name, skill_id)
    return {"ok": True, "agent": agent_name, "skillId": skill_id, "enabled": enabled}


# ── Agent soul, notes, health, config, memories ──────────────────────

from agent_memory import get_agent_memory, get_soul, set_soul, get_notes, set_notes


@router.get("/api/agents/{name}/soul")
async def api_get_soul(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    agent_dir = deps.DATA_DIR / "agents"
    return {"soul": get_soul(agent_dir, name)}


@router.post("/api/agents/{name}/soul")
async def api_set_soul(name: str, request: Request):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    agent_dir = deps.DATA_DIR / "agents"
    set_soul(agent_dir, name, body.get("content", ""))
    return {"ok": True}


@router.get("/api/agents/{name}/notes")
async def api_get_notes(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    agent_dir = deps.DATA_DIR / "agents"
    return {"notes": get_notes(agent_dir, name)}


@router.post("/api/agents/{name}/notes")
async def api_set_notes(name: str, request: Request):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    agent_dir = deps.DATA_DIR / "agents"
    set_notes(agent_dir, name, body.get("content", ""))
    return {"ok": True}


@router.get("/api/agents/{name}/health")
async def agent_health(name: str):
    inst = deps.registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found", "healthy": False}, 404)
    is_alive = inst.state in ("active", "thinking", "idle", "paused")
    return {"name": name, "healthy": is_alive, "state": inst.state}


@router.get("/api/agents/{name}/config")
async def get_agent_config(name: str):
    inst = deps.registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    return {
        "name": inst.name,
        "base": inst.base,
        "label": inst.label,
        "color": inst.color,
        "workspace": getattr(inst, "workspace", None),
        "command": getattr(inst, "command", None),
        "args": getattr(inst, "args", []),
        "role": getattr(inst, "role", None),
        "responseMode": getattr(inst, "responseMode", "mentioned"),
        "thinkingLevel": getattr(inst, "thinkingLevel", ""),
        "model": getattr(inst, "model", ""),
        "failoverModel": getattr(inst, "failoverModel", ""),
        "autoApprove": getattr(inst, "autoApprove", False),
    }


@router.post("/api/agents/{name}/config")
async def set_agent_config(name: str, request: Request):
    inst = deps.registry.get(name)
    if not inst:
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    _CONFIG_VALIDATORS = {
        "label": lambda v: isinstance(v, str) and 0 < len(v) <= 50,
        "color": lambda v: isinstance(v, str) and len(v) <= 20,
        "role": lambda v: isinstance(v, str) and v in ("", "manager", "worker", "peer"),
        "workspace": lambda v: isinstance(v, str) and len(v) <= 500,
        "responseMode": lambda v: isinstance(v, str) and v in ("mentioned", "always", "listen", "silent"),
        "thinkingLevel": lambda v: isinstance(v, str) and v in ("", "off", "minimal", "low", "medium", "high"),
        "model": lambda v: isinstance(v, str) and len(v) <= 100,
        "failoverModel": lambda v: isinstance(v, str) and len(v) <= 100,
        "autoApprove": lambda v: isinstance(v, bool),
    }
    for key, validator in _CONFIG_VALIDATORS.items():
        if key in body:
            if not validator(body[key]):
                return JSONResponse({"error": f"invalid value for {key}"}, 400)
            setattr(inst, key, body[key])
    if any(k in body for k in ("role", "responseMode", "thinkingLevel", "model", "autoApprove")):
        from app_helpers import get_full_agent_list
        await deps.broadcast("status", {"agents": get_full_agent_list()})
    return {"ok": True}


@router.get("/api/agents/{name}/memories")
async def list_agent_memories(name: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    agent_dir = deps.DATA_DIR / "agents"
    mem = get_agent_memory(agent_dir, name)
    return {"memories": mem.list_all()}


@router.get("/api/agents/{name}/memories/{key}")
async def api_get_agent_memory(name: str, key: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    agent_dir = deps.DATA_DIR / "agents"
    mem = get_agent_memory(agent_dir, name)
    val = mem.load(key)
    if val is None:
        return JSONResponse({"error": "not found"}, 404)
    return {"key": key, "value": val}


@router.delete("/api/agents/{name}/memories/{key}")
async def api_delete_agent_memory(name: str, key: str):
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    agent_dir = deps.DATA_DIR / "agents"
    mem = get_agent_memory(agent_dir, name)
    ok = mem.delete(key)
    return {"ok": ok}


@router.post("/api/agents/{name}/feedback")
async def agent_feedback(name: str, request: Request):
    """Record thumbs up/down feedback on an agent's message."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    body = await request.json()
    message_id = body.get("message_id", 0)
    rating = body.get("rating", "")
    if rating not in ("up", "down"):
        return JSONResponse({"error": "rating must be 'up' or 'down'"}, 400)

    msg_text = ""
    if message_id and deps.store._db:
        cursor = await deps.store._db.execute("SELECT text FROM messages WHERE id = ?", (message_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        if row:
            msg_text = row["text"][:200]

    agent_dir = deps.DATA_DIR / "agents"
    mem = get_agent_memory(agent_dir, name)
    feedback_key = "_feedback"
    existing = mem.load(feedback_key)
    feedback_list = []
    if existing and isinstance(existing.get("content"), str):
        try:
            feedback_list = json.loads(existing["content"])
        except (json.JSONDecodeError, TypeError):
            feedback_list = []

    feedback_list.append({
        "message_id": message_id,
        "rating": rating,
        "preview": msg_text,
        "timestamp": time.time(),
    })
    feedback_list = feedback_list[-50:]
    mem.save(feedback_key, json.dumps(feedback_list))

    if message_id:
        emoji = "👍" if rating == "up" else "👎"
        await deps.store.react(message_id, emoji, deps._settings.get("username", "You"))

    return {"ok": True, "agent": name, "rating": rating, "total_feedback": len(feedback_list)}


# ── Terminal ─────────────────────────────────────────────────────────

@router.post("/api/agents/{name}/terminal/open")
async def open_terminal(name: str):
    """Open a visible terminal window attached to the agent's tmux session."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    session_name = f"ghostlink-{name}"
    try:
        result = subprocess.run(
            ["tmux", "has-session", "-t", session_name],
            capture_output=True, timeout=3,
        )
        if result.returncode != 0:
            return JSONResponse({"error": f"No active session for {name}"}, 404)
    except Exception:
        return JSONResponse({"error": "tmux not available"}, 500)

    try:
        import shutil as _shutil
        wt = _shutil.which("wt.exe")
        if wt:
            subprocess.Popen(
                ["wt.exe", "wsl", "tmux", "attach-session", "-t", session_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return {"ok": True, "method": "windows-terminal"}

        cmd_exe = _shutil.which("cmd.exe")
        if cmd_exe:
            subprocess.Popen(
                [cmd_exe, "/c", "start", "wsl", "tmux", "attach-session", "-t", session_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return {"ok": True, "method": "cmd"}

        for term in ["gnome-terminal", "xterm", "konsole", "alacritty", "kitty"]:
            if _shutil.which(term):
                subprocess.Popen(
                    [term, "--", "tmux", "attach-session", "-t", session_name],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                return {"ok": True, "method": term}

        return JSONResponse({"error": "No terminal emulator found"}, 500)
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.get("/api/agents/{name}/terminal")
async def peek_terminal(name: str, lines: int = 30):
    """Capture the last N lines from an agent's tmux pane."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    session_name = f"ghostlink-{name}"
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session_name, "-p", "-S", f"-{lines}"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode != 0:
            return {"name": name, "output": "", "active": False}
        return {"name": name, "output": result.stdout, "active": True}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"name": name, "output": "", "active": False}


@router.get("/api/agents/{name}/terminal/live")
async def get_terminal_live(name: str):
    """Return the last streamed terminal snapshot for an agent."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    with deps._agent_state_lock:
        payload = dict(deps._terminal_streams.get(name, {}))
    if not payload:
        return {"agent": name, "output": "", "active": False, "updated_at": 0}
    return payload


@router.get("/api/agents/{name}/presence")
async def get_agent_presence(name: str):
    """Return the current in-app visibility state for an agent."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    with deps._agent_state_lock:
        payload = dict(deps._agent_presence.get(name, {}))
    if not payload:
        inst = deps.registry.get(name) if deps.registry else None
        return {
            "agent": name,
            "label": _get_agent_label(name),
            "surface": "idle",
            "status": inst.state if inst else "offline",
            "detail": "",
            "updated_at": 0,
        }
    return payload


@router.get("/api/agents/{name}/browser")
async def get_agent_browser_state(name: str):
    """Return the latest browser/session visibility state for an agent."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    with deps._agent_state_lock:
        payload = dict(deps._agent_browser_state.get(name, {}))
    if not payload:
        return {
            "agent": name,
            "mode": "",
            "status": "",
            "url": "",
            "query": "",
            "title": "",
            "preview": "",
            "artifact_url": "",
            "updated_at": 0,
        }
    payload.pop("artifact_path", None)
    return payload


@router.get("/api/agents/{name}/browser/artifact")
async def get_agent_browser_artifact(name: str):
    """Serve the latest browser snapshot artifact for an agent, if any."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    with deps._agent_state_lock:
        artifact_path = str(deps._agent_browser_state.get(name, {}).get("artifact_path", ""))
    if not artifact_path:
        return JSONResponse({"error": "artifact not found"}, 404)
    path = Path(artifact_path).resolve()
    if not path.is_file():
        return JSONResponse({"error": "artifact not found"}, 404)
    return FileResponse(path)


@router.get("/api/agents/{name}/replay")
async def get_agent_replay(name: str, since: float = 0, limit: int = 100):
    """Return structured replay events for an agent."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    limit = max(1, min(limit, 300))
    with deps._agent_state_lock:
        events = [
            dict(event)
            for event in deps._agent_replay_log
            if event.get("agent") == name and event.get("timestamp", 0) > since
        ]
    return {"events": events[-limit:]}


@router.get("/api/agents/{name}/diff")
async def get_agent_file_diff(name: str, path: str = ""):
    """Return the most recent cached diff for an agent/file path."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    if not path:
        return JSONResponse({"error": "path required"}, 400)
    with deps._agent_state_lock:
        payload = dict(deps._file_diff_cache.get(name, {}).get(path, {}))
    if not payload:
        return JSONResponse({"error": "diff not found"}, 404)
    return payload


# ── Workspace viewer (v3.8.0) ──────────────────────────────────────

_WORKSPACE_SKIP_NAMES = {"node_modules", "__pycache__", ".venv", "venv", ".git", "dist"}
_WORKSPACE_VISIBLE_DOTFILES = {".gitignore"}
_WORKSPACE_MAX_FILE_SIZE = 500_000


def _get_agent_workspace_path(name: str) -> Path:
    inst = deps.registry.get(name) if deps.registry else None
    workspace = getattr(inst, "workspace", None) if inst else None
    if not workspace:
        for pa in deps._settings.get("persistentAgents", []):
            base = pa.get("base", "")
            if pa.get("name") == name or pa.get("label") == name or pa.get("base") == name or (base and name.startswith(base)):
                workspace = pa.get("cwd", ".")
                break
    return Path(workspace or ".").resolve()


def _resolve_workspace_target(workspace: Path, raw_path: str, *, expect_dir: bool | None = None) -> Path:
    requested = (raw_path or ".").strip()
    target = (workspace / requested).resolve()
    try:
        target.relative_to(workspace)
    except ValueError as exc:
        raise PermissionError("path traversal blocked") from exc

    if expect_dir is True and not target.is_dir():
        raise FileNotFoundError("directory not found")
    if expect_dir is False and not target.is_file():
        raise FileNotFoundError("file not found")
    return target


def _list_workspace_entries(workspace: Path, current: Path) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    try:
        for entry in sorted(current.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name in _WORKSPACE_SKIP_NAMES:
                continue
            if entry.name.startswith(".") and entry.name not in _WORKSPACE_VISIBLE_DOTFILES:
                continue
            rel_path = entry.relative_to(workspace)
            entries.append({
                "name": entry.name,
                "path": str(rel_path),
                "type": "directory" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
            })
    except PermissionError:
        pass
    return entries


def _get_workspace_git_status(workspace: Path) -> tuple[str, dict[str, str]]:
    git_status = ""
    git_file_status: dict[str, str] = {}
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-1"],
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            git_status = result.stdout.strip()

        porcelain = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if porcelain.returncode == 0:
            for line in porcelain.stdout.strip().splitlines():
                if len(line) < 4:
                    continue
                status_code = line[:2].strip()
                fname = line[3:].strip().split("/")[0]
                git_file_status[fname] = status_code
    except Exception:
        pass
    return git_status, git_file_status


@router.get("/api/agents/{name}/workspace")
async def get_agent_workspace(name: str):
    """List top-level files in an agent's workspace directory."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)

    ws = _get_agent_workspace_path(name)
    if not ws.is_dir():
        return {"files": [], "workspace": str(ws), "git_status": ""}

    files = _list_workspace_entries(ws, ws)
    git_status, git_file_status = _get_workspace_git_status(ws)
    for entry in files:
        entry["git_status"] = git_file_status.get(str(entry["name"]), "")
    return {"files": files, "workspace": str(ws), "git_status": git_status}


@router.get("/api/agents/{name}/workspace/file")
async def get_agent_workspace_file(name: str, path: str = ""):
    """Read a file from an agent's workspace."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    if not path:
        return JSONResponse({"error": "path required"}, 400)

    ws = _get_agent_workspace_path(name)
    try:
        file_path = _resolve_workspace_target(ws, path, expect_dir=False)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, 403)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, 404)

    if file_path.stat().st_size > _WORKSPACE_MAX_FILE_SIZE:
        return JSONResponse({"error": "file too large (>500KB)"}, 413)

    try:
        content = file_path.read_text("utf-8", errors="replace")
        await _record_activity("message", f"Viewed {name} workspace file {path}", agent=name)
        await add_replay_event(name, "file_open", title="Opened file", detail=path, surface="files", path=path)
        return {"path": path, "content": content, "size": len(content)}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.get("/api/agents/{name}/workspace/changes")
async def get_agent_workspace_changes(name: str, since: float = 0, limit: int = 100):
    """Return recent workspace changes attributed to an agent."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)
    limit = max(1, min(limit, 200))
    with deps._agent_state_lock:
        events = [
            dict(change)
            for change in deps._workspace_changes
            if change.get("agent") == name and change.get("timestamp", 0) > since
        ]
    return {"changes": events[-limit:]}


@router.get("/api/agents/{name}/files")
async def list_agent_files(name: str, path: str = "."):
    """List files for a subdirectory inside an agent workspace."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)

    ws = _get_agent_workspace_path(name)
    if not ws.is_dir():
        return JSONResponse({"error": "workspace not found"}, 404)

    try:
        current = _resolve_workspace_target(ws, path, expect_dir=True)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, 403)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, 404)

    entries = _list_workspace_entries(ws, current)
    return {
        "entries": entries,
        "path": "." if current == ws else str(current.relative_to(ws)),
        "workspace": str(ws),
    }


@router.get("/api/agents/{name}/file")
async def read_agent_file(name: str, path: str = ""):
    """Read a file from anywhere inside an agent workspace."""
    return await get_agent_workspace_file(name, path)


@router.put("/api/agents/{name}/file")
async def write_agent_file(name: str, request: Request):
    """Write a text file inside an agent workspace for in-app editing."""
    if not _VALID_AGENT_NAME.match(name):
        return JSONResponse({"error": "invalid agent name"}, 400)

    body = await request.json()
    path = str(body.get("path", "")).strip()
    content = body.get("content", "")
    if not path:
        return JSONResponse({"error": "path required"}, 400)
    if not isinstance(content, str):
        return JSONResponse({"error": "content must be a string"}, 400)

    ws = _get_agent_workspace_path(name)
    if not ws.is_dir():
        return JSONResponse({"error": "workspace not found"}, 404)

    try:
        file_path = _resolve_workspace_target(ws, path, expect_dir=None)
    except PermissionError as exc:
        return JSONResponse({"error": str(exc)}, 403)

    try:
        before = _read_text_file_for_diff(file_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        await _record_activity("message", f"Saved {name} workspace file {path}", agent=name)
        await add_replay_event(name, "file_save", title="Saved file", detail=path, surface="files", path=path)
        if before != content:
            await cache_file_diff(name, path, before, content, "modified" if before else "created")
        return {
            "ok": True,
            "path": str(file_path.relative_to(ws)),
            "size": len(content),
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)
