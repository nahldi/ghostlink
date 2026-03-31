"""Autonomous Agent Mode — goal-driven task execution.

Flow: Goal → Plan (subtasks) → Execute each → Report summary
Agents plan their own work, delegate to specialists, and report completion.
Human can intervene at any checkpoint via approval system.

Uses JobStore for tracking subtask progress.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Literal

log = logging.getLogger(__name__)


@dataclass
class Subtask:
    """A single step in an autonomous plan."""
    id: str = field(default_factory=lambda: secrets.token_hex(4))
    label: str = ""
    description: str = ""
    status: Literal["pending", "running", "done", "failed", "skipped"] = "pending"
    assignee: str = ""  # agent name to delegate to
    result: str = ""
    started_at: float = 0
    completed_at: float = 0
    error: str = ""


@dataclass
class AutonomousPlan:
    """A goal broken down into subtasks."""
    plan_id: str = field(default_factory=lambda: secrets.token_hex(6))
    goal: str = ""
    agent: str = ""  # the orchestrator agent
    channel: str = "general"
    status: Literal["planning", "executing", "paused", "completed", "failed"] = "planning"
    subtasks: list[Subtask] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    completed_at: float = 0
    summary: str = ""
    require_approval: bool = True  # pause before each subtask for human approval


class AutonomousManager:
    """Manages autonomous agent plans and execution."""

    def __init__(self):
        self._plans: dict[str, AutonomousPlan] = {}

    def create_plan(
        self,
        goal: str,
        agent: str,
        subtasks: list[dict],
        channel: str = "general",
        require_approval: bool = True,
    ) -> AutonomousPlan:
        """Create a new autonomous plan from a goal and subtask list."""
        plan = AutonomousPlan(
            goal=goal,
            agent=agent,
            channel=channel,
            require_approval=require_approval,
            subtasks=[
                Subtask(
                    label=s.get("label", f"Step {i+1}"),
                    description=s.get("description", ""),
                    assignee=s.get("assignee", agent),
                )
                for i, s in enumerate(subtasks)
            ],
        )
        self._plans[plan.plan_id] = plan
        log.info("Autonomous plan created: %s (%d subtasks) by %s", plan.plan_id, len(plan.subtasks), agent)
        return plan

    def get_plan(self, plan_id: str) -> AutonomousPlan | None:
        return self._plans.get(plan_id)

    def list_plans(self, agent: str | None = None) -> list[dict]:
        """List all plans, optionally filtered by agent."""
        plans = self._plans.values()
        if agent:
            plans = [p for p in plans if p.agent == agent]
        return [self._plan_to_dict(p) for p in plans]

    def start_execution(self, plan_id: str) -> Subtask | None:
        """Start executing the plan. Returns the first pending subtask."""
        plan = self._plans.get(plan_id)
        if not plan:
            return None
        plan.status = "executing"
        return self._next_subtask(plan)

    def advance(self, plan_id: str, subtask_id: str, result: str = "", error: str = "") -> Subtask | None:
        """Mark a subtask as done/failed and return the next one."""
        plan = self._plans.get(plan_id)
        if not plan:
            return None

        for st in plan.subtasks:
            if st.id == subtask_id:
                if error:
                    st.status = "failed"
                    st.error = error
                else:
                    st.status = "done"
                    st.result = result
                st.completed_at = time.time()
                break

        # Check if all done
        pending = [s for s in plan.subtasks if s.status in ("pending", "running")]
        if not pending:
            plan.status = "completed" if not any(s.status == "failed" for s in plan.subtasks) else "failed"
            plan.completed_at = time.time()
            plan.summary = self._generate_summary(plan)
            return None

        return self._next_subtask(plan)

    def pause(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if plan and plan.status == "executing":
            plan.status = "paused"
            return True
        return False

    def resume(self, plan_id: str) -> Subtask | None:
        plan = self._plans.get(plan_id)
        if plan and plan.status == "paused":
            plan.status = "executing"
            return self._next_subtask(plan)
        return None

    def cancel(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if not plan:
            return False
        plan.status = "failed"
        plan.completed_at = time.time()
        for st in plan.subtasks:
            if st.status in ("pending", "running"):
                st.status = "skipped"
        return True

    def _next_subtask(self, plan: AutonomousPlan) -> Subtask | None:
        for st in plan.subtasks:
            if st.status == "pending":
                st.status = "running"
                st.started_at = time.time()
                return st
        return None

    def _generate_summary(self, plan: AutonomousPlan) -> str:
        done = sum(1 for s in plan.subtasks if s.status == "done")
        failed = sum(1 for s in plan.subtasks if s.status == "failed")
        total = len(plan.subtasks)
        elapsed = plan.completed_at - plan.created_at
        lines = [f"Goal: {plan.goal}", f"Result: {done}/{total} completed, {failed} failed ({elapsed:.0f}s)"]
        for st in plan.subtasks:
            icon = {"done": "✓", "failed": "✗", "skipped": "⊘"}.get(st.status, "?")
            lines.append(f"  {icon} {st.label}: {st.result or st.error or st.status}")
        return "\n".join(lines)

    def _plan_to_dict(self, plan: AutonomousPlan) -> dict:
        return {
            "plan_id": plan.plan_id,
            "goal": plan.goal,
            "agent": plan.agent,
            "channel": plan.channel,
            "status": plan.status,
            "require_approval": plan.require_approval,
            "created_at": plan.created_at,
            "completed_at": plan.completed_at,
            "summary": plan.summary,
            "subtasks": [
                {
                    "id": s.id,
                    "label": s.label,
                    "description": s.description,
                    "status": s.status,
                    "assignee": s.assignee,
                    "result": s.result[:500],
                    "error": s.error,
                }
                for s in plan.subtasks
            ],
        }
