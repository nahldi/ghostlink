from __future__ import annotations

import time
from pathlib import Path

from agent_memory import get_agent_memory
from plugin_sdk import event_bus


class ObservationEngine:
    """Passive observer for low-risk workspace patterns."""

    def __init__(self, data_dir: Path, *, threshold: int = 3):
        self._data_dir = Path(data_dir)
        self._threshold = max(1, int(threshold))
        self._tool_counts: dict[tuple[str, str], int] = {}
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        event_bus.on("post_tool_use", self._on_post_tool_use)
        self._started = True

    def stop(self) -> None:
        if not self._started:
            return
        event_bus.off("post_tool_use", self._on_post_tool_use)
        self._started = False

    def _on_post_tool_use(self, data: dict) -> None:
        agent = str(data.get("agent", "")).strip()
        tool = str(data.get("tool", "")).strip()
        if not agent or not tool:
            return
        key = (agent, tool)
        count = self._tool_counts.get(key, 0) + 1
        self._tool_counts[key] = count
        if count < self._threshold:
            return

        mem = get_agent_memory(self._data_dir, agent)
        memory_key = f"obs_tool_preference_{tool}"
        content = (
            f"Agent '{agent}' uses {tool} frequently "
            f"(observed {count} times). Confidence: {self._confidence(count):.2f}"
        )
        mem.save(
            memory_key,
            content,
            layer="workspace",
            tags=["observational", "tool_preference"],
            importance=0.3,
            source_agent_id=agent,
            promoted=False,
        )

    @staticmethod
    def _confidence(count: int) -> float:
        confidence = 0.0
        for _ in range(max(0, count)):
            confidence = min(1.0, confidence + 0.1 * (1 - confidence))
        return confidence
