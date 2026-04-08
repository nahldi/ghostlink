"""Agent Memory System — persistent per-agent memory stored as JSON files.

Each agent gets its own directory under data/agents/{agent_id}/memory/
with individual JSON files for each memory key.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")
_MEMORY_LAYERS = ("identity", "workspace", "session")
_LAYER_WEIGHTS = {"identity": 2.0, "workspace": 1.5, "session": 1.0}
_DEFAULT_RECALL_WEIGHTS = {"recency": 0.4, "frequency": 0.3, "importance": 0.3}
_CONFLICT_MARKERS = (
    ("always", "never"),
    ("should", "should not"),
    ("must", "must not"),
    ("enabled", "disabled"),
    ("allow", "deny"),
)


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


def resolve_agent_dir(data_dir: Path, agent_identifier: str) -> Path:
    canonical_dir, legacy_dirs = _resolve_agent_dirs(data_dir, agent_identifier)
    canonical_dir.mkdir(parents=True, exist_ok=True)
    for legacy_dir in legacy_dirs:
        if not legacy_dir.exists():
            continue
        legacy_soul = legacy_dir / "soul.txt"
        legacy_notes = legacy_dir / "notes.txt"
        if legacy_soul.exists() and not (canonical_dir / "SOUL.md").exists():
            soul_content = legacy_soul.read_text("utf-8")
            (canonical_dir / "SOUL.md").write_text(soul_content, "utf-8")
            (canonical_dir / "soul.txt").write_text(soul_content, "utf-8")
            legacy_soul.unlink(missing_ok=True)
        if legacy_notes.exists() and not (canonical_dir / "NOTES.md").exists():
            notes_content = legacy_notes.read_text("utf-8")
            (canonical_dir / "NOTES.md").write_text(notes_content, "utf-8")
            (canonical_dir / "notes.txt").write_text(notes_content, "utf-8")
            legacy_notes.unlink(missing_ok=True)
        _cleanup_legacy_agent_dir(legacy_dir)
    return canonical_dir


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
        self.identity_dir = self.memory_dir / "identity"
        self.workspace_dir = self.memory_dir / "workspace"
        self.session_dir = self.memory_dir / "session"
        for layer_dir in (self.identity_dir, self.workspace_dir, self.session_dir):
            layer_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._migrate_legacy_memory_dir()

    def _migrate_legacy_memory_dir(self) -> None:
        for legacy_file in self.memory_dir.glob("*.json"):
            target = self.workspace_dir / legacy_file.name
            if not target.exists():
                target.write_bytes(legacy_file.read_bytes())
            legacy_file.unlink(missing_ok=True)
        for legacy_agent_dir in self._legacy_agent_dirs:
            legacy_memory_dir = legacy_agent_dir / "memory"
            if not legacy_memory_dir.is_dir():
                continue
            for legacy_file in legacy_memory_dir.glob("*.json"):
                target = self.workspace_dir / legacy_file.name
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

    def _layer_dir(self, layer: str) -> Path:
        normalized = layer if layer in _MEMORY_LAYERS else "workspace"
        return {
            "identity": self.identity_dir,
            "workspace": self.workspace_dir,
            "session": self.session_dir,
        }[normalized]

    def _key_filename(self, key: str) -> str:
        safe_key = self._sanitize_key(key)
        if safe_key != key:
            import hashlib

            suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
            safe_key = f"{safe_key}_{suffix}"
        return f"{safe_key}.json"

    def _key_path(self, key: str, layer: str = "workspace") -> Path:
        return self._layer_dir(layer) / self._key_filename(key)

    def _legacy_key_path(self, key: str) -> Path:
        return self.memory_dir / f"{self._sanitize_key(key)}.json"

    def _resolve_key_path(self, key: str) -> Path:
        for layer in _MEMORY_LAYERS:
            new_path = self._key_path(key, layer)
            if new_path.exists():
                return new_path
        legacy = self._legacy_key_path(key)
        if legacy.exists():
            return legacy
        return self._key_path(key, "workspace")

    def _iter_entry_paths(self) -> list[Path]:
        paths: list[Path] = []
        for layer in _MEMORY_LAYERS:
            paths.extend(sorted(self._layer_dir(layer).glob("*.json")))
        return paths

    @staticmethod
    def _estimate_tokens(content: str) -> int:
        return max(1, math.ceil(len(content.split()) * 1.3)) if content.strip() else 0

    @staticmethod
    def _recency_score(last_accessed: float, now: float) -> float:
        hours = max(0.0, (now - last_accessed) / 3600.0)
        return math.exp(-0.01 * hours)

    @staticmethod
    def _frequency_score(access_count: int, max_access_count: int) -> float:
        if max_access_count <= 0:
            return 0.0
        return math.log(1 + max(0, access_count)) / math.log(1 + max_access_count)

    @staticmethod
    def _importance_score(importance: float) -> float:
        return max(0.0, min(1.0, float(importance)))

    @staticmethod
    def _relevance_boost(query: str, key: str, content: str) -> float:
        boost = 0.0
        query_lower = query.lower().strip()
        if not query_lower:
            return boost
        words = [word.lower() for word in query_lower.split() if len(word) >= 2]
        key_lower = key.lower()
        content_lower = content.lower()
        if query_lower in key_lower:
            boost += 0.5
        for word in words:
            if word in key_lower:
                boost += 0.2
            boost += min(0.5, content_lower.count(word) * 0.05)
        return boost

    def _normalize_entry(self, entry: dict, *, layer: str = "workspace") -> dict:
        normalized_layer = entry.get("layer") if entry.get("layer") in _MEMORY_LAYERS else layer
        created_at = float(entry.get("created_at") or time.time())
        updated_at = float(entry.get("updated_at") or created_at)
        content = str(entry.get("content") or "")
        return {
            "key": str(entry.get("key") or ""),
            "content": content,
            "agent": self.agent_name,
            "layer": normalized_layer,
            "created_at": created_at,
            "updated_at": updated_at,
            "last_accessed": float(entry.get("last_accessed") or updated_at),
            "access_count": int(entry.get("access_count") or (1 if content else 0)),
            "importance": float(entry.get("importance", 1.0 if normalized_layer == "identity" else 0.5)),
            "tags": list(entry.get("tags") or []),
            "source_agent_id": entry.get("source_agent_id"),
            "source_session_id": entry.get("source_session_id"),
            "promoted": bool(entry.get("promoted", False)),
            "promoted_at": entry.get("promoted_at"),
            "evictable": bool(entry.get("evictable", normalized_layer != "identity")),
            "size_tokens": int(entry.get("size_tokens") or self._estimate_tokens(content)),
        }

    def _sync_graph_entry(self, entry: dict) -> None:
        try:
            import deps

            if deps.memory_graph is not None:
                tags = sorted(set(list(entry.get("tags", [])) + [entry.get("layer", "workspace")]))
                deps.memory_graph.add(self.agent_name, entry["key"], entry["content"], tags=tags)
        except Exception:
            log.debug("MemoryGraph sync failed for %s:%s", self.agent_name, entry.get("key", ""), exc_info=True)

    def _detect_conflicts(self, entry: dict) -> list[dict]:
        conflicts: list[dict] = []
        entry_tags = {str(tag).lower() for tag in entry.get("tags", [])}
        if not entry_tags:
            return conflicts
        entry_content = str(entry.get("content", "")).lower()
        data_root = self.agent_dir.parent
        if not data_root.exists():
            return conflicts
        for other_agent_dir in data_root.iterdir():
            if not other_agent_dir.is_dir() or other_agent_dir == self.agent_dir:
                continue
            memory_dir = other_agent_dir / "memory"
            if not memory_dir.exists():
                continue
            for file_path in memory_dir.rglob("*.json"):
                try:
                    other = self._normalize_entry(json.loads(file_path.read_text("utf-8")))
                except Exception:
                    continue
                other_tags = {str(tag).lower() for tag in other.get("tags", [])}
                if entry_tags.isdisjoint(other_tags):
                    continue
                other_content = str(other.get("content", "")).lower()
                if not self._content_conflicts(entry_content, other_content):
                    continue
                conflicts.append(
                    {
                        "agent_id": other_agent_dir.name,
                        "key": other.get("key", file_path.stem),
                        "layer": other.get("layer", "workspace"),
                        "tags": other.get("tags", []),
                    }
                )
        return conflicts

    @staticmethod
    def _content_conflicts(left: str, right: str) -> bool:
        for positive, negative in _CONFLICT_MARKERS:
            left_pos = positive in left
            left_neg = negative in left
            right_pos = positive in right
            right_neg = negative in right
            if (left_pos and right_neg) or (left_neg and right_pos):
                return True
        return False

    def _emit_memory_conflict_if_needed(self, key: str, entry: dict) -> None:
        conflicts = self._detect_conflicts(entry)
        if not conflicts:
            return
        try:
            from plugin_sdk import event_bus

            event_bus.emit(
                "memory_conflict",
                {
                    "agent_id": self.agent_name,
                    "key": key,
                    "layer": entry.get("layer", "workspace"),
                    "tags": list(entry.get("tags", [])),
                    "conflicts": conflicts,
                },
            )
        except Exception:
            log.debug("memory_conflict event emit failed for %s:%s", self.agent_name, key, exc_info=True)

    def save(
        self,
        key: str,
        content: str,
        *,
        layer: str = "workspace",
        tags: list[str] | None = None,
        importance: float | None = None,
        source_agent_id: str | None = None,
        source_session_id: str | None = None,
        promoted: bool = False,
    ) -> dict:
        now = time.time()
        entry = self._normalize_entry(
            {
                "key": key,
                "content": content,
                "layer": layer,
                "created_at": now,
                "updated_at": now,
                "last_accessed": now,
                "access_count": 1,
                "importance": importance if importance is not None else (1.0 if layer == "identity" else 0.5),
                "tags": tags or [],
                "source_agent_id": source_agent_id,
                "source_session_id": source_session_id,
                "promoted": promoted,
                "promoted_at": now if promoted else None,
                "evictable": layer != "identity",
            },
            layer=layer,
        )
        path = self._key_path(key, entry["layer"])
        with self._lock:
            source = self._resolve_key_path(key)
            if source:
                try:
                    existing = self._normalize_entry(json.loads(source.read_text("utf-8")), layer=entry["layer"])
                    entry["created_at"] = existing.get("created_at", entry["created_at"])
                    entry["access_count"] = max(existing.get("access_count", 0), entry["access_count"])
                except Exception:
                    log.warning("Corrupt memory file during migration: %s", source, exc_info=True)
                if source != path:
                    source.unlink(missing_ok=True)
            path.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
        self._sync_graph_entry(entry)
        try:
            from plugin_sdk import event_bus

            event_bus.emit(
                "memory_written",
                {
                    "agent_id": self.agent_name,
                    "key": key,
                    "layer": entry["layer"],
                    "tags": list(entry.get("tags", [])),
                },
            )
        except Exception:
            log.debug("memory_written event emit failed for %s:%s", self.agent_name, key, exc_info=True)
        self._emit_memory_conflict_if_needed(key, entry)
        return {"key": key, "status": "saved", "path": str(path), "layer": entry["layer"]}

    def load(self, key: str) -> dict | None:
        with self._lock:
            path = self._resolve_key_path(key)
            if not path.exists():
                return None
            try:
                entry = self._normalize_entry(json.loads(path.read_text("utf-8")))
                entry["access_count"] = int(entry.get("access_count", 0)) + 1
                entry["last_accessed"] = time.time()
                path.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
                return entry
            except Exception:
                log.warning("Failed to read memory key '%s' from %s", key, path, exc_info=True)
                return None

    def list_all(self) -> list[dict]:
        entries = []
        with self._lock:
            if not self.memory_dir.exists():
                return entries
            for file_path in self._iter_entry_paths():
                try:
                    data = self._normalize_entry(json.loads(file_path.read_text("utf-8")))
                    entries.append(
                        {
                            "key": data.get("key", file_path.stem),
                            "layer": data.get("layer", "workspace"),
                            "updated_at": data.get("updated_at", 0),
                            "created_at": data.get("created_at", 0),
                            "size": len(data.get("content", "")),
                            "importance": data.get("importance", 0.5),
                        }
                    )
                except Exception:
                    log.warning("Corrupt memory file: %s", file_path, exc_info=True)
                    entries.append({"key": file_path.stem, "error": "corrupt"})
        return entries

    def search(
        self,
        query: str,
        *,
        layers: list[str] | None = None,
        tags: list[str] | None = None,
        limit: int = 10,
        weights: dict[str, float] | None = None,
    ) -> list[dict]:
        words = [word.lower() for word in query.lower().split() if len(word) >= 2]
        if not words:
            return []
        allowed_layers = set(layers or _MEMORY_LAYERS)
        required_tags = {tag.lower() for tag in (tags or []) if tag}
        results = []
        weighted_entries: list[dict] = []
        with self._lock:
            if not self.memory_dir.exists():
                return results
            max_access_count = 0
            for file_path in self._iter_entry_paths():
                try:
                    data = self._normalize_entry(json.loads(file_path.read_text("utf-8")))
                    weighted_entries.append(data)
                    max_access_count = max(max_access_count, int(data.get("access_count", 0) or 0))
                except Exception:
                    log.debug("Skipping corrupt memory file during search: %s", file_path)
            now = time.time()
            scoring_weights = {**_DEFAULT_RECALL_WEIGHTS, **(weights or {})}
            for data in weighted_entries:
                try:
                    if data.get("layer", "workspace") not in allowed_layers:
                        continue
                    entry_tags = {str(tag).lower() for tag in data.get("tags", [])}
                    if required_tags and entry_tags.isdisjoint(required_tags):
                        continue
                    key = data.get("key", "")
                    content = data.get("content", "")
                    if not key and not content:
                        continue
                    relevance_boost = self._relevance_boost(query, key, content)
                    if relevance_boost <= 0:
                        continue
                    score = (
                        scoring_weights["recency"] * self._recency_score(float(data.get("last_accessed", data.get("updated_at", now)) or now), now)
                        + scoring_weights["frequency"] * self._frequency_score(int(data.get("access_count", 0) or 0), max_access_count)
                        + scoring_weights["importance"] * self._importance_score(float(data.get("importance", 0.5) or 0.5))
                    )
                    score = round(score + relevance_boost, 4)
                    preview = content[:200] + ("..." if len(content) > 200 else "")
                    results.append(
                        {
                            "key": key,
                            "layer": data.get("layer", "workspace"),
                            "preview": preview,
                            "updated_at": data.get("updated_at", 0),
                            "score": score,
                            "source": "memory",
                            "tags": data.get("tags", []),
                            "importance": data.get("importance", 0.5),
                            "access_count": data.get("access_count", 0),
                            "last_accessed": data.get("last_accessed", data.get("updated_at", 0)),
                        }
                    )
                except Exception:
                    log.debug("Skipping corrupt memory file during search: %s", file_path)
        try:
            import deps

            if deps.memory_graph is not None:
                for item in deps.memory_graph.search(query, agent=self.agent_name, limit=3):
                    results.append(
                        {
                            "key": item.get("key", ""),
                            "layer": "workspace",
                            "preview": item.get("content", ""),
                            "updated_at": time.time(),
                            "score": round(float(item.get("score", 0.0)) * 10, 4),
                            "connections": item.get("connections", []),
                            "source": "graph",
                            "tags": item.get("tags", []),
                        }
                    )
        except Exception:
            log.debug("MemoryGraph search failed for %s", self.agent_name, exc_info=True)
        try:
            import deps

            if deps.rag_pipeline is not None:
                for item in deps.rag_pipeline.search(query, limit=min(limit, 3)):
                    results.append(
                        {
                            "key": f"doc:{item.get('filename', 'unknown')}",
                            "layer": "workspace",
                            "preview": item.get("text", "")[:200],
                            "updated_at": time.time(),
                            "score": round(float(item.get("score", 0.0)) * 10, 4),
                            "source": "rag",
                            "tags": ["rag", item.get("channel", "")],
                        }
                    )
        except Exception:
            log.debug("RAG search failed for %s", self.agent_name, exc_info=True)
        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:limit]

    def delete(self, key: str) -> bool:
        with self._lock:
            deleted = False
            for layer in _MEMORY_LAYERS:
                path = self._key_path(key, layer)
                if path.exists():
                    path.unlink()
                    deleted = True
            legacy = self._legacy_key_path(key)
            if legacy.exists():
                legacy.unlink()
                deleted = True
        return deleted

    def promote(self, key: str, *, target_layer: str = "workspace") -> dict | None:
        normalized_target = target_layer if target_layer in _MEMORY_LAYERS else "workspace"
        with self._lock:
            source = self._resolve_key_path(key)
            if not source.exists():
                return None
            try:
                entry = self._normalize_entry(json.loads(source.read_text("utf-8")), layer=normalized_target)
            except Exception:
                log.warning("Failed to promote corrupt memory key '%s' from %s", key, source, exc_info=True)
                return None
            now = time.time()
            entry["layer"] = normalized_target
            entry["promoted"] = True
            entry["promoted_at"] = now
            entry["updated_at"] = now
            tags = {str(tag) for tag in entry.get("tags", []) if tag}
            tags.add("promoted")
            entry["tags"] = sorted(tags)
            target = self._key_path(key, normalized_target)
            if source != target:
                source.unlink(missing_ok=True)
            target.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
        self._sync_graph_entry(entry)
        try:
            from plugin_sdk import event_bus

            event_bus.emit(
                "memory_promoted",
                {
                    "agent_id": self.agent_name,
                    "key": key,
                    "from_layer": source.parent.name if source.parent != self.memory_dir else "workspace",
                    "to_layer": normalized_target,
                    "tags": list(entry.get("tags", [])),
                },
            )
        except Exception:
            log.debug("memory_promoted event emit failed for %s:%s", self.agent_name, key, exc_info=True)
        self._emit_memory_conflict_if_needed(key, entry)
        return entry


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
        for file_path in sorted(memory_dir.rglob("*.json")):
            try:
                data = json.loads(file_path.read_text("utf-8"))
                layer = data.get("layer") or (file_path.parent.name if file_path.parent != memory_dir else "workspace")
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
                            "layer": layer,
                            "preview": preview,
                            "updated_at": data.get("updated_at", 0),
                            "source": "memory",
                        }
                    )
            except Exception:
                log.debug("Skipping corrupt memory file during cross-agent search: %s", file_path)
    try:
        import deps

        if deps.rag_pipeline is not None:
            for item in deps.rag_pipeline.search(query, limit=min(limit, 5)):
                results.append(
                    {
                        "agent": "workspace",
                        "key": f"doc:{item.get('filename', 'unknown')}",
                        "layer": "workspace",
                        "preview": item.get("text", "")[:200],
                        "updated_at": time.time(),
                        "source": "rag",
                    }
                )
    except Exception:
        log.debug("Skipping RAG results during cross-agent search", exc_info=True)
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
        mem = get_agent_memory(data_dir, agent_name)
        identity_entry = mem.load("core_identity")
        if identity_entry and identity_entry.get("content"):
            return str(identity_entry["content"]).strip()
        canonical_dir = resolve_agent_dir(data_dir, agent_name)
        soul_md = canonical_dir / "SOUL.md"
        if soul_md.exists():
            content = soul_md.read_text("utf-8").strip()
            mem.save("core_identity", content, layer="identity", tags=["identity", "core"], importance=1.0)
            return content
        content = _read_text_with_migration(data_dir, agent_name, "soul.txt")
        if content is not None:
            soul_md.write_text(content, "utf-8")
            mem.save("core_identity", content, layer="identity", tags=["identity", "core"], importance=1.0)
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
    canonical_dir = resolve_agent_dir(data_dir, agent_name)
    canonical = soul.strip()
    (canonical_dir / "SOUL.md").write_text(canonical, "utf-8")
    _write_agent_text(data_dir, agent_name, "soul.txt", canonical)
    get_agent_memory(data_dir, agent_name).save(
        "core_identity",
        canonical,
        layer="identity",
        tags=["identity", "core"],
        importance=1.0,
    )
    return canonical


def get_notes(data_dir: Path, agent_name: str) -> str:
    agent_name = _sanitize_agent_name(agent_name)
    try:
        canonical_dir = resolve_agent_dir(data_dir, agent_name)
        notes_md = canonical_dir / "NOTES.md"
        if notes_md.exists():
            return notes_md.read_text("utf-8")
        content = _read_text_with_migration(data_dir, agent_name, "notes.txt")
        if content is not None:
            notes_md.write_text(content, "utf-8")
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
    canonical_dir = resolve_agent_dir(data_dir, agent_name)
    (canonical_dir / "NOTES.md").write_text(content, "utf-8")
    return _write_agent_text(data_dir, agent_name, "notes.txt", content)
