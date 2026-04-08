"""Agent Memory System — persistent per-agent memory stored as JSON files.

Each agent gets its own directory under data/agents/{agent_id}/memory/
with individual JSON files for each memory key.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")


def _sanitize_agent_name(name: str) -> str:
    if not _SAFE_NAME.match(name):
        raise ValueError(f"Invalid agent name: {name!r}")
    return name


def _resolve_registry_identity(identifier: str) -> tuple[str, str | None]:
    try:
        import deps

        inst = deps.registry.resolve(identifier) if deps.registry else None
    except Exception:
        inst = None

    if inst is None:
        return identifier, identifier
    return getattr(inst, "agent_id", identifier) or identifier, inst.name


def _resolve_agent_dirs(data_dir: Path, agent_identifier: str) -> tuple[Path, list[Path]]:
    base_dir = Path(data_dir)
    if base_dir.name == "agents":
        canonical_root = base_dir
        data_root = base_dir.parent
    else:
        canonical_root = base_dir / "agents"
        data_root = base_dir

    canonical_key, legacy_name = _resolve_registry_identity(agent_identifier)
    canonical_dir = canonical_root / canonical_key
    candidates: list[Path] = []

    if legacy_name and legacy_name != canonical_key:
        candidates.extend([canonical_root / legacy_name, data_root / legacy_name])
    elif legacy_name == canonical_key:
        candidates.append(data_root / legacy_name)
    if agent_identifier not in {canonical_key, legacy_name}:
        candidates.extend([canonical_root / agent_identifier, data_root / agent_identifier])

    legacy_dirs: list[Path] = []
    for candidate in candidates:
        if candidate == canonical_dir or candidate in legacy_dirs:
            continue
        legacy_dirs.append(candidate)
    return canonical_dir, legacy_dirs


def _cleanup_legacy_agent_dir(agent_dir: Path) -> None:
    try:
        if agent_dir.is_dir() and not any(agent_dir.iterdir()):
            agent_dir.rmdir()
    except OSError:
        pass


def _read_text_with_migration(data_dir: Path, agent_name: str, filename: str) -> str | None:
    canonical_dir, legacy_dirs = _resolve_agent_dirs(data_dir, agent_name)
    canonical_path = canonical_dir / filename
    if canonical_path.exists():
        return canonical_path.read_text("utf-8")

    for legacy_dir in legacy_dirs:
        legacy_path = legacy_dir / filename
        if not legacy_path.exists():
            continue
        canonical_dir.mkdir(parents=True, exist_ok=True)
        content = legacy_path.read_text("utf-8")
        canonical_path.write_text(content, "utf-8")
        legacy_path.unlink(missing_ok=True)
        _cleanup_legacy_agent_dir(legacy_dir)
        return content
    return None


def _write_agent_text(data_dir: Path, agent_name: str, filename: str, content: str) -> str:
    canonical_dir, legacy_dirs = _resolve_agent_dirs(data_dir, agent_name)
    canonical_dir.mkdir(parents=True, exist_ok=True)
    target_path = canonical_dir / filename
    target_path.write_text(content, "utf-8")
    for legacy_dir in legacy_dirs:
        legacy_path = legacy_dir / filename
        legacy_path.unlink(missing_ok=True)
        _cleanup_legacy_agent_dir(legacy_dir)
    return content


class AgentMemory:
    """Persistent memory store for a single agent."""

    def __init__(self, data_dir: Path, agent_name: str):
        self.agent_name = _sanitize_agent_name(agent_name)
        self.agent_dir, self._legacy_agent_dirs = _resolve_agent_dirs(data_dir, self.agent_name)
        self.memory_dir = self.agent_dir / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._migrate_legacy_memory_dir()

    def _migrate_legacy_memory_dir(self) -> None:
        for legacy_agent_dir in self._legacy_agent_dirs:
            legacy_memory_dir = legacy_agent_dir / "memory"
            if not legacy_memory_dir.is_dir():
                continue
            for legacy_file in legacy_memory_dir.glob("*.json"):
                target = self.memory_dir / legacy_file.name
                if not target.exists():
                    target.write_bytes(legacy_file.read_bytes())
                legacy_file.unlink(missing_ok=True)
            try:
                legacy_memory_dir.rmdir()
            except OSError:
                pass
            _cleanup_legacy_agent_dir(legacy_agent_dir)

    @staticmethod
    def _sanitize_key(key: str) -> str:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
        return safe or "_unnamed"

    def _key_path(self, key: str) -> Path:
        safe_key = self._sanitize_key(key)
        if safe_key != key:
            import hashlib

            suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
            safe_key = f"{safe_key}_{suffix}"
        return self.memory_dir / f"{safe_key}.json"

    def _legacy_key_path(self, key: str) -> Path:
        return self.memory_dir / f"{self._sanitize_key(key)}.json"

    def _resolve_key_path(self, key: str) -> Path:
        new_path = self._key_path(key)
        if new_path.exists():
            return new_path
        legacy = self._legacy_key_path(key)
        if legacy.exists():
            return legacy
        return new_path

    def save(self, key: str, content: str) -> dict:
        path = self._key_path(key)
        entry = {
            "key": key,
            "content": content,
            "agent": self.agent_name,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        with self._lock:
            legacy = self._legacy_key_path(key)
            source = path if path.exists() else (legacy if legacy != path and legacy.exists() else None)
            if source:
                try:
                    existing = json.loads(source.read_text("utf-8"))
                    entry["created_at"] = existing.get("created_at", entry["created_at"])
                except Exception:
                    log.warning("Corrupt memory file during migration: %s", source, exc_info=True)
                if source == legacy and legacy != path:
                    legacy.unlink(missing_ok=True)
            path.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
        return {"key": key, "status": "saved", "path": str(path)}

    def load(self, key: str) -> dict | None:
        with self._lock:
            path = self._resolve_key_path(key)
            if not path.exists():
                return None
            try:
                return json.loads(path.read_text("utf-8"))
            except Exception:
                log.warning("Failed to read memory key '%s' from %s", key, path, exc_info=True)
                return None

    def list_all(self) -> list[dict]:
        entries = []
        with self._lock:
            if not self.memory_dir.exists():
                return entries
            for file_path in sorted(self.memory_dir.glob("*.json")):
                try:
                    data = json.loads(file_path.read_text("utf-8"))
                    entries.append(
                        {
                            "key": data.get("key", file_path.stem),
                            "updated_at": data.get("updated_at", 0),
                            "created_at": data.get("created_at", 0),
                            "size": len(data.get("content", "")),
                        }
                    )
                except Exception:
                    log.warning("Corrupt memory file: %s", file_path, exc_info=True)
                    entries.append({"key": file_path.stem, "error": "corrupt"})
        return entries

    def search(self, query: str) -> list[dict]:
        words = [word.lower() for word in query.lower().split() if len(word) >= 2]
        if not words:
            return []
        results = []
        with self._lock:
            if not self.memory_dir.exists():
                return results
            for file_path in sorted(self.memory_dir.glob("*.json")):
                try:
                    data = json.loads(file_path.read_text("utf-8"))
                    key = data.get("key", file_path.stem)
                    content = data.get("content", "")
                    key_lower = key.lower()
                    content_lower = content.lower()
                    score = 10 if query.lower() in key_lower else 0
                    for word in words:
                        if word in key_lower:
                            score += 5
                        score += content_lower.count(word)
                    if score > 0:
                        preview = content[:200] + ("..." if len(content) > 200 else "")
                        results.append(
                            {
                                "key": key,
                                "preview": preview,
                                "updated_at": data.get("updated_at", 0),
                                "score": score,
                            }
                        )
                except Exception:
                    log.debug("Skipping corrupt memory file during search: %s", file_path)
        results.sort(key=lambda item: item["score"], reverse=True)
        return results

    def delete(self, key: str) -> bool:
        with self._lock:
            path = self._resolve_key_path(key)
            if path.exists():
                path.unlink()
                return True
        return False


_memory_cache: dict[str, tuple[AgentMemory, float]] = {}
_MEMORY_CACHE_TTL = 300.0


def search_all_memories(data_dir: Path, query: str, limit: int = 20) -> list[dict]:
    query_lower = query.lower()
    results: list[dict] = []
    canonical_agents_dir = data_dir / "agents" if Path(data_dir).name != "agents" else Path(data_dir)
    if not canonical_agents_dir.exists():
        return results

    for agent_dir in sorted(canonical_agents_dir.iterdir()):
        memory_dir = agent_dir / "memory"
        if not agent_dir.is_dir() or not memory_dir.exists():
            continue
        for file_path in sorted(memory_dir.glob("*.json")):
            try:
                data = json.loads(file_path.read_text("utf-8"))
                key = data.get("key", file_path.stem)
                content = data.get("content", "")
                if query_lower in key.lower() or query_lower in content.lower():
                    preview = content[:200] + ("..." if len(content) > 200 else "")
                    display_name = agent_dir.name
                    try:
                        import deps

                        inst = deps.registry.get_by_id(agent_dir.name) if deps.registry else None
                        if inst is not None:
                            display_name = inst.name
                    except Exception:
                        pass
                    results.append(
                        {
                            "agent": display_name,
                            "key": key,
                            "preview": preview,
                            "updated_at": data.get("updated_at", 0),
                        }
                    )
            except Exception:
                log.debug("Skipping corrupt memory file during cross-agent search: %s", file_path)
    results.sort(key=lambda item: item.get("updated_at", 0), reverse=True)
    return results[:limit]


def get_agent_memory(data_dir: Path, agent_name: str) -> AgentMemory:
    import time as _time

    cache_key = f"{data_dir}:{agent_name}"
    now = _time.monotonic()
    if cache_key in _memory_cache:
        mem, created = _memory_cache[cache_key]
        if now - created < _MEMORY_CACHE_TTL:
            return mem
    mem = AgentMemory(data_dir, agent_name)
    _memory_cache[cache_key] = (mem, now)
    return mem


_DEFAULT_SOUL = (
    "You are {name}, an AI agent in GhostLink. "
    "You collaborate with other agents via @mentions. "
    "Be helpful, thorough, and proactive."
)

GHOSTLINK_CONTEXT_TEMPLATE = """# GhostLink Agent Context

## Who You Are
{soul}
Your agent name (for chat_send sender field): **{agent_name}**

## What is GhostLink
GhostLink is a real-time chat application where multiple AI agents and human users collaborate together.
Think of it like a team chat app, but your teammates are other AI agents. You are NOT in Discord,
NOT in Slack, NOT in a terminal. You are in GhostLink's dedicated web-based chat interface.

## How Communication Works
- **You MUST use the `chat_send` MCP tool to send messages.** This is the ONLY way humans and other agents can see your responses.
- **Your terminal output is NOT visible to anyone.** Do NOT just print to stdout — nobody will see it.
- Use `chat_read` to read recent messages in a channel before responding.
- Use `chat_join` when you first start to announce your presence.
- Use @mentions to address specific agents (e.g., @claude, @codex) or @all for everyone.
- Channels: Messages are organized into channels (like #general, #backend, #frontend). Stay in the channel you were mentioned in.

## Your MCP Tools
You have access to these GhostLink tools via MCP:
- `chat_send` — Send a message to a channel (ALWAYS use this to respond)
- `chat_read` — Read recent messages from a channel
- `chat_join` — Announce you've connected
- `chat_who` — See who's online
- `chat_channels` — List available channels
- `chat_rules` — View or propose shared rules
- `chat_react` — React to a message with an emoji
- `memory_save/load/list/search` — Your personal persistent memory
- `web_search` — Search the web
- `web_fetch` — Fetch a URL
- `image_generate` — Generate images

## Important Rules
1. ALWAYS respond using `chat_send` — never just terminal output
2. Use your assigned name "{agent_name}" as the sender
3. Be conversational and helpful — this is a real-time chat, not a formal report
4. If you see @{agent_name} or @all in messages, that's someone talking to you — respond!
5. Keep responses concise for chat — save long outputs for when explicitly asked
6. Use `chat_who` to see who else is online — you can @mention other agents to collaborate
7. When you first connect, use `chat_join` to announce yourself, then `chat_who` to see your teammates
"""


def generate_agent_context(agent_name: str, soul: str = "") -> str:
    if not soul:
        soul = _DEFAULT_SOUL.format(name=agent_name)
    return GHOSTLINK_CONTEXT_TEMPLATE.format(agent_name=agent_name, soul=soul)


def get_soul(data_dir: Path, agent_name: str) -> str:
    agent_name = _sanitize_agent_name(agent_name)
    try:
        content = _read_text_with_migration(data_dir, agent_name, "soul.txt")
        if content is not None:
            return content.strip()
    except Exception:
        canonical_dir, _ = _resolve_agent_dirs(data_dir, agent_name)
        log.warning(
            "Failed to read soul file for %s: %s",
            agent_name,
            canonical_dir / "soul.txt",
            exc_info=True,
        )
    return _DEFAULT_SOUL.format(name=agent_name)


def set_soul(data_dir: Path, agent_name: str, soul: str) -> str:
    agent_name = _sanitize_agent_name(agent_name)
    return _write_agent_text(data_dir, agent_name, "soul.txt", soul.strip()).strip()


def get_notes(data_dir: Path, agent_name: str) -> str:
    agent_name = _sanitize_agent_name(agent_name)
    try:
        content = _read_text_with_migration(data_dir, agent_name, "notes.txt")
        if content is not None:
            return content
    except Exception:
        canonical_dir, _ = _resolve_agent_dirs(data_dir, agent_name)
        log.warning(
            "Failed to read notes for %s: %s",
            agent_name,
            canonical_dir / "notes.txt",
            exc_info=True,
        )
    return ""


def set_notes(data_dir: Path, agent_name: str, content: str) -> str:
    agent_name = _sanitize_agent_name(agent_name)
    return _write_agent_text(data_dir, agent_name, "notes.txt", content)
