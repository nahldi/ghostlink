"""Operator-safe introspection routes."""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi.routing import APIRoute

import deps
from agent_memory import get_agent_memory
from policy import DEFAULT_TIER_BEHAVIOR, TOOL_TIERS
from providers import PROVIDERS
from registry import AgentInstance
from skills import BUILTIN_SKILLS

router = APIRouter()
log = logging.getLogger(__name__)

_MEMORY_LAYERS = ("identity", "workspace", "session")
_PERSONA_COUNT = 14
_SECRET_RE = __import__("re").compile(
    r"(?i)("
    r"sk-[a-z0-9_-]{8,}|"
    r"bearer\s+[a-z0-9._-]{8,}|"
    r"cookie\s*[:=]\s*[^;\s]{4,}|"
    r"(?:postgres|mysql|mongodb(?:\+srv)?|redis)://\S+|"
    r"[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*['\"]?[^\s'\";]{4,}"
    r")"
)


def _iso_or_none(value: float | int | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _estimate_tokens(content: str) -> int:
    text = str(content or "").strip()
    return max(1, math.ceil(len(text.split()) * 1.3)) if text else 0


def _redacted(value: object) -> bool:
    return bool(_SECRET_RE.search(str(value or "")))


def _memory_summary_for_agent(inst: AgentInstance) -> dict:
    agent_dir = Path(deps.DATA_DIR) / "agents" / inst.agent_id / "memory"
    mem = get_agent_memory(deps.DATA_DIR, inst.agent_id)
    layers = {
        layer: {"entry_count": 0, "total_tokens": 0}
        for layer in _MEMORY_LAYERS
    }
    total_entries = 0
    total_tokens = 0
    last_accessed: float | None = None
    has_conflicts = False
    all_entries: list[dict] = []

    if agent_dir.exists():
        for file_path in agent_dir.rglob("*.json"):
            try:
                entry = json.loads(file_path.read_text("utf-8"))
            except Exception:
                log.debug("Skipping unreadable memory file: %s", file_path, exc_info=True)
                continue
            layer = str(entry.get("layer") or file_path.parent.name or "workspace")
            if layer not in layers:
                continue
            content = str(entry.get("content") or "")
            token_count = int(entry.get("size_tokens") or _estimate_tokens(content))
            layers[layer]["entry_count"] += 1
            layers[layer]["total_tokens"] += token_count
            total_entries += 1
            total_tokens += token_count
            accessed = float(entry.get("last_accessed") or entry.get("updated_at") or entry.get("created_at") or 0)
            if accessed and (last_accessed is None or accessed > last_accessed):
                last_accessed = accessed
            all_entries.append(entry)

    # Detect conflicts: check for "conflict" tag OR use real conflict detection
    if not has_conflicts:
        for entry in all_entries:
            tags = {str(t).lower() for t in entry.get("tags", [])}
            if "conflict" in tags:
                has_conflicts = True
                break
    if not has_conflicts and all_entries:
        try:
            for entry in all_entries:
                normalized = mem._normalize_entry(entry, layer=str(entry.get("layer") or "workspace"))
                if mem._detect_conflicts(normalized):
                    has_conflicts = True
                    break
        except Exception:
            pass  # best-effort

    return {
        "agent_id": inst.agent_id,
        "agent_name": inst.name,
        "layers": layers,
        "total_entries": total_entries,
        "total_tokens": total_tokens,
        "last_accessed": _iso_or_none(last_accessed),
        "has_conflicts": has_conflicts,
    }


def _tool_category(tool_name: str) -> str:
    if tool_name.startswith("chat_"):
        return "chat"
    if tool_name.startswith("memory_"):
        return "memory"
    if tool_name.startswith("web_") or tool_name in {"browser_snapshot"}:
        return "web"
    if tool_name.startswith("gemini_") or tool_name in {"image_generate", "image_edit", "generate_video", "generate_music", "text_to_speech", "speech_to_text"}:
        return "creative"
    if tool_name in {"set_thinking", "sessions_list", "sessions_send", "delegate"}:
        return "control"
    return "system"


def _tool_risk_tier(tool_name: str) -> str:
    tier = TOOL_TIERS.get(tool_name, "high_risk_write")
    if tier in {"read_only", "low_risk_write"}:
        return "low"
    if tier in {"shell_exec", "network_egress", "external_messaging"}:
        return "medium"
    return "high"


def _tool_policy_mode(tool_name: str) -> str:
    tier = TOOL_TIERS.get(tool_name, "high_risk_write")
    behavior = DEFAULT_TIER_BEHAVIOR.get(tier, "allow")
    if behavior == "escalate":
        return "ask"
    return behavior


@router.get("/api/introspect/memory")
async def introspect_memory():
    agents = []
    totals = {"agents": 0, "entries": 0, "tokens": 0}
    registry = deps.registry
    for inst in registry.get_all() if registry else []:
        summary = _memory_summary_for_agent(inst)
        agents.append(summary)
        totals["entries"] += int(summary["total_entries"])
        totals["tokens"] += int(summary["total_tokens"])
    totals["agents"] = len(agents)
    return {"agents": agents, "totals": totals}


@router.get("/api/introspect/tools")
async def introspect_tools():
    import mcp_bridge

    tool_stats = getattr(deps, "_mcp_tool_stats", {}) or {}
    tools = []
    total_invocations = 0
    for func in getattr(mcp_bridge, "_ALL_TOOLS", []):
        name = func.__name__
        stats = dict(tool_stats.get(name, {}) or {})
        invocation_count = int(stats.get("invocation_count", 0) or 0)
        success_count = int(stats.get("success_count", 0) or 0)
        failure_count = int(stats.get("failure_count", 0) or 0)
        total_invocations += invocation_count
        tools.append(
            {
                "name": name,
                "category": _tool_category(name),
                "enabled": True,
                "policy_mode": _tool_policy_mode(name),
                "risk_tier": _tool_risk_tier(name),
                "invocation_count": invocation_count,
                "success_count": success_count,
                "failure_count": failure_count,
                "last_used": _iso_or_none(stats.get("last_used")),
            }
        )

    return {
        "tools": tools,
        "totals": {
            "tools": len(tools),
            "enabled": len(tools),
            "disabled": 0,
            "total_invocations": total_invocations,
        },
    }


def _count_routes() -> tuple[int, int]:
    """Count route modules and endpoints from the live FastAPI app."""
    try:
        import app as _app
        fa = getattr(_app, "app", None)
        if fa is None:
            return 0, 0
        modules = set()
        endpoints = 0
        for route in getattr(fa, "routes", []):
            if not isinstance(route, APIRoute) or not str(getattr(route, "path", "")).startswith("/api/"):
                continue
            mod = getattr(getattr(route, "endpoint", None), "__module__", "")
            if mod.startswith("routes."):
                modules.add(mod)
            endpoints += 1
        return len(modules), endpoints
    except Exception:
        return 0, 0


@router.get("/api/introspect/stats")
async def introspect_stats():
    import app as app_module
    import mcp_bridge

    total_messages = 0
    if getattr(deps.store, "_db", None) is not None:
        cursor = await deps.store._db.execute("SELECT COUNT(*) AS cnt FROM messages")
        try:
            row = await cursor.fetchone()
            total_messages = int(row["cnt"]) if row is not None else 0
        finally:
            await cursor.close()

    tasks = {"total": 0, "running": 0, "completed": 0, "failed": 0}
    if deps.task_store is not None:
        try:
            items = await deps.task_store.list()
        except Exception:
            items = []
        tasks["total"] = len(items)
        for item in items:
            status = str(item.get("status", "") or "").lower()
            if status in {"running", "active", "in_progress"}:
                tasks["running"] += 1
            elif status == "completed":
                tasks["completed"] += 1
            elif status == "failed":
                tasks["failed"] += 1

    registry_agents = deps.registry.get_all() if deps.registry else []
    active_agents = [inst for inst in registry_agents if getattr(inst, "state", "") not in {"offline", "stopped"}]
    available_providers = deps.provider_registry.detect_available() if deps.provider_registry is not None else []
    error_cutoff = time.time() - 3600
    recent_logs = [entry for entry in list(deps._server_logs) if float(entry.get("timestamp", 0) or 0) >= error_cutoff]
    error_logs = [entry for entry in recent_logs if str(entry.get("level", "")).upper() == "ERROR"]

    return {
        "uptime_seconds": time.time() - deps._settings.get("_server_start", time.time()),
        "agents": {"total": len(registry_agents), "active": len(active_agents)},
        "tasks": tasks,
        "messages": {"total": total_messages},
        "routes": dict(zip(("modules", "endpoints"), _count_routes())),
        "tools": {"total": len(getattr(mcp_bridge, "_ALL_TOOLS", [])), "mcp_tools": len(getattr(mcp_bridge, "_ALL_TOOLS", []))},
        "providers": {"total": len(PROVIDERS), "configured": sum(1 for item in available_providers if item.get("configured"))},
        "skills": {"total": len(BUILTIN_SKILLS)},
        "personas": {"total": _PERSONA_COUNT},
        "errors": {"rate_1h": round(len(error_logs) / 60.0, 4)},
        "version": app_module.__version__,
    }
