from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from agent_memory import (
    generate_agent_context,
    get_notes,
    get_soul,
    resolve_agent_dir,
    set_notes,
    set_soul,
)

_EXEC_PROVIDERS = {"codex", "gemini", "ollama"}
_PERSISTENT_PROVIDERS = {"claude", "aider", "grok"}


def _provider_target(project_dir: Path, provider: str) -> Path:
    if provider == "claude":
        return project_dir / ".claude" / "instructions.md"
    if provider == "codex":
        return project_dir / ".codex" / "instructions.md"
    if provider == "aider":
        return project_dir / ".aider.conventions.md"
    if provider == "grok":
        return project_dir / ".grok" / "instructions.md"
    return project_dir / "INSTRUCTIONS.md"


def _is_isolated_workspace(project_dir: Path, agent_name: str) -> bool:
    parts = set(project_dir.parts)
    return ".ghostlink-worktrees" in parts and agent_name in parts


def _identity_markdown(
    *,
    agent_id: str,
    agent_name: str,
    label: str,
    provider: str,
    profile_id: str,
    workspace_id: str,
    session_id: str = "",
    parent_agent_id: str = "",
    created_at: float | None = None,
    last_injected_at: float | None = None,
) -> str:
    created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created_at or time.time()))
    injected = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last_injected_at or time.time()))
    parent = parent_agent_id or "(none)"
    return "\n".join(
        [
            "# Agent Identity",
            "",
            f"- **agent_id:** {agent_id}",
            f"- **display_name:** {agent_name}",
            f"- **label:** {label or agent_name}",
            f"- **base:** {provider}",
            f"- **provider:** {provider}",
            f"- **profile_id:** {profile_id}",
            f"- **workspace_id:** {workspace_id}",
            f"- **session_id:** {session_id or '(unknown)'}",
            f"- **parent_agent_id:** {parent}",
            f"- **created_at:** {created}",
            f"- **last_injected_at:** {injected}",
            "",
        ]
    )


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return {}


def get_effective_state(data_dir: Path, agent_identifier: str) -> dict:
    agent_dir = resolve_agent_dir(data_dir, agent_identifier)
    state_path = agent_dir / "state.json"
    state = _load_json(state_path)
    if state:
        return state

    try:
        import deps

        inst = deps.registry.resolve(agent_identifier) if deps.registry else None
    except Exception:
        inst = None

    now = time.time()
    agent_id = getattr(inst, "agent_id", agent_identifier)
    name = getattr(inst, "name", agent_identifier)
    base = getattr(inst, "base", "")
    workspace = getattr(inst, "workspace", "")
    state = {
        "agent_id": agent_id,
        "display_name": name,
        "session_id": "",
        "base": base,
        "provider": base,
        "profile_id": "default",
        "workspace_id": workspace,
        "soul_hash": "",
        "last_inject_trigger": "",
        "last_inject_at": 0.0,
        "last_heartbeat_at": 0.0,
        "injection_count": 0,
        "drift_detected": False,
        "drift_score": 0.0,
        "drift_reason": "",
        "reinforcement_pending": False,
        "last_reinforcement_at": 0.0,
        "reinforcement_count": 0,
        "degraded": False,
        "degraded_reason": "",
        "reason": "",
        "updated_at": now,
    }
    return state


def write_effective_state(data_dir: Path, agent_identifier: str, state: dict) -> Path:
    agent_dir = resolve_agent_dir(data_dir, agent_identifier)
    agent_dir.mkdir(parents=True, exist_ok=True)
    state_path = agent_dir / "state.json"
    state_path.write_text(json.dumps(state, indent=2) + "\n", "utf-8")
    return state_path


def mark_identity_drift(data_dir: Path, agent_identifier: str, *, reason: str) -> dict:
    state = get_effective_state(data_dir, agent_identifier)
    state["drift_detected"] = True
    state["reason"] = reason
    state["drift_reason"] = reason
    state["drift_score"] = max(float(state.get("drift_score", 0.0) or 0.0), 1.0)
    state["reinforcement_pending"] = True
    state["updated_at"] = time.time()
    write_effective_state(data_dir, agent_identifier, state)
    return state


def record_identity_reinforcement(data_dir: Path, agent_identifier: str, *, trigger: str) -> dict:
    state = get_effective_state(data_dir, agent_identifier)
    now = time.time()
    state["last_inject_trigger"] = trigger
    state["last_reinforcement_at"] = now
    state["reinforcement_count"] = int(state.get("reinforcement_count", 0) or 0) + 1
    state["reinforcement_pending"] = False
    state["drift_detected"] = False
    state["drift_score"] = 0.0
    state["drift_reason"] = ""
    state["reason"] = ""
    state["updated_at"] = now
    write_effective_state(data_dir, agent_identifier, state)
    return state


def inject_identity(
    *,
    agent_id: str,
    agent_name: str,
    agent_base: str,
    label: str,
    role: str,
    data_dir: Path,
    project_dir: Path,
    mcp_settings_path: Path | None,
    trigger: str,
    session_id: str = "",
    delegation_context: str = "",
) -> dict:
    agent_dir = resolve_agent_dir(data_dir, agent_id)
    injection_dir = agent_dir / "injection"
    injection_dir.mkdir(parents=True, exist_ok=True)

    default_soul = " ".join(
        [
            f"You are **{label or agent_name}** (agent name: @{agent_name}).",
            f"Your role: {role}." if role else "",
            "You collaborate with other agents and humans via @mentions in GhostLink.",
            "Be helpful, thorough, and proactive. Stay in character for your role.",
        ]
    ).strip()
    current_soul = get_soul(data_dir, agent_id)
    if not current_soul or current_soul == f"You are {agent_id}, an AI agent in GhostLink. You collaborate with other agents via @mentions. Be helpful, thorough, and proactive.":
        current_soul = default_soul
    set_soul(data_dir, agent_id, current_soul)
    set_notes(data_dir, agent_id, get_notes(data_dir, agent_id))

    context_content = generate_agent_context(agent_name, current_soul)
    if delegation_context:
        context_content += f"\n\n## Delegation Context\n{delegation_context.strip()}\n"
    context_path = injection_dir / "context.md"
    context_path.write_text(context_content, "utf-8")

    soul_hash = hashlib.sha256(context_content.encode("utf-8")).hexdigest()
    (injection_dir / "soul_hash.sha256").write_text(f"sha256:{soul_hash}\n", "utf-8")

    now = time.time()
    existing_state = get_effective_state(data_dir, agent_id)
    state = {
        **existing_state,
        "agent_id": agent_id,
        "display_name": agent_name,
        "session_id": session_id or existing_state.get("session_id", ""),
        "base": agent_base,
        "provider": agent_base,
        "profile_id": existing_state.get("profile_id", "default") or "default",
        "workspace_id": str(project_dir),
        "soul_hash": f"sha256:{soul_hash}",
        "last_inject_trigger": trigger,
        "last_inject_at": now,
        "injection_count": int(existing_state.get("injection_count", 0) or 0) + 1,
        "drift_detected": False,
        "drift_score": 0.0,
        "drift_reason": "",
        "reinforcement_pending": False,
        "last_reinforcement_at": now,
        "reinforcement_count": int(existing_state.get("reinforcement_count", 0) or 0)
        + (1 if trigger != "spawn" else 0),
        "reason": "",
        "updated_at": now,
        "degraded": False,
        "degraded_reason": "",
    }

    target_path: Path | None = None
    degraded_reason = ""

    if agent_base == "gemini":
        if mcp_settings_path and mcp_settings_path.exists():
            settings = _load_json(mcp_settings_path)
            settings["systemInstruction"] = context_content[:4000]
            mcp_settings_path.write_text(json.dumps(settings, indent=2) + "\n", "utf-8")
            target_path = mcp_settings_path
    else:
        target_path = _provider_target(project_dir, agent_base)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(context_content, "utf-8")
        if agent_base in _PERSISTENT_PROVIDERS and not _is_isolated_workspace(project_dir, agent_name):
            degraded_reason = "shared_workspace_identity_file"
        if agent_base not in _EXEC_PROVIDERS and target_path == project_dir / "INSTRUCTIONS.md":
            degraded_reason = degraded_reason or "shared_workspace_identity_file"

    state["degraded"] = bool(degraded_reason)
    state["degraded_reason"] = degraded_reason
    if degraded_reason:
        state["drift_detected"] = True
        state["reason"] = degraded_reason
        state["drift_reason"] = degraded_reason
        state["drift_score"] = 1.0
        state["reinforcement_pending"] = True

    identity_md = _identity_markdown(
        agent_id=agent_id,
        agent_name=agent_name,
        label=label,
        provider=agent_base,
        profile_id=state["profile_id"],
        workspace_id=str(project_dir),
        session_id=state.get("session_id", ""),
        created_at=existing_state.get("created_at", now),
        last_injected_at=now,
    )
    (agent_dir / "IDENTITY.md").write_text(identity_md, "utf-8")
    soul_md = agent_dir / "SOUL.md"
    if not soul_md.exists() or soul_md.read_text("utf-8") != current_soul:
        soul_md.write_text(current_soul, "utf-8")
    notes_md = agent_dir / "NOTES.md"
    notes_md.write_text(get_notes(data_dir, agent_id), "utf-8")
    write_effective_state(data_dir, agent_id, state)
    (injection_dir / "last_inject.json").write_text(
        json.dumps(
            {
                "injected": True,
                "trigger": trigger,
                "provider": agent_base,
                "path": str(target_path) if target_path else "",
                "degraded": bool(degraded_reason),
                "degraded_reason": degraded_reason,
                "timestamp": now,
            },
            indent=2,
        )
        + "\n",
        "utf-8",
    )

    return {
        "injected": True,
        "trigger": trigger,
        "path": str(target_path or context_path),
        "soul_hash": f"sha256:{soul_hash}",
        "degraded": bool(degraded_reason),
        "degraded_reason": degraded_reason,
        "state_path": str(agent_dir / "state.json"),
        "context_path": str(context_path),
    }
