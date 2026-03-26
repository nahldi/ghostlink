"""Agent Specialization Training — feedback-driven prompt evolution.

Agents learn from thumbs up/down reactions and explicit corrections.
System prompts evolve over time based on feedback patterns.

Flow:
1. User reacts with 👍/👎 or sends correction
2. Feedback stored with context (message, agent, channel)
3. Periodically analyze patterns → generate prompt adjustments
4. Agent soul/system prompt updated with learned preferences
"""

from __future__ import annotations

import json
import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class Feedback:
    """A single feedback entry."""
    agent: str
    message_text: str
    feedback_type: str  # "thumbs_up", "thumbs_down", "correction"
    correction_text: str = ""
    channel: str = "general"
    timestamp: float = field(default_factory=time.time)


class SpecializationEngine:
    """Learns from user feedback to evolve agent system prompts."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self._feedback: dict[str, list[Feedback]] = {}  # agent → feedback list
        self._adjustments: dict[str, list[str]] = {}  # agent → learned rules
        self._load()

    def record_feedback(
        self,
        agent: str,
        message_text: str,
        feedback_type: str,
        correction_text: str = "",
        channel: str = "general",
    ) -> dict:
        """Record feedback for an agent's response."""
        if feedback_type not in ("thumbs_up", "thumbs_down", "correction"):
            return {"error": f"Invalid feedback type: {feedback_type}"}

        fb = Feedback(
            agent=agent,
            message_text=message_text[:1000],
            feedback_type=feedback_type,
            correction_text=correction_text[:500],
            channel=channel,
        )

        if agent not in self._feedback:
            self._feedback[agent] = []
        self._feedback[agent].append(fb)

        # Keep last 200 feedback entries per agent
        if len(self._feedback[agent]) > 200:
            self._feedback[agent] = self._feedback[agent][-200:]

        self._save()

        # Auto-analyze if we have enough feedback
        count = len(self._feedback[agent])
        if count >= 5 and count % 5 == 0:
            self._analyze_patterns(agent)

        return {"ok": True, "total_feedback": count}

    def get_adjustments(self, agent: str) -> list[str]:
        """Get learned prompt adjustments for an agent."""
        return self._adjustments.get(agent, [])

    def get_soul_modifier(self, agent: str) -> str:
        """Get a soul/system prompt modifier based on learned adjustments."""
        adjustments = self._adjustments.get(agent, [])
        if not adjustments:
            return ""
        lines = ["", "## Learned Preferences (from user feedback)"]
        for adj in adjustments[-10:]:  # Last 10 adjustments
            lines.append(f"- {adj}")
        return "\n".join(lines)

    def get_stats(self, agent: str) -> dict:
        """Get feedback statistics for an agent."""
        entries = self._feedback.get(agent, [])
        types = Counter(f.feedback_type for f in entries)
        return {
            "agent": agent,
            "total_feedback": len(entries),
            "thumbs_up": types.get("thumbs_up", 0),
            "thumbs_down": types.get("thumbs_down", 0),
            "corrections": types.get("correction", 0),
            "adjustments": len(self._adjustments.get(agent, [])),
            "approval_rate": (
                types.get("thumbs_up", 0) / max(1, types.get("thumbs_up", 0) + types.get("thumbs_down", 0))
            ),
        }

    def _analyze_patterns(self, agent: str):
        """Analyze feedback patterns and generate prompt adjustments."""
        entries = self._feedback.get(agent, [])
        if len(entries) < 5:
            return

        # Analyze corrections for common themes
        corrections = [f for f in entries if f.feedback_type == "correction" and f.correction_text]
        if corrections:
            # Extract correction themes
            for corr in corrections[-5:]:
                rule = f"When asked similar questions, {corr.correction_text}"
                if agent not in self._adjustments:
                    self._adjustments[agent] = []
                if rule not in self._adjustments[agent]:
                    self._adjustments[agent].append(rule)

        # Analyze thumbs down patterns
        negatives = [f for f in entries[-20:] if f.feedback_type == "thumbs_down"]
        positives = [f for f in entries[-20:] if f.feedback_type == "thumbs_up"]

        if len(negatives) > len(positives) * 2:
            # Agent getting too many thumbs down — analyze message length
            avg_neg_len = sum(len(f.message_text) for f in negatives) / max(1, len(negatives))
            avg_pos_len = sum(len(f.message_text) for f in positives) / max(1, len(positives))

            if avg_neg_len > avg_pos_len * 1.5:
                rule = "Be more concise in responses — shorter answers are preferred"
                if agent not in self._adjustments:
                    self._adjustments[agent] = []
                if rule not in self._adjustments[agent]:
                    self._adjustments[agent].append(rule)

        # Cap adjustments at 15
        if agent in self._adjustments and len(self._adjustments[agent]) > 15:
            self._adjustments[agent] = self._adjustments[agent][-15:]

        self._save()
        log.info("Specialization analysis for %s: %d adjustments", agent, len(self._adjustments.get(agent, [])))

    def _save(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        path = self.data_dir / "specialization.json"
        data = {
            "feedback": {
                agent: [
                    {"agent": f.agent, "message_text": f.message_text, "feedback_type": f.feedback_type,
                     "correction_text": f.correction_text, "channel": f.channel, "timestamp": f.timestamp}
                    for f in entries
                ]
                for agent, entries in self._feedback.items()
            },
            "adjustments": self._adjustments,
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(path)

    def _load(self):
        path = self.data_dir / "specialization.json"
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text())
            for agent, entries in data.get("feedback", {}).items():
                self._feedback[agent] = [
                    Feedback(**{k: v for k, v in e.items() if k in Feedback.__dataclass_fields__})
                    for e in entries
                ]
            self._adjustments = data.get("adjustments", {})
            log.info("Specialization data loaded: %d agents", len(self._feedback))
        except Exception as e:
            log.warning("Failed to load specialization data: %s", e)
