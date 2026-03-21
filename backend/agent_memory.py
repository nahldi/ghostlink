"""Agent Memory System — persistent per-agent memory stored as JSON files.

Each agent gets its own directory under data/{agent_name}/memory/
with individual JSON files for each memory key.
"""

from __future__ import annotations

import json
import time
from pathlib import Path


class AgentMemory:
    """Persistent memory store for a single agent."""

    def __init__(self, data_dir: Path, agent_name: str):
        self.agent_name = agent_name
        self.memory_dir = data_dir / agent_name / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)

    def _key_path(self, key: str) -> Path:
        """Get the file path for a memory key (sanitized)."""
        safe_key = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
        if not safe_key:
            safe_key = "_unnamed"
        return self.memory_dir / f"{safe_key}.json"

    def save(self, key: str, content: str) -> dict:
        """Save a memory entry. Returns metadata about the saved entry."""
        path = self._key_path(key)
        entry = {
            "key": key,
            "content": content,
            "agent": self.agent_name,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        # Preserve created_at if updating
        if path.exists():
            try:
                existing = json.loads(path.read_text("utf-8"))
                entry["created_at"] = existing.get("created_at", entry["created_at"])
            except Exception:
                pass
        path.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
        return {"key": key, "status": "saved", "path": str(path)}

    def load(self, key: str) -> dict | None:
        """Load a memory entry by key. Returns None if not found."""
        path = self._key_path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text("utf-8"))
        except Exception:
            return None

    def list_all(self) -> list[dict]:
        """List all memory keys with metadata (no content)."""
        entries = []
        if not self.memory_dir.exists():
            return entries
        for f in sorted(self.memory_dir.glob("*.json")):
            try:
                data = json.loads(f.read_text("utf-8"))
                entries.append({
                    "key": data.get("key", f.stem),
                    "updated_at": data.get("updated_at", 0),
                    "created_at": data.get("created_at", 0),
                    "size": len(data.get("content", "")),
                })
            except Exception:
                entries.append({"key": f.stem, "error": "corrupt"})
        return entries

    def search(self, query: str) -> list[dict]:
        """Search memories by keyword (case-insensitive substring match)."""
        query_lower = query.lower()
        results = []
        if not self.memory_dir.exists():
            return results
        for f in sorted(self.memory_dir.glob("*.json")):
            try:
                data = json.loads(f.read_text("utf-8"))
                key = data.get("key", f.stem)
                content = data.get("content", "")
                if query_lower in key.lower() or query_lower in content.lower():
                    # Return a preview, not the full content
                    preview = content[:200] + ("..." if len(content) > 200 else "")
                    results.append({
                        "key": key,
                        "preview": preview,
                        "updated_at": data.get("updated_at", 0),
                    })
            except Exception:
                pass
        return results

    def delete(self, key: str) -> bool:
        """Delete a memory entry. Returns True if deleted."""
        path = self._key_path(key)
        if path.exists():
            path.unlink()
            return True
        return False


# ── Module-level helpers for multi-agent use ─────────────────────

_memory_cache: dict[str, AgentMemory] = {}


def get_agent_memory(data_dir: Path, agent_name: str) -> AgentMemory:
    """Get or create an AgentMemory instance for the given agent."""
    cache_key = f"{data_dir}:{agent_name}"
    if cache_key not in _memory_cache:
        _memory_cache[cache_key] = AgentMemory(data_dir, agent_name)
    return _memory_cache[cache_key]


# ── Soul (identity/personality) helpers ──────────────────────────

_DEFAULT_SOUL = (
    "You are {name}, an AI agent in GhostLink. "
    "You collaborate with other agents via @mentions. "
    "Be helpful, thorough, and proactive."
)


def get_soul(data_dir: Path, agent_name: str) -> str:
    """Load the agent's soul/identity prompt."""
    soul_path = data_dir / agent_name / "soul.txt"
    if soul_path.exists():
        try:
            return soul_path.read_text("utf-8").strip()
        except Exception:
            pass
    return _DEFAULT_SOUL.format(name=agent_name)


def set_soul(data_dir: Path, agent_name: str, soul: str) -> str:
    """Save the agent's soul/identity prompt."""
    agent_dir = data_dir / agent_name
    agent_dir.mkdir(parents=True, exist_ok=True)
    soul_path = agent_dir / "soul.txt"
    soul_path.write_text(soul.strip(), "utf-8")
    return soul.strip()


# ── Notes/Scratch Pad helpers ────────────────────────────────────

def get_notes(data_dir: Path, agent_name: str) -> str:
    """Load the agent's working notes."""
    notes_path = data_dir / agent_name / "notes.txt"
    if notes_path.exists():
        try:
            return notes_path.read_text("utf-8")
        except Exception:
            pass
    return ""


def set_notes(data_dir: Path, agent_name: str, content: str) -> str:
    """Save the agent's working notes."""
    agent_dir = data_dir / agent_name
    agent_dir.mkdir(parents=True, exist_ok=True)
    notes_path = agent_dir / "notes.txt"
    notes_path.write_text(content, "utf-8")
    return content
