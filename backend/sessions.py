"""GhostLink — Structured Sessions with phases, templates, and turn-taking."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

# Built-in session templates
TEMPLATES = [
    {
        "id": "code-review",
        "name": "Code Review",
        "description": "Structured code review with analysis, feedback, and action items.",
        "phases": [
            {"name": "Analysis", "prompt": "Analyze the code changes. Identify patterns, potential issues, and areas of concern.", "turns": 1},
            {"name": "Feedback", "prompt": "Provide detailed feedback on the code. Note strengths and suggest improvements.", "turns": 2},
            {"name": "Action Items", "prompt": "Summarize the review with concrete action items and prioritized fixes.", "turns": 1},
        ],
        "roles": ["Reviewer", "Author"],
    },
    {
        "id": "debate",
        "name": "Debate",
        "description": "Structured debate between agents on a topic with opening, rebuttal, and conclusion.",
        "phases": [
            {"name": "Opening Statements", "prompt": "Present your opening argument on the topic. State your position clearly.", "turns": 1},
            {"name": "Rebuttals", "prompt": "Respond to the opposing argument. Address their points and strengthen your position.", "turns": 2},
            {"name": "Closing", "prompt": "Deliver your closing statement. Summarize key arguments and your final position.", "turns": 1},
        ],
        "roles": ["Proponent", "Opponent"],
    },
    {
        "id": "design-critique",
        "name": "Design Critique",
        "description": "Review a design with structured feedback phases.",
        "phases": [
            {"name": "Presentation", "prompt": "Present the design. Explain the rationale, constraints, and key decisions.", "turns": 1},
            {"name": "Questions", "prompt": "Ask clarifying questions about the design. Probe assumptions and edge cases.", "turns": 2},
            {"name": "Critique", "prompt": "Provide constructive critique. Identify strengths, weaknesses, and alternatives.", "turns": 2},
            {"name": "Synthesis", "prompt": "Synthesize the discussion into recommendations and next steps.", "turns": 1},
        ],
        "roles": ["Designer", "Critic"],
    },
    {
        "id": "planning",
        "name": "Planning",
        "description": "Collaborative planning session with brainstorm, prioritize, and plan phases.",
        "phases": [
            {"name": "Brainstorm", "prompt": "Generate ideas and possibilities. Think broadly, no constraints yet.", "turns": 2},
            {"name": "Prioritize", "prompt": "Evaluate and prioritize the ideas. Consider feasibility, impact, and effort.", "turns": 2},
            {"name": "Plan", "prompt": "Create an actionable plan from the top priorities. Define steps, owners, and timeline.", "turns": 1},
        ],
        "roles": ["Facilitator", "Contributor"],
    },
]


class SessionManager:
    """Manages structured sessions per channel."""

    def __init__(self, data_dir: Path):
        self._data_dir = data_dir
        self._sessions_file = data_dir / "sessions.json"
        self._sessions: dict[str, dict] = {}
        self._custom_templates: list[dict] = []
        self._load()

    def _load(self):
        if self._sessions_file.exists():
            try:
                data = json.loads(self._sessions_file.read_text())
                self._sessions = data.get("sessions", {})
                self._custom_templates = data.get("custom_templates", [])
            except (json.JSONDecodeError, OSError):
                pass

    def _save(self):
        self._sessions_file.write_text(json.dumps({
            "sessions": self._sessions,
            "custom_templates": self._custom_templates,
        }, indent=2))

    def get_templates(self) -> list[dict]:
        """Return all templates (built-in + custom)."""
        return TEMPLATES + self._custom_templates

    def save_template(self, template: dict) -> dict:
        """Save a custom template."""
        template["id"] = template.get("id", f"custom-{uuid.uuid4().hex[:8]}")
        # Replace if exists
        self._custom_templates = [t for t in self._custom_templates if t["id"] != template["id"]]
        self._custom_templates.append(template)
        self._save()
        return template

    def delete_template(self, template_id: str) -> bool:
        before = len(self._custom_templates)
        self._custom_templates = [t for t in self._custom_templates if t["id"] != template_id]
        if len(self._custom_templates) < before:
            self._save()
            return True
        return False

    def start_session(self, channel: str, template_id: str, cast: dict[str, str], topic: str = "") -> dict:
        """Start a new session in a channel."""
        # Find template
        templates = self.get_templates()
        template = next((t for t in templates if t["id"] == template_id), None)
        if not template:
            raise ValueError(f"Template '{template_id}' not found")

        session = {
            "id": uuid.uuid4().hex[:12],
            "channel": channel,
            "template_id": template_id,
            "template_name": template["name"],
            "topic": topic,
            "cast": cast,  # role -> agent name mapping
            "phases": template["phases"],
            "current_phase": 0,
            "current_turn": 0,
            "status": "active",  # active, paused, completed
            "execution_mode": "execute",  # plan, execute, review
            "started_at": time.time(),
            "completed_at": None,
        }
        self._sessions[channel] = session
        self._save()
        return session

    def get_session(self, channel: str) -> dict | None:
        return self._sessions.get(channel)

    def advance_turn(self, channel: str) -> dict | None:
        """Advance to next turn or next phase."""
        session = self._sessions.get(channel)
        if not session or session["status"] != "active":
            return session

        phases = session["phases"]
        current = session["current_phase"]
        if current >= len(phases):
            session["status"] = "completed"
            session["completed_at"] = time.time()
            self._save()
            return session

        phase = phases[current]
        max_turns = phase.get("turns", 1)
        session["current_turn"] += 1

        if session["current_turn"] >= max_turns:
            session["current_phase"] += 1
            session["current_turn"] = 0
            if session["current_phase"] >= len(phases):
                session["status"] = "completed"
                session["completed_at"] = time.time()

        self._save()
        return session

    def end_session(self, channel: str) -> dict | None:
        session = self._sessions.get(channel)
        if session:
            session["status"] = "completed"
            session["completed_at"] = time.time()
            self._save()
        return session

    def pause_session(self, channel: str) -> dict | None:
        session = self._sessions.get(channel)
        if session and session["status"] == "active":
            session["status"] = "paused"
            self._save()
        return session

    def resume_session(self, channel: str) -> dict | None:
        session = self._sessions.get(channel)
        if session and session["status"] == "paused":
            session["status"] = "active"
            self._save()
        return session

    def set_execution_mode(self, channel: str, mode: str) -> dict | None:
        """Set the execution mode for a session: plan, execute, or review."""
        if mode not in ("plan", "execute", "review"):
            raise ValueError(f"Invalid execution mode: {mode!r}. Must be plan, execute, or review.")
        session = self._sessions.get(channel)
        if session:
            session["execution_mode"] = mode
            self._save()
        return session

    def get_execution_mode(self, channel: str) -> str:
        """Get the execution mode for a channel's session. Defaults to 'execute'."""
        session = self._sessions.get(channel)
        if session:
            return session.get("execution_mode", "execute")
        return "execute"

    def get_current_prompt(self, channel: str) -> dict | None:
        """Get the current phase prompt and role for the session."""
        session = self._sessions.get(channel)
        if not session or session["status"] != "active":
            return None

        phases = session["phases"]
        current = session["current_phase"]
        if current >= len(phases):
            return None

        phase = phases[current]
        roles = [r for r in session["cast"].keys() if session["cast"][r]]
        if not roles:
            return None
        # Alternate turns between assigned roles
        role_idx = session["current_turn"] % len(roles)
        current_role = roles[role_idx]
        current_agent = session["cast"].get(current_role, "") if current_role else None

        return {
            "phase_name": phase["name"],
            "phase_number": current + 1,
            "total_phases": len(phases),
            "prompt": phase["prompt"],
            "turn": session["current_turn"] + 1,
            "max_turns": phase.get("turns", 1),
            "role": current_role,
            "agent": current_agent,
            "topic": session.get("topic", ""),
        }
