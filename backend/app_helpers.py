"""Shared helper functions used by app.py and route modules.

These are thin wrappers over deps state so route modules can call
them without importing app.py (which would create circular imports).
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import deps

log = logging.getLogger(__name__)


def save_settings():
    """Persist the in-memory settings dict to disk. Shared across all route modules."""
    settings_path = deps.DATA_DIR / "settings.json"
    try:
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        with open(settings_path, "w") as f:
            json.dump(deps._settings, f, indent=2)
    except Exception as e:
        log.error("Failed to save settings to %s: %s", settings_path, e)


def get_full_agent_list() -> list[dict]:
    """Get ALL agents — live from registry + offline from config. Never loses agents."""
    live = deps.registry.get_public_list()
    live_names = {a["name"] for a in live}
    live_bases = {a["base"] for a in live}
    agents_cfg = deps.CONFIG.get("agents", {})

    # Enrich live agents
    for a in live:
        cfg = agents_cfg.get(a.get("base", ""), {})
        cwd_raw = cfg.get("cwd", ".")
        cwd_path = str((deps.BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
        a["workspace"] = cwd_path
        a["command"] = cfg.get("command", a.get("base", ""))
        a["args"] = cfg.get("args", [])

    # Add persistent agents from settings
    for pa in deps._settings.get("persistentAgents", []):
        if pa["base"] not in agents_cfg and pa["base"] not in live_bases:
            agents_cfg[pa["base"]] = {
                "command": pa.get("command", pa["base"]),
                "label": pa.get("label", pa["base"].capitalize()),
                "color": pa.get("color", "#a78bfa"),
                "cwd": pa.get("cwd", "."),
                "args": pa.get("args", []),
            }

    # Add offline agents from config
    for name, cfg in agents_cfg.items():
        if name not in live_names and name not in live_bases:
            cwd_raw = cfg.get("cwd", ".")
            cwd_path = str((deps.BASE_DIR / cwd_raw).resolve()) if not Path(cwd_raw).is_absolute() else cwd_raw
            live.append({
                "name": name, "base": name,
                "label": cfg.get("label", name.capitalize()),
                "color": cfg.get("color", "#a78bfa"),
                "slot": 0, "state": "offline",
                "registered_at": 0, "role": "",
                "workspace": cwd_path,
                "command": cfg.get("command", name),
                "args": cfg.get("args", []),
            })
    return live


def _append_jsonl_locked(queue_file: Path, payload: dict) -> None:
    lock_path = queue_file.with_suffix(queue_file.suffix + ".lock")
    deadline = time.time() + 2.0

    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            break
        except FileExistsError:
            if time.time() >= deadline:
                raise TimeoutError(f"timed out waiting for queue lock: {lock_path.name}") from None
            time.sleep(0.05)

    try:
        with open(queue_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    finally:
        os.close(fd)
        try:
            os.unlink(lock_path)
        except FileNotFoundError:
            pass


def route_mentions(sender: str, text: str, channel: str):
    """Parse @mentions and route based on responseMode."""
    import re
    mentions = re.findall(r"@(\w[\w-]*)", text)

    agent_names = [inst.name for inst in deps.registry.get_all()]
    targets = []
    preliminary_targets: list[str] = []

    if mentions:
        if "all" in mentions:
            preliminary_targets = [n for n in agent_names if n != sender]
        else:
            preliminary_targets = [m for m in mentions if m in agent_names and m != sender]

        # Loop guard via router
        targets = deps.router_inst.get_targets(sender, text, channel, agent_names)
        log.info(
            "[routing] sender=%s channel=%s mentions=%s agent_names=%s preliminary_targets=%s router_targets=%s",
            sender, channel, mentions, agent_names, preliminary_targets, targets,
        )

    # Add agents with 'always' or 'listen' responseMode (even without @mention)
    for inst in deps.registry.get_all():
        if inst.name == sender:
            continue
        if inst.name in targets:
            continue
        if getattr(inst, 'responseMode', 'mentioned') in ('always', 'listen'):
            targets.append(inst.name)

    if not targets:
        return

    # Skip paused agents
    targets = [t for t in targets if not (deps.registry.get(t) and deps.registry.get(t).state == "paused")]

    for target in targets:
        # Mark agent as triggered so thinking state activates
        inst = deps.registry.get(target)
        if inst:
            inst._was_triggered = True  # type: ignore[attr-defined]

        queue_file = deps.DATA_DIR / f"{target}_queue.jsonl"
        try:
            _append_jsonl_locked(queue_file, {"channel": channel})
            log.info("[routing] queued target=%s queue_file=%s", target, queue_file)
        except Exception as e:
            log.warning("Queue write failed for %s: %s", target, e)

    if mentions and not targets:
        log.info("[routing] mentions_present_but_no_targets sender=%s channel=%s mentions=%s agent_names=%s", sender, channel, mentions, agent_names)
