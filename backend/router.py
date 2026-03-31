"""Message router with @mention parsing, loop guard, and smart auto-routing."""

from __future__ import annotations

import re
import threading
import time


def parse_mentions(text: str) -> list[str]:
    return re.findall(r"@(\w[\w-]*)", text)


# Keyword-based agent classification for smart routing
_AGENT_KEYWORDS: dict[str, list[str]] = {
    "claude": ["review", "analyze", "explain", "architecture", "design", "plan", "think", "reason", "complex", "refactor"],
    "codex": ["code", "implement", "build", "fix", "debug", "test", "function", "class", "api", "endpoint", "write"],
    "gemini": ["research", "search", "find", "compare", "summarize", "document", "learn", "explore", "data"],
    "grok": ["creative", "brainstorm", "idea", "suggest", "alternative", "opinion"],
    "aider": ["edit", "change", "modify", "update", "patch", "commit", "git"],
    "opencode": ["code", "terminal", "shell", "command", "run", "execute", "script"],
}


def classify_message(text: str, agent_names: list[str]) -> str | None:
    """Classify a message and return the best-fit agent name, or None if no match."""
    text_lower = text.lower()
    scores: dict[str, int] = {}

    for agent_base, keywords in _AGENT_KEYWORDS.items():
        # Find agents whose base matches this keyword set
        matching_agents = [n for n in agent_names if n.startswith(agent_base)]
        if not matching_agents:
            continue
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            scores[matching_agents[0]] = score

    if not scores:
        return None

    # Return the agent with the highest score
    return max(scores, key=scores.get)  # type: ignore


class MessageRouter:
    def __init__(self, max_hops: int = 4, default_routing: str = "none"):
        self.max_hops = max_hops
        self.default_routing = default_routing
        self._hop_counts: dict[str, int] = {}  # channel -> hop count
        self._last_activity: dict[str, float] = {}
        self._hop_reset_after = 120.0
        self._lock = threading.Lock()

    def get_targets(
        self, sender: str, text: str, channel: str, agent_names: list[str]
    ) -> list[str]:
        mentions = parse_mentions(text)

        if "all" in mentions:
            targets = [n for n in agent_names if n != sender]
        elif mentions:
            targets = [m for m in mentions if m in agent_names and m != sender]
        elif self.default_routing == "all":
            targets = [n for n in agent_names if n != sender]
        elif self.default_routing == "smart":
            best = classify_message(text, [n for n in agent_names if n != sender])
            targets = [best] if best else []
        else:
            targets = []

        # Loop guard: track agent-to-agent hops per channel
        now = time.time()
        with self._lock:
            last_activity = self._last_activity.get(channel)
            if last_activity is not None and now - last_activity > self._hop_reset_after:
                self._hop_counts.pop(channel, None)

            if sender in agent_names and targets:
                count = self._hop_counts.get(channel, 0) + 1
                if count > self.max_hops:
                    self._last_activity[channel] = now
                    return []
                self._hop_counts[channel] = count
            else:
                # Human message resets the hop counter
                self._hop_counts[channel] = 0

            self._last_activity[channel] = now

        return targets

    def reset_channel(self, channel: str):
        with self._lock:
            self._hop_counts.pop(channel, None)
            self._last_activity.pop(channel, None)
