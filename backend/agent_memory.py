"""Agent Memory System — persistent per-agent memory stored as JSON files.

Each agent gets its own directory under data/{agent_name}/memory/
with individual JSON files for each memory key.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path

_SAFE_NAME = re.compile(r'^[a-zA-Z0-9_-]{1,50}$')


def _sanitize_agent_name(name: str) -> str:
    """Ensure agent name is safe for filesystem use."""
    if not _SAFE_NAME.match(name):
        raise ValueError(f"Invalid agent name: {name!r}")
    return name


class AgentMemory:
    """Persistent memory store for a single agent."""

    def __init__(self, data_dir: Path, agent_name: str):
        self.agent_name = _sanitize_agent_name(agent_name)
        self.memory_dir = data_dir / self.agent_name / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

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
        with self._lock:
            # Preserve created_at if updating
            if path.exists():
                try:
                    existing = json.loads(path.read_text("utf-8"))
                    entry["created_at"] = existing.get("created_at", entry["created_at"])
                except Exception:
                    pass  # Corrupt file — use new created_at
            path.write_text(json.dumps(entry, indent=2, ensure_ascii=False), "utf-8")
        return {"key": key, "status": "saved", "path": str(path)}

    def load(self, key: str) -> dict | None:
        """Load a memory entry by key. Returns None if not found."""
        path = self._key_path(key)
        with self._lock:
            if not path.exists():
                return None
            try:
                return json.loads(path.read_text("utf-8"))
            except Exception:
                return None

    def list_all(self) -> list[dict]:
        """List all memory keys with metadata (no content)."""
        entries = []
        with self._lock:
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
        """Search memories by keyword with relevance scoring.

        Splits query into words, scores each memory by:
        - Key exact match: +10 points
        - Key word match: +5 per word
        - Content word match: +1 per occurrence
        Results sorted by relevance (highest first).
        """
        words = [w.lower() for w in query.lower().split() if len(w) >= 2]
        if not words:
            return []
        results = []
        with self._lock:
            if not self.memory_dir.exists():
                return results
            for f in sorted(self.memory_dir.glob("*.json")):
                try:
                    data = json.loads(f.read_text("utf-8"))
                    key = data.get("key", f.stem)
                    content = data.get("content", "")
                    key_lower = key.lower()
                    content_lower = content.lower()
                    score = 0
                    # Exact query match in key
                    if query.lower() in key_lower:
                        score += 10
                    # Per-word scoring
                    for w in words:
                        if w in key_lower:
                            score += 5
                        score += content_lower.count(w)
                    if score > 0:
                        preview = content[:200] + ("..." if len(content) > 200 else "")
                        results.append({
                            "key": key,
                            "preview": preview,
                            "updated_at": data.get("updated_at", 0),
                            "score": score,
                        })
                except Exception:
                    pass
        results.sort(key=lambda r: r["score"], reverse=True)
        return results

    def delete(self, key: str) -> bool:
        """Delete a memory entry. Returns True if deleted."""
        path = self._key_path(key)
        with self._lock:
            if path.exists():
                path.unlink()
                return True
        return False


# ── Module-level helpers for multi-agent use ─────────────────────

_memory_cache: dict[str, tuple[AgentMemory, float]] = {}
_MEMORY_CACHE_TTL = 300.0  # 5 minutes


def search_all_memories(data_dir: Path, query: str, limit: int = 20) -> list[dict]:
    """Search across ALL agents' memories for a keyword (cross-session recall).

    Returns results from all agents, sorted by relevance (updated_at descending).
    """
    query_lower = query.lower()
    results: list[dict] = []
    agents_dir = data_dir
    if not agents_dir.exists():
        return results
    for agent_dir in sorted(agents_dir.iterdir()):
        memory_dir = agent_dir / "memory"
        if not agent_dir.is_dir() or not memory_dir.exists():
            continue
        agent_name = agent_dir.name
        for f in sorted(memory_dir.glob("*.json")):
            try:
                data = json.loads(f.read_text("utf-8"))
                key = data.get("key", f.stem)
                content = data.get("content", "")
                if query_lower in key.lower() or query_lower in content.lower():
                    preview = content[:200] + ("..." if len(content) > 200 else "")
                    results.append({
                        "agent": agent_name,
                        "key": key,
                        "preview": preview,
                        "updated_at": data.get("updated_at", 0),
                    })
            except Exception:
                pass
    # Sort by most recently updated first
    results.sort(key=lambda r: r.get("updated_at", 0), reverse=True)
    return results[:limit]


def get_agent_memory(data_dir: Path, agent_name: str) -> AgentMemory:
    """Get or create an AgentMemory instance for the given agent (cached with TTL)."""
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


# ── Soul (identity/personality) helpers ──────────────────────────

_DEFAULT_SOUL = (
    "You are {name}, an AI agent in GhostLink. "
    "You collaborate with other agents via @mentions. "
    "Be helpful, thorough, and proactive."
)

# v2.5.0: Comprehensive context file content for agent spawn
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
    """Generate a comprehensive context file for an agent."""
    if not soul:
        soul = _DEFAULT_SOUL.format(name=agent_name)
    return GHOSTLINK_CONTEXT_TEMPLATE.format(agent_name=agent_name, soul=soul)


def get_soul(data_dir: Path, agent_name: str) -> str:
    """Load the agent's soul/identity prompt."""
    agent_name = _sanitize_agent_name(agent_name)
    soul_path = data_dir / agent_name / "soul.txt"
    if soul_path.exists():
        try:
            return soul_path.read_text("utf-8").strip()
        except Exception:
            pass
    return _DEFAULT_SOUL.format(name=agent_name)


def set_soul(data_dir: Path, agent_name: str, soul: str) -> str:
    """Save the agent's soul/identity prompt."""
    agent_name = _sanitize_agent_name(agent_name)
    agent_dir = data_dir / agent_name
    agent_dir.mkdir(parents=True, exist_ok=True)
    soul_path = agent_dir / "soul.txt"
    soul_path.write_text(soul.strip(), "utf-8")
    return soul.strip()


# ── Notes/Scratch Pad helpers ────────────────────────────────────

def get_notes(data_dir: Path, agent_name: str) -> str:
    """Load the agent's working notes."""
    agent_name = _sanitize_agent_name(agent_name)
    notes_path = data_dir / agent_name / "notes.txt"
    if notes_path.exists():
        try:
            return notes_path.read_text("utf-8")
        except Exception:
            pass
    return ""


def set_notes(data_dir: Path, agent_name: str, content: str) -> str:
    """Save the agent's working notes."""
    agent_name = _sanitize_agent_name(agent_name)
    agent_dir = data_dir / agent_name
    agent_dir.mkdir(parents=True, exist_ok=True)
    notes_path = agent_dir / "notes.txt"
    notes_path.write_text(content, "utf-8")
    return content
